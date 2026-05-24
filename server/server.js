import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import { ethers } from 'ethers';
import { readDb, writeDb, createGladiatorWallet, getUSDCBalance, getEURCBalance, claimFaucet, transferUSDC, transferEURC, logToGladiatorLedger } from './circleService.js';
import { runBattle } from './battleEngine.js';
import { evaluateWagerPolicy, evaluateBattlePolicy, POLICY_RULES } from './battlePolicy.js';

// Arc Faucet: per-address cooldown tracking (24h)
const faucetCooldowns = new Map(); // address -> last claim timestamp
const FAUCET_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

// Policy Engine: track gladiators currently in active battles (anti-double-book)
const activeBattleGladiators = new Set();


dotenv.config();

const app = express();
const PORT = process.env.PORT || 8081;

// CORS setup: Restrict origins to trusted domains and local loopbacks (CWE-942 mitigation)
const allowedOrigins = [
  'http://localhost:8080',
  'http://localhost:8081',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:3000',
  'https://agora.thecanteenapp.com',
  'https://ai-gladiator-arena.vercel.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) {
      return callback(null, true);
    }
    const isLocalhost = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isVercel = /^https:\/\/ai-gladiator-arena(-[a-z0-9]+)?\.vercel\.app$/.test(origin);
    if (isLocalhost || isVercel || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Blocked by CORS security policy'));
    }
  }
}));

app.use(express.json());

// Helper function to return generic, sanitized errors (removes path leak vulnerability)
function sendSanitizedError(res, err, defaultMsg = "An internal server error occurred.") {
  console.error("[Server Error Details]:", err);
  res.status(500).json({ error: defaultMsg });
}

// Signature Verification Middleware for withdrawal/owner checks
function verifyOwnerSignature(req, res, next) {
  const signature = req.headers['x-signature'];
  const message = req.headers['x-message'];
  const ownerAddress = req.headers['x-owner-address'];

  if (!signature || !message || !ownerAddress) {
    return res.status(401).json({ error: "Missing signature headers: x-signature, x-message, x-owner-address" });
  }

  try {
    const recoveredAddress = ethers.verifyMessage(message, signature);
    if (recoveredAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      return res.status(401).json({ error: "Signature verification failed: unauthorized wallet." });
    }
    req.ownerAddress = recoveredAddress.toLowerCase();
    next();
  } catch (err) {
    return res.status(401).json({ error: `Invalid signature: ${err.message}` });
  }
}

// Rate limiters for DDoS and API abuse prevention
const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: "Too many requests. Please try again in 15 minutes." }
});

const expensiveRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // max 20 matches/upgrades per hour per IP
  message: { error: "Action limit exceeded. Please wait and try again." }
});

app.use('/api/', apiRateLimiter);

// Get all gladiators (refreshes USDC balances in real-time)
app.get('/api/gladiators', async (req, res) => {
  try {
    const db = readDb();
    
    // Asynchronously refresh balances
    const updatedGladiators = await Promise.all(
      db.gladiators.map(async (g) => {
        const balance = await getUSDCBalance(g.walletAddress);
        const eurcBalance = await getEURCBalance(g.walletAddress);
        return { ...g, balance, eurcBalance };
      })
    );

    res.json(updatedGladiators);
  } catch (err) {
    sendSanitizedError(res, err, "Failed to retrieve gladiators.");
  }
});

// ── Policy Engine Endpoints ───────────────────────────────────────────────────

// GET /api/policy/stats — returns aggregate APPROVED/BLOCKED counts (like Shadow's dashboard)
app.get('/api/policy/stats', (req, res) => {
  try {
    const db = readDb();
    const log = db.policyLog || [];
    const approved = log.filter(e => e.approved).length;
    const blocked = log.filter(e => !e.approved).length;

    // Breakdown by rule
    const byRule = {};
    log.filter(e => !e.approved).forEach(e => {
      byRule[e.ruleCode] = (byRule[e.ruleCode] || 0) + 1;
    });

    res.json({
      total: log.length,
      approved,
      blocked,
      approvalRate: log.length > 0 ? ((approved / log.length) * 100).toFixed(1) + '%' : '0%',
      blockedByRule: byRule,
      rules: POLICY_RULES,
    });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to retrieve policy stats.");
  }
});

// GET /api/policy/log — returns the last 50 attested policy decisions
app.get('/api/policy/log', (req, res) => {
  try {
    const db = readDb();
    const log = (db.policyLog || []).slice(0, 50);
    res.json(log);
  } catch (err) {
    sendSanitizedError(res, err, "Failed to retrieve policy log.");
  }
});

// Expose public network configurations dynamically to MetaMask (Canteen Key routing)
app.get('/api/config', (req, res) => {
  try {
    const CANTEEN_RPC_KEY = process.env.CANTEEN_RPC_KEY;
    const rpcUrl = CANTEEN_RPC_KEY 
      ? `https://rpc.testnet.arc-node.thecanteenapp.com/v1/${CANTEEN_RPC_KEY}`
      : 'https://rpc.testnet.arc-node.thecanteenapp.com/v1/public';
      
    res.json({
      rpcUrl,
      chainId: '0x4ce946',
      chainName: 'Arc Testnet',
      blockExplorerUrl: 'https://testnet.arcscan.app'
    });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to load network config.");
  }
});

// Create a new Gladiator
app.post('/api/gladiators', async (req, res) => {
  const { name, role, strategy, ownerAddress, attributes, customPrompt } = req.body;

  if (!name || !role || !strategy) {
    return res.status(400).json({ error: "Missing required fields: name, role, strategy" });
  }

  // Length constraints
  if (name.length > 30 || strategy.length > 50) {
    return res.status(400).json({ error: "Name or strategy string too long." });
  }

  if (customPrompt && typeof customPrompt === 'string' && customPrompt.length > 300) {
    return res.status(400).json({ error: "Custom strategy prompt too long (max 300 characters)." });
  }

  const validRoles = ["Cyber-Dimachaerus", "Cyber-Retiarius", "Cyber-Murmillo", "Cyber-Thraex", "Cyber-Samurai", "Netrunner", "Mech-Tank"];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
  }

  try {
    const db = readDb();
    const id = `glad_${Date.now()}`;
    
    // Create Circle/Mock wallet
    const walletInfo = await createGladiatorWallet(id);

    // Assign stats based on role
    let stats = { hp: 100, attack: 15, defense: 10, speed: 12 };
    if (role === "Cyber-Dimachaerus" || role === "Cyber-Samurai") {
      stats.attack = 18;
      stats.speed = 15;
      stats.defense = 8;
    } else if (role === "Cyber-Retiarius" || role === "Netrunner") {
      stats.attack = 14;
      stats.speed = 18;
      stats.defense = 6;
    } else if (role === "Cyber-Murmillo" || role === "Mech-Tank") {
      stats.attack = 15;
      stats.speed = 8;
      stats.defense = 16;
    } else if (role === "Cyber-Thraex") {
      stats.attack = 16;
      stats.speed = 14;
      stats.defense = 10;
    }

    const newGladiator = {
      id,
      name,
      role,
      strategy,
      attributes: {
        aggression: typeof attributes?.aggression === 'number' ? Math.max(0, Math.min(100, attributes.aggression)) : 50,
        defense: typeof attributes?.defense === 'number' ? Math.max(0, Math.min(100, attributes.defense)) : 30,
        speed: typeof attributes?.speed === 'number' ? Math.max(0, Math.min(100, attributes.speed)) : 20,
      },
      customPrompt: typeof customPrompt === 'string' ? customPrompt.slice(0, 300) : "",
      stats,
      walletAddress: walletInfo.address,
      walletId: walletInfo.walletId,
      isMock: walletInfo.isMock,
      wins: 0,
      losses: 0,
      nftMinted: false,
      nftTxHash: null,
      nftTokenId: null,
      ownerAddress: ownerAddress ? ownerAddress.toLowerCase() : null,
      createdAt: new Date().toISOString()
    };

    const finalDb = readDb();
    finalDb.gladiators.push(newGladiator);
    writeDb(finalDb);

    res.status(201).json(newGladiator);
  } catch (err) {
    sendSanitizedError(res, err, "Failed to activate gladiator.");
  }
});

// Mint Gladiator as NFT
app.post('/api/gladiators/:id/mint', async (req, res) => {
  const { id } = req.params;
  const { userAddress } = req.body;

  if (!userAddress) {
    return res.status(400).json({ error: "Missing recipient userAddress for NFT minting" });
  }

  try {
    const db = readDb();
    const idx = db.gladiators.findIndex(g => g.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: "Gladiator not found" });
    }

    const gladiator = db.gladiators[idx];

    if (gladiator.nftMinted) {
      return res.status(400).json({ error: "Gladiator has already been minted as an NFT" });
    }

    // Register NFT mint status
    gladiator.nftMinted = true;
    gladiator.nftTxHash = '0x' + ethers.hexlify(ethers.randomBytes(32)).slice(2);
    gladiator.nftTokenId = Math.floor(Math.random() * 1000000);

    writeDb(db);

    res.json({
      success: true,
      message: `Gladiator "${gladiator.name}" successfully minted as NFT!`,
      nftTxHash: gladiator.nftTxHash,
      nftTokenId: gladiator.nftTokenId,
      gladiator
    });
  } catch (err) {
    sendSanitizedError(res, err, "NFT minting registration failed.");
  }
});

// Delete a Gladiator (now signature verified)
app.delete('/api/gladiators/:id', verifyOwnerSignature, async (req, res) => {
  const { id } = req.params;
  const requesterAddress = req.ownerAddress; // From verifyOwnerSignature middleware

  try {
    const db = readDb();
    const idx = db.gladiators.findIndex(g => g.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Gladiator not found.' });
    }

    const gladiator = db.gladiators[idx];

    // If gladiator has an owner, verify the requester matches
    if (gladiator.ownerAddress) {
      if (gladiator.ownerAddress.toLowerCase() !== requesterAddress.toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden: You do not own this gladiator.' });
      }
    }

    // Remove gladiator from roster
    db.gladiators.splice(idx, 1);

    // Clear any active bets placed on this gladiator
    if (db.activeBets) {
      db.activeBets = db.activeBets.filter(b => b.gladiatorId !== id);
    }

    writeDb(db);

    console.log(`[Server] Gladiator ${gladiator.name} (${id}) deleted.`);
    res.json({ success: true, message: `Gladiator "${gladiator.name}" has been retired from the arena.` });
  } catch (err) {
    sendSanitizedError(res, err, 'Failed to delete gladiator.');
  }
});

// Claim USDC/EURC Faucet (enforces bounds checking)
app.post('/api/faucet', async (req, res) => {
  const { address, amount, token } = req.body;

  if (!address) {
    return res.status(400).json({ error: "Missing wallet address" });
  }

  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid wallet address format." });
  }

  const amountNum = parseFloat(amount || 50.0);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum) || amountNum > 1000) {
    return res.status(400).json({ error: "Invalid faucet amount. Must be a positive number up to 1000." });
  }

  const tokenSymbol = token || 'USDC';
  if (tokenSymbol !== 'USDC' && tokenSymbol !== 'EURC') {
    return res.status(400).json({ error: "Unsupported token. Must be USDC or EURC." });
  }

  try {
    const newBalance = await claimFaucet(address, amountNum, tokenSymbol);
    res.json({ address, balance: newBalance, message: `${tokenSymbol} successfully credited!` });
  } catch (err) {
    sendSanitizedError(res, err, "Faucet distribution failed.");
  }
});

// Trigger a Sandbox Battle (Free, no wagers, no ledger updates, no betting settlement)
app.post('/api/battles/sandbox', async (req, res) => {
  const { gladiatorAId, gladiatorBId } = req.body;

  if (!gladiatorAId || !gladiatorBId) {
    return res.status(400).json({ error: "Missing gladiator IDs" });
  }

  if (gladiatorAId === gladiatorBId) {
    return res.status(400).json({ error: "A gladiator cannot fight themselves!" });
  }

  try {
    const battleRecord = await runBattle(gladiatorAId, gladiatorBId, true);
    res.json(battleRecord);
  } catch (err) {
    sendSanitizedError(res, err, "Sandbox battle execution failed.");
  }
});

// Trigger a Battle (includes rate limiting, policy engine gating, and prediction market bet settlement)
app.post('/api/battles', expensiveRateLimiter, async (req, res) => {
  const { gladiatorAId, gladiatorBId } = req.body;

  if (!gladiatorAId || !gladiatorBId) {
    return res.status(400).json({ error: "Missing gladiator IDs" });
  }

  if (gladiatorAId === gladiatorBId) {
    return res.status(400).json({ error: "A gladiator cannot fight themselves!" });
  }

  try {
    const db = readDb();
    const gladiatorA = db.gladiators.find(g => g.id === gladiatorAId);
    const gladiatorB = db.gladiators.find(g => g.id === gladiatorBId);

    if (!gladiatorA || !gladiatorB) {
      return res.status(404).json({ error: "One or both gladiators not found" });
    }

    // ── POLICY ENGINE GATE ──────────────────────────────────────────────────
    // Evaluate the battle request against all policy rules before execution.
    // This mirrors Shadow's PilotAttestor — every decision is SHA-256 attested.
    const lastBattleA = db.battles.filter(b => b.gladiatorAId === gladiatorAId || b.gladiatorBId === gladiatorAId).slice(-1)[0]?.timestamp;
    const lastBattleB = db.battles.filter(b => b.gladiatorAId === gladiatorBId || b.gladiatorBId === gladiatorBId).slice(-1)[0]?.timestamp;

    const policyResult = evaluateBattlePolicy({
      gladiatorA,
      gladiatorB,
      activeBattleIds: Array.from(activeBattleGladiators),
      lastBattleTimestampA: lastBattleA,
      lastBattleTimestampB: lastBattleB,
    });

    // Log every decision (approved or blocked) to the persistent policy audit trail
    if (!db.policyLog) db.policyLog = [];
    const policyEntry = {
      ...policyResult,
      gladiatorAName: gladiatorA.name,
      gladiatorBName: gladiatorB.name,
      gladiatorAId,
      gladiatorBId,
      type: 'BATTLE_INITIATION',
    };
    db.policyLog.unshift(policyEntry); // newest first
    if (db.policyLog.length > 500) db.policyLog = db.policyLog.slice(0, 500); // cap at 500 entries
    writeDb(db);

    // If blocked, return 403 with the attested decision
    if (!policyResult.approved) {
      console.log(`[PolicyEngine] BLOCKED battle ${gladiatorA.name} vs ${gladiatorB.name} — Rule ${policyResult.ruleCode}: ${policyResult.reason}`);
      return res.status(403).json({
        error: `Battle blocked by policy engine`,
        policy: {
          decision: 'BLOCKED',
          ruleCode: policyResult.ruleCode,
          reason: policyResult.reason,
          sha256: policyResult.sha256,
          timestamp: policyResult.timestamp,
        }
      });
    }

    console.log(`[PolicyEngine] APPROVED battle ${gladiatorA.name} vs ${gladiatorB.name} — sha256: ${policyResult.sha256.substring(0, 16)}...`);
    // ── END POLICY ENGINE GATE ──────────────────────────────────────────────

    // Mark gladiators as active in battle (anti-double-book)
    activeBattleGladiators.add(gladiatorAId);
    activeBattleGladiators.add(gladiatorBId);

    try {
      // 1. Run the battle
      const battleRecord = await runBattle(gladiatorAId, gladiatorBId);
      battleRecord.policyAttestation = policyResult.sha256;
      battleRecord.policyApproved = true;

      // 2. Resolve active bets from the prediction market
      const dbAfter = readDb();
      if (dbAfter.activeBets && dbAfter.activeBets.length > 0) {
        const winningGladiatorId = battleRecord.winnerId;
        
        // Calculate odds for resolution
        const gladA = dbAfter.gladiators.find(g => g.id === gladiatorAId);
        const gladB = dbAfter.gladiators.find(g => g.id === gladiatorBId);
        
        if (gladA && gladB) {
          const scoreA = gladA.stats.attack * 0.4 + gladA.stats.defense * 0.3 + gladA.stats.speed * 0.3;
          const scoreB = gladB.stats.attack * 0.4 + gladB.stats.defense * 0.3 + gladB.stats.speed * 0.3;
          const probA = scoreA / (scoreA + scoreB);
          const probB = 1.0 - probA;
          const oddsA = parseFloat(((1 - 0.05) / probA).toFixed(2));
          const oddsB = parseFloat(((1 - 0.05) / probB).toFixed(2));
          const winnerOdds = winningGladiatorId === gladiatorAId ? oddsA : oddsB;

          battleRecord.betPayouts = [];

          dbAfter.activeBets.forEach(bet => {
            if (bet.gladiatorId === winningGladiatorId) {
              const payoutAmount = parseFloat((bet.amount * winnerOdds).toFixed(2));
              if (bet.token === 'EURC') {
                const current = dbAfter.ledgerEURC[bet.userAddress] || 0.0;
                dbAfter.ledgerEURC[bet.userAddress] = parseFloat((current + payoutAmount).toFixed(2));
              } else {
                const current = dbAfter.ledger[bet.userAddress] || 0.0;
                dbAfter.ledger[bet.userAddress] = parseFloat((current + payoutAmount).toFixed(2));
              }
              battleRecord.betPayouts.push({
                userAddress: bet.userAddress,
                amount: payoutAmount,
                token: bet.token,
                won: true
              });
            } else {
              battleRecord.betPayouts.push({
                userAddress: bet.userAddress,
                amount: bet.amount,
                token: bet.token,
                won: false
              });
            }
          });
        }

        // Clear bets and save database state
        dbAfter.activeBets = [];
        writeDb(dbAfter);
      }

      res.json(battleRecord);
    } finally {
      // Always release gladiators from active battle set
      activeBattleGladiators.delete(gladiatorAId);
      activeBattleGladiators.delete(gladiatorBId);
    }
  } catch (err) {
    activeBattleGladiators.delete(gladiatorAId);
    activeBattleGladiators.delete(gladiatorBId);
    sendSanitizedError(res, err, "Battle execution or settlement failed.");
  }
});


// Autonomous Gladiator Upgrade evaluation & execution (includes rate limit checks)
app.post('/api/gladiators/:id/evaluate-upgrade', expensiveRateLimiter, async (req, res) => {
  const { id } = req.params;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const UPGRADE_COST = 5.0;

  try {
    const db = readDb();
    const gladiator = db.gladiators.find(g => g.id === id);

    if (!gladiator) {
      return res.status(404).json({ error: "Gladiator not found" });
    }

    const balanceUSDC = await getUSDCBalance(gladiator.walletAddress);
    const balanceEURC = await getEURCBalance(gladiator.walletAddress);

    let decision = { shouldUpgrade: false, stat: null, thinking: "", reasoning: "" };

    // Ask LLM if key is configured
    if (OPENAI_API_KEY) {
      try {
        const prompt = `
          You are the AI Gladiator named "${gladiator.name}".
          Your class: ${gladiator.role}
          Your current stats: Attack ${gladiator.stats.attack}, Defense ${gladiator.stats.defense}, Speed ${gladiator.stats.speed}.
          Your records: Wins ${gladiator.wins}, Losses ${gladiator.losses}.
          Your funds: ${balanceUSDC} USDC, ${balanceEURC} EURC.

          An upgrade costs exactly ${UPGRADE_COST} USDC. It adds +2 points to either your Attack, Defense, or Speed.
          Evaluate whether you should purchase an upgrade to improve your win rate. If so, select the best stat to upgrade based on your class and record.

          Respond in raw JSON format:
          {
            "thinking": "A step-by-step cognitive and financial reasoning trace in the first person analyzing your treasury efficiency, ROI of the stat increase, and combat utility of each option (mimicking an R1 model). Keep it under 200 words.",
            "shouldUpgrade": true | false,
            "stat": "attack" | "defense" | "speed" | null,
            "reasoning": "A short justification in the first person explaining your choice."
          }
        `;

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENAI_API_KEY}`
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
          })
        });
        const apiData = await response.json();
        decision = JSON.parse(apiData.choices[0].message.content);
      } catch (err) {
        console.warn("[Server] LLM upgrade evaluation failed, falling back to heuristics:", err.message);
      }
    }

    // Heuristics Fallback
    if (!OPENAI_API_KEY || !decision.reasoning) {
      if (balanceUSDC >= UPGRADE_COST) {
        decision.shouldUpgrade = true;
        
        // Choose lowest stat relative to class balance
        const { attack, defense, speed } = gladiator.stats;
        if (defense < attack && defense < speed) {
          decision.stat = "defense";
          decision.reasoning = "My defensive systems are lagging behind my speed and offense. Upgrading armor to survive heavy hits.";
        } else if (speed < attack) {
          decision.stat = "speed";
          decision.reasoning = "I need higher agility to land the first strike. Speed is the priority.";
        } else {
          decision.stat = "attack";
          decision.reasoning = "Increasing primary output protocols. Upgrading plasma blade damage.";
        }
        decision.thinking = `[Finance-R1] Initiating gladiator capital allocation assessment. Current treasury balance = ${balanceUSDC} USDC. Cost parameter = ${UPGRADE_COST} USDC. Status: SUFFICIENT. Calculating ROI: increasing stat '${decision.stat}' by +2 will enhance combat coefficient and increase victory probability. Executing upgrade protocol.`;
      } else {
        decision.shouldUpgrade = false;
        decision.reasoning = `I lack sufficient funds. Upgrade costs ${UPGRADE_COST} USDC, but I only have ${balanceUSDC} USDC. I need to win more matches.`;
        decision.thinking = `[Finance-R1] Initiating gladiator capital allocation assessment. Current treasury balance = ${balanceUSDC} USDC. Cost parameter = ${UPGRADE_COST} USDC. Status: INSUFFICIENT. Reinvestment deferred due to low liquid capital. Continuing match engagement routines to accumulate wagers.`;
      }
    }

    // Execute Upgrade
    if (decision.shouldUpgrade && decision.stat) {
      if (balanceUSDC < UPGRADE_COST) {
        return res.status(400).json({ error: "Agent decided to upgrade, but had insufficient USDC balance." });
      }

      // 1. Perform transaction: Gladiator wallet transfers USDC to Platform Fee Treasury
      const treasuryAddress = "0x98fE4b830Ed6DFE2E20a6Cd196e8d1C0eD327B66";
      const tx = await transferUSDC(gladiator.walletAddress, treasuryAddress, UPGRADE_COST);

      // 2. Apply stat changes in DB
      const freshDb = readDb();
      const dbGlad = freshDb.gladiators.find(g => g.id === id);
      dbGlad.stats[decision.stat] += 2;
      writeDb(freshDb);

      return res.json({
        success: true,
        upgraded: true,
        stat: decision.stat,
        thinking: decision.thinking,
        reasoning: decision.reasoning,
        txHash: tx.txHash,
        newStats: dbGlad.stats
      });
    }

    res.json({
      success: true,
      upgraded: false,
      thinking: decision.thinking,
      reasoning: decision.reasoning
    });

  } catch (err) {
    sendSanitizedError(res, err, "Upgrade evaluation failed.");
  }
});

// Calculate battle odds and Kelly Criterion suggestions
app.post('/api/battles/predict', async (req, res) => {
  const { gladiatorAId, gladiatorBId } = req.body;

  if (!gladiatorAId || !gladiatorBId) {
    return res.status(400).json({ error: "Missing gladiator IDs for prediction calculations." });
  }

  try {
    const db = readDb();
    const gladA = db.gladiators.find(g => g.id === gladiatorAId);
    const gladB = db.gladiators.find(g => g.id === gladiatorBId);

    if (!gladA || !gladB) {
      return res.status(404).json({ error: "One or both gladiators not found." });
    }

    // Win probability based on combat attributes
    const scoreA = gladA.stats.attack * 0.4 + gladA.stats.defense * 0.3 + gladA.stats.speed * 0.3;
    const scoreB = gladB.stats.attack * 0.4 + gladB.stats.defense * 0.3 + gladB.stats.speed * 0.3;
    
    const probA = parseFloat((scoreA / (scoreA + scoreB)).toFixed(4));
    const probB = parseFloat((1.0 - probA).toFixed(4));

    // Payout decimal odds (5% house edge)
    const oddsA = parseFloat(((1 - 0.05) / probA).toFixed(2));
    const oddsB = parseFloat(((1 - 0.05) / probB).toFixed(2));

    // Calculate suggestion math using Kelly Criterion
    let kellyA = 0;
    let kellyB = 0;
    
    // Net odds (decimal odds - 1)
    const netOddsA = oddsA - 1;
    const netOddsB = oddsB - 1;

    if (netOddsA > 0) {
      kellyA = parseFloat(((probA * netOddsA - probB) / netOddsA).toFixed(4));
      if (kellyA < 0) kellyA = 0;
    }
    if (netOddsB > 0) {
      kellyB = parseFloat(((probB * netOddsB - probA) / netOddsB).toFixed(4));
      if (kellyB < 0) kellyB = 0;
    }

    // Half-Kelly multiplier for risk mitigation
    const halfKellyA = parseFloat((kellyA * 0.5).toFixed(4));
    const halfKellyB = parseFloat((kellyB * 0.5).toFixed(4));

    res.json({
      gladiatorAId,
      gladiatorBId,
      probabilityA: probA,
      probabilityB: probB,
      oddsA,
      oddsB,
      kellyA: halfKellyA,
      kellyB: halfKellyB
    });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to compute prediction analytics.");
  }
});

// Predictor Agent Address for Builder Spec monetization (attributing bets to AI recommendations)
const PREDICTOR_AGENT_ADDRESS = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

// Record a spectator bet (now signature verified, uses x-signature headers)
app.post('/api/bets', verifyOwnerSignature, async (req, res) => {
  const { gladiatorId, amount, token } = req.body;
  const userAddress = req.ownerAddress; // Verified via verifyOwnerSignature middleware

  if (!userAddress || !gladiatorId || !amount) {
    return res.status(400).json({ error: "Missing required fields: gladiatorId, amount" });
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum)) {
    return res.status(400).json({ error: "Bet amount must be a positive finite number." });
  }

  const tokenSymbol = token || 'USDC';
  if (tokenSymbol !== 'USDC' && tokenSymbol !== 'EURC') {
    return res.status(400).json({ error: "Unsupported token format. Must be USDC or EURC." });
  }

  // Normalize address to lowercase for consistent ledger key lookups
  const normalizedAddress = userAddress.toLowerCase();

  try {
    const db = readDb();
    const gladiator = db.gladiators.find(g => g.id === gladiatorId);
    if (!gladiator) {
      return res.status(404).json({ error: "Gladiator not found." });
    }

    // Apply 1% builder fee to Predictor Agent for providing prediction/Kelly recommendation
    const builderFee = parseFloat((amountNum * 0.01).toFixed(4));
    const netWager = parseFloat((amountNum - builderFee).toFixed(4));

    // Verify balance in mock database ledger and deduct amountNum from user
    if (tokenSymbol === 'EURC') {
      const balance = db.ledgerEURC[normalizedAddress] || 0.0;
      if (balance < amountNum) {
        return res.status(400).json({ error: `Insufficient EURC balance: you have ${balance} EURC, requested ${amountNum}.` });
      }
      db.ledgerEURC[normalizedAddress] = parseFloat((balance - amountNum).toFixed(2));
      db.ledgerEURC[PREDICTOR_AGENT_ADDRESS] = parseFloat(((db.ledgerEURC[PREDICTOR_AGENT_ADDRESS] || 0.0) + builderFee).toFixed(4));
    } else {
      const balance = db.ledger[normalizedAddress] || 0.0;
      if (balance < amountNum) {
        return res.status(400).json({ error: `Insufficient USDC balance: you have ${balance} USDC, requested ${amountNum}.` });
      }
      db.ledger[normalizedAddress] = parseFloat((balance - amountNum).toFixed(2));
      db.ledger[PREDICTOR_AGENT_ADDRESS] = parseFloat(((db.ledger[PREDICTOR_AGENT_ADDRESS] || 0.0) + builderFee).toFixed(4));
    }

    if (!db.activeBets) db.activeBets = [];
    const betRecord = {
      userAddress: normalizedAddress,
      gladiatorId,
      amount: netWager,
      builderFee,
      token: tokenSymbol,
      createdAt: new Date().toISOString()
    };
    db.activeBets.push(betRecord);
    writeDb(db);

    res.json({
      success: true,
      message: `Bet of ${amountNum} ${tokenSymbol} placed! (AI Advisor Builder Fee: ${builderFee} ${tokenSymbol}).`,
      bet: betRecord
    });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to record bet.");
  }
});

// Fund a spectator's prediction market balance (mock USDC for wagering)
app.post('/api/user/fund', async (req, res) => {
  const { userAddress, amount, token } = req.body;

  if (!userAddress) {
    return res.status(400).json({ error: "Missing userAddress" });
  }

  if (!ethers.isAddress(userAddress)) {
    return res.status(400).json({ error: "Invalid wallet address format." });
  }

  const amountNum = parseFloat(amount || 100);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum) || amountNum > 1000) {
    return res.status(400).json({ error: "Invalid amount. Must be between 1 and 1000." });
  }

  const tokenSymbol = token || 'USDC';
  if (tokenSymbol !== 'USDC' && tokenSymbol !== 'EURC') {
    return res.status(400).json({ error: "Unsupported token. Must be USDC or EURC." });
  }

  const normalizedAddress = userAddress.toLowerCase();

  try {
    const db = readDb();
    if (tokenSymbol === 'EURC') {
      db.ledgerEURC[normalizedAddress] = parseFloat(((db.ledgerEURC[normalizedAddress] || 0) + amountNum).toFixed(2));
    } else {
      db.ledger[normalizedAddress] = parseFloat(((db.ledger[normalizedAddress] || 0) + amountNum).toFixed(2));
    }
    writeDb(db);
    const newBalance = tokenSymbol === 'EURC' ? db.ledgerEURC[normalizedAddress] : db.ledger[normalizedAddress];
    res.json({ success: true, balance: newBalance, token: tokenSymbol, message: `${amountNum} ${tokenSymbol} credited to your spectator wallet!` });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to fund spectator balance.");
  }
});

// Get a spectator's current prediction market balance
app.get('/api/user/balance/:address', async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: "Invalid wallet address format." });
  }

  const normalizedAddress = address.toLowerCase();

  try {
    const db = readDb();
    const usdc = db.ledger[normalizedAddress] || 0.0;
    const eurc = db.ledgerEURC[normalizedAddress] || 0.0;
    res.json({ address: normalizedAddress, usdc, eurc });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to fetch user balance.");
  }
});

// Fetch Predictor Agent Accumulated Builder Fees
app.get('/api/predictor/balance', async (req, res) => {
  try {
    const db = readDb();
    const balanceUSDC = db.ledger[PREDICTOR_AGENT_ADDRESS] || 0.0;
    const balanceEURC = db.ledgerEURC[PREDICTOR_AGENT_ADDRESS] || 0.0;
    res.json({
      address: PREDICTOR_AGENT_ADDRESS,
      usdc: balanceUSDC,
      eurc: balanceEURC
    });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to fetch AI Advisor balance.");
  }
});

// Arc Testnet Faucet — proxies to Circle's official /v1/faucet/drips endpoint
// Falls back to mock mode if CIRCLE_API_KEY is not configured
const arcFaucetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 10, // 10 claims per IP per hour max (Circle's own rate limits are stricter)
  message: { error: 'Faucet rate limit exceeded. Try again in 1 hour.' }
});

app.post('/api/arc-faucet', arcFaucetLimiter, async (req, res) => {
  const { address, token } = req.body;

  if (!address) {
    return res.status(400).json({ error: 'Missing wallet address.' });
  }

  if (!ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Invalid wallet address format.' });
  }

  const tokenSymbol = (token || 'USDC').toUpperCase();
  if (tokenSymbol !== 'USDC' && tokenSymbol !== 'EURC') {
    return res.status(400).json({ error: 'Unsupported token. Must be USDC or EURC.' });
  }

  const normalizedAddress = address.toLowerCase();

  // Enforce 24h per-address cooldown
  const lastClaim = faucetCooldowns.get(normalizedAddress);
  if (lastClaim) {
    const elapsed = Date.now() - lastClaim;
    if (elapsed < FAUCET_COOLDOWN_MS) {
      const remaining = Math.ceil((FAUCET_COOLDOWN_MS - elapsed) / 1000 / 60);
      return res.status(429).json({
        error: `Faucet cooldown active. You can claim again in ${remaining} minutes.`,
        cooldownMinutes: remaining
      });
    }
  }

  const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;

  // --- REAL MODE: Call Circle's official faucet API ---
  if (CIRCLE_API_KEY) {
    try {
      const body = {
        address,
        blockchain: 'ARC-TESTNET',
        usdc: tokenSymbol === 'USDC',
        eurc: tokenSymbol === 'EURC',
        native: false
      };

      const response = await fetch('https://api.circle.com/v1/faucet/drips', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CIRCLE_API_KEY}`
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        const errMsg = data?.message || data?.error || response.statusText || 'Circle faucet request failed.';
        console.warn(`[ArcFaucet] Circle API returned ${response.status}: ${errMsg}`);

        // 403 = account not mainnet-verified — fallback to mock automatically
        if (response.status === 403) {
          console.warn('[ArcFaucet] Account not mainnet-verified. Falling back to mock mode.');
          // Fall through to mock mode below
        } else {
          // Any other error (429 rate limit, 400 bad request, 500) — return to client
          return res.status(response.status).json({
            error: errMsg,
            hint: response.status === 429
              ? 'Circle faucet rate limit hit. Try again later or use faucet.circle.com manually.'
              : 'Check your Circle API key or try the manual faucet at faucet.circle.com.'
          });
        }
      } else {
        // Record successful claim for cooldown
        faucetCooldowns.set(normalizedAddress, Date.now());

        console.log(`[ArcFaucet] ✅ Claimed ${tokenSymbol} for ${address} via Circle API`);
        return res.json({
          success: true,
          mode: 'real',
          token: tokenSymbol,
          address,
          message: `✅ ${tokenSymbol} successfully sent to your wallet on Arc Testnet! Check your balance in ~30 seconds.`,
          circleResponse: data
        });
      }

    } catch (err) {
      console.error('[ArcFaucet] Circle API call failed:', err.message);
      // Network error — fall through to mock mode
      console.warn('[ArcFaucet] Network error reaching Circle. Falling back to mock mode.');
    }
  }

  // --- MOCK MODE: Credit balance in local ledger ---
  // (reached when: no API key, 403 from Circle, or network error)
  try {
    const MOCK_FAUCET_AMOUNT = tokenSymbol === 'EURC' ? 50 : 100;
    const db = readDb();

    if (tokenSymbol === 'EURC') {
      db.ledgerEURC[normalizedAddress] = parseFloat(((db.ledgerEURC[normalizedAddress] || 0) + MOCK_FAUCET_AMOUNT).toFixed(2));
    } else {
      db.ledger[normalizedAddress] = parseFloat(((db.ledger[normalizedAddress] || 0) + MOCK_FAUCET_AMOUNT).toFixed(2));
    }
    writeDb(db);

    // Still apply cooldown in mock mode to simulate real behaviour
    faucetCooldowns.set(normalizedAddress, Date.now());

    const newBalance = tokenSymbol === 'EURC' ? db.ledgerEURC[normalizedAddress] : db.ledger[normalizedAddress];
    const hasFaucetKey = !!process.env.CIRCLE_API_KEY;
    const mockReason = hasFaucetKey
      ? `Circle account requires mainnet verification for faucet API. Using mock credits instead.`
      : `No CIRCLE_API_KEY set — using mock credits.`;

    console.log(`[ArcFaucet] Mock: Credited ${MOCK_FAUCET_AMOUNT} ${tokenSymbol} to ${normalizedAddress} (${mockReason})`);

    return res.json({
      success: true,
      mode: 'mock',
      token: tokenSymbol,
      address: normalizedAddress,
      newBalance,
      message: `🧪 ${MOCK_FAUCET_AMOUNT} ${tokenSymbol} credited to your spectator wallet! (${mockReason})\n\nFor real Arc Testnet tokens, visit faucet.circle.com and select Arc Testnet.`
    });
  } catch (err) {
    return sendSanitizedError(res, err, 'Mock faucet failed.');
  }
});

// Get all battles history
app.get('/api/battles', (req, res) => {
  try {
    const db = readDb();
    const sortedBattles = [...db.battles].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(sortedBattles);
  } catch (err) {
    sendSanitizedError(res, err, "Failed to fetch battle ledger.");
  }
});

// Withdraw funds from Gladiator wallet to User Wallet (authenticated via signature)
app.post('/api/withdraw', verifyOwnerSignature, async (req, res) => {
  const { gladiatorId, destinationAddress, amount } = req.body;

  if (!gladiatorId || !destinationAddress || !amount) {
    return res.status(400).json({ error: "Missing required fields: gladiatorId, destinationAddress, amount" });
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum)) {
    return res.status(400).json({ error: "Withdraw amount must be a positive finite number." });
  }

  if (!ethers.isAddress(destinationAddress)) {
    return res.status(400).json({ error: "Invalid destination address format." });
  }

  try {
    const db = readDb();
    const gladiator = db.gladiators.find(g => g.id === gladiatorId);

    if (!gladiator) {
      return res.status(404).json({ error: "Gladiator not found" });
    }

    // Verify ownership of the gladiator
    if (gladiator.ownerAddress && gladiator.ownerAddress.toLowerCase() !== req.ownerAddress.toLowerCase()) {
      return res.status(403).json({ error: "Forbidden: You do not own this gladiator." });
    }

    const transferResult = await transferUSDC(gladiator.walletAddress, destinationAddress, amountNum);
    res.json({ success: true, txHash: transferResult.txHash });
  } catch (err) {
    sendSanitizedError(res, err, "Withdrawal execution failed.");
  }
});

// Store items preset configurations
const STORE_ITEMS = [
  { id: 'katana', name: 'Plasma Katana', effect: { attack: 4 }, cost: 8.0, token: 'USDC' },
  { id: 'aegis', name: 'Reactive Aegis', effect: { defense: 5 }, cost: 10.0, token: 'USDC' },
  { id: 'thrusters', name: 'Booster Thrusters', effect: { speed: 4 }, cost: 8.0, token: 'USDC' }
];

const PLATFORM_FEE_ADDRESS = "0x98fE4b830Ed6DFE2E20a6Cd196e8d1C0eD327B66";

// Get available store items
app.get('/api/store/items', (req, res) => {
  res.json(STORE_ITEMS);
});

// Gladiator buys gear autonomously or triggered
app.post('/api/gladiators/:id/buy-gear', async (req, res) => {
  const { id } = req.params;
  const { itemId } = req.body;
  const item = STORE_ITEMS.find(i => i.id === itemId);

  if (!item) {
    return res.status(400).json({ error: "Invalid item ID." });
  }

  try {
    const db = readDb();
    const gladIdx = db.gladiators.findIndex(g => g.id === id);
    if (gladIdx === -1) {
      return res.status(404).json({ error: "Gladiator not found." });
    }
    const gladiator = db.gladiators[gladIdx];

    if (gladiator.equipment && gladiator.equipment.includes(itemId)) {
      return res.status(400).json({ error: "Gladiator already owns this equipment." });
    }

    const balanceUSDC = await getUSDCBalance(gladiator.walletAddress);
    if (balanceUSDC < item.cost) {
      return res.status(400).json({ error: `Insufficient gladiator funds: needs ${item.cost} USDC, has ${balanceUSDC} USDC.` });
    }

    // Transfer item cost to platform fee address
    const tx = await transferUSDC(gladiator.walletAddress, PLATFORM_FEE_ADDRESS, item.cost);

    if (!gladiator.equipment) gladiator.equipment = [];
    gladiator.equipment.push(itemId);

    logToGladiatorLedger(id, 'purchase', -item.cost, 'USDC', `Purchased gear: ${item.name} for ${item.cost} USDC.`, tx.txHash);
    writeDb(db);

    res.json({
      success: true,
      message: `Successfully purchased and equipped ${item.name}!`,
      gladiator
    });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to purchase gear.");
  }
});

// Sponsor Staking
app.post('/api/gladiators/:id/stake', async (req, res) => {
  const { id } = req.params;
  const { userAddress, amount, token } = req.body;

  if (!userAddress || !amount) {
    return res.status(400).json({ error: "Missing required fields: userAddress, amount" });
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum)) {
    return res.status(400).json({ error: "Amount must be a positive finite number." });
  }

  const tokenSymbol = token || 'USDC';
  if (tokenSymbol !== 'USDC' && tokenSymbol !== 'EURC') {
    return res.status(400).json({ error: "Unsupported token. Must be USDC or EURC." });
  }

  const normalizedUser = userAddress.toLowerCase();

  try {
    const db = readDb();
    const gladiator = db.gladiators.find(g => g.id === id);
    if (!gladiator) {
      return res.status(404).json({ error: "Gladiator not found." });
    }

    if (tokenSymbol === 'EURC') {
      const balance = db.ledgerEURC[normalizedUser] || 0.0;
      if (balance < amountNum) return res.status(400).json({ error: "Insufficient spectator EURC balance." });
      db.ledgerEURC[normalizedUser] = parseFloat((balance - amountNum).toFixed(2));
    } else {
      const balance = db.ledger[normalizedUser] || 0.0;
      if (balance < amountNum) return res.status(400).json({ error: "Insufficient spectator USDC balance." });
      db.ledger[normalizedUser] = parseFloat((balance - amountNum).toFixed(2));
    }

    if (!gladiator.stakingPool) {
      gladiator.stakingPool = { totalStaked: 0.0, stakers: {} };
    }
    gladiator.stakingPool.totalStaked = parseFloat((gladiator.stakingPool.totalStaked + amountNum).toFixed(2));
    gladiator.stakingPool.stakers[normalizedUser] = parseFloat(((gladiator.stakingPool.stakers[normalizedUser] || 0.0) + amountNum).toFixed(2));

    logToGladiatorLedger(id, 'sponsorship', amountNum, tokenSymbol, `Received sponsorship staking from ${userAddress.slice(0, 8)}...`);
    writeDb(db);

    res.json({
      success: true,
      message: `Successfully staked ${amountNum} ${tokenSymbol} to sponsor ${gladiator.name}!`,
      stakingPool: gladiator.stakingPool,
      userBalance: tokenSymbol === 'EURC' ? db.ledgerEURC[normalizedUser] : db.ledger[normalizedUser]
    });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to stake funds.");
  }
});

// Unstake sponsorship funds (signature verified)
app.post('/api/gladiators/:id/unstake', verifyOwnerSignature, async (req, res) => {
  const { id } = req.params;
  const { amount, token } = req.body;
  const userAddress = req.ownerAddress; // MetaMask verified

  if (!amount) {
    return res.status(400).json({ error: "Missing required fields: amount" });
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum)) {
    return res.status(400).json({ error: "Amount must be a positive finite number." });
  }

  const tokenSymbol = token || 'USDC';
  const normalizedUser = userAddress.toLowerCase();

  try {
    const db = readDb();
    const gladiator = db.gladiators.find(g => g.id === id);
    if (!gladiator) {
      return res.status(404).json({ error: "Gladiator not found." });
    }

    if (!gladiator.stakingPool || !gladiator.stakingPool.stakers[normalizedUser]) {
      return res.status(400).json({ error: "You have no staked funds in this gladiator." });
    }

    const currentlyStaked = gladiator.stakingPool.stakers[normalizedUser];
    if (currentlyStaked < amountNum) {
      return res.status(400).json({ error: `Cannot unstake ${amountNum} ${tokenSymbol}: you only have ${currentlyStaked} staked.` });
    }

    gladiator.stakingPool.stakers[normalizedUser] = parseFloat((currentlyStaked - amountNum).toFixed(2));
    if (gladiator.stakingPool.stakers[normalizedUser] <= 0) {
      delete gladiator.stakingPool.stakers[normalizedUser];
    }
    gladiator.stakingPool.totalStaked = parseFloat((gladiator.stakingPool.totalStaked - amountNum).toFixed(2));

    if (tokenSymbol === 'EURC') {
      db.ledgerEURC[normalizedUser] = parseFloat(((db.ledgerEURC[normalizedUser] || 0.0) + amountNum).toFixed(2));
    } else {
      db.ledger[normalizedUser] = parseFloat(((db.ledger[normalizedUser] || 0.0) + amountNum).toFixed(2));
    }

    logToGladiatorLedger(id, 'sponsorship', -amountNum, tokenSymbol, `Sponsorship unstaked by ${userAddress.slice(0, 8)}...`);
    writeDb(db);

    res.json({
      success: true,
      message: `Successfully unstaked ${amountNum} ${tokenSymbol}!`,
      stakingPool: gladiator.stakingPool,
      userBalance: tokenSymbol === 'EURC' ? db.ledgerEURC[normalizedUser] : db.ledger[normalizedUser]
    });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to unstake funds.");
  }
});

// Create Tournament Bracket (8 gladiators)
app.post('/api/tournaments', async (req, res) => {
  try {
    const db = readDb();
    let roster = [...db.gladiators];

    // If we have fewer than 8 gladiators, fill them up with system/mock ones
    const systemGladTemplates = [
      { name: "Spartacus", role: "Cyber-Retiarius", strategy: "Balanced", personality: "Noble-Samurai" },
      { name: "Crixus", role: "Cyber-Dimachaerus", strategy: "Aggressive", personality: "Savage-Berserker" },
      { name: "Gannicus", role: "Cyber-Thraex", strategy: "Balanced", personality: "Degen-Rogue" },
      { name: "Flamma", role: "Cyber-Murmillo", strategy: "Defensive", personality: "Stoic-Mech" },
      { name: "Verus", role: "Cyber-Retiarius", strategy: "Balanced", personality: "Degen-Rogue" },
      { name: "Priscus", role: "Cyber-Murmillo", strategy: "Defensive", personality: "Noble-Samurai" },
      { name: "Spiculus", role: "Cyber-Dimachaerus", strategy: "Aggressive", personality: "Savage-Berserker" },
      { name: "Commodus", role: "Cyber-Thraex", strategy: "Balanced", personality: "Stoic-Mech" }
    ];
    let sysIdx = 0;
    while (roster.length < 8) {
      const template = systemGladTemplates[sysIdx % systemGladTemplates.length];
      const id = `glad_sys_${Date.now()}_${sysIdx}`;
      const version = Math.floor(sysIdx / systemGladTemplates.length);
      const name = template.name + (version > 0 ? ` v${version + 1}` : "");
      const role = template.role;
      const strategy = template.strategy;
      const personality = template.personality;
      
      const walletInfo = await createGladiatorWallet(id);
      
      let stats = { hp: 100, attack: 15, defense: 10, speed: 12 };
      if (role === "Cyber-Dimachaerus" || role === "Cyber-Samurai") {
        stats.attack = 18; stats.speed = 15; stats.defense = 8;
      } else if (role === "Cyber-Retiarius" || role === "Netrunner") {
        stats.attack = 14; stats.speed = 18; stats.defense = 6;
      } else if (role === "Cyber-Murmillo" || role === "Mech-Tank") {
        stats.attack = 15; stats.speed = 8; stats.defense = 16;
      } else if (role === "Cyber-Thraex") {
        stats.attack = 16; stats.speed = 14; stats.defense = 10;
      }

      const newSystemGlad = {
        id,
        name,
        role,
        strategy,
        attributes: { aggression: 50, defense: 30, speed: 20 },
        stats,
        walletAddress: walletInfo.address,
        walletId: walletInfo.walletId,
        isMock: true,
        wins: 0,
        losses: 0,
        personality,
        createdAt: new Date().toISOString()
      };
      
      db.gladiators.push(newSystemGlad);
      roster.push(newSystemGlad);
      sysIdx++;
    }

    const selectedGladiators = roster.slice(0, 8);
    const tournamentId = `tour_${Date.now()}`;
    const newTournament = {
      id: tournamentId,
      status: "active",
      gladiators: selectedGladiators.map(g => g.id),
      round: 1,
      matches: {
        round1: [
          { id: "m1", gladA: selectedGladiators[0].id, gladB: selectedGladiators[1].id, winner: null, battleRecord: null },
          { id: "m2", gladA: selectedGladiators[2].id, gladB: selectedGladiators[3].id, winner: null, battleRecord: null },
          { id: "m3", gladA: selectedGladiators[4].id, gladB: selectedGladiators[5].id, winner: null, battleRecord: null },
          { id: "m4", gladA: selectedGladiators[6].id, gladB: selectedGladiators[7].id, winner: null, battleRecord: null }
        ],
        round2: [
          { id: "m5", gladA: null, gladB: null, winner: null, battleRecord: null },
          { id: "m6", gladA: null, gladB: null, winner: null, battleRecord: null }
        ],
        round3: [
          { id: "m7", gladA: null, gladB: null, winner: null, battleRecord: null }
        ]
      },
      bettingPool: {
        totalPool: 0.0,
        bets: []
      },
      winner: null,
      createdAt: new Date().toISOString()
    };

    const finalDb = readDb();
    finalDb.gladiators = db.gladiators;
    finalDb.tournaments.push(newTournament);
    writeDb(finalDb);

    res.status(201).json(newTournament);
  } catch (err) {
    sendSanitizedError(res, err, "Failed to create tournament.");
  }
});

// Step Tournament Match Simulation
app.post('/api/tournaments/:id/step', async (req, res) => {
  const { id } = req.params;

  try {
    const db = readDb();
    const tournament = db.tournaments.find(t => t.id === id);
    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found." });
    }

    if (tournament.status !== 'active') {
      return res.status(400).json({ error: "Tournament is not active." });
    }

    let currentRoundMatches = [];
    if (tournament.round === 1) currentRoundMatches = tournament.matches.round1;
    else if (tournament.round === 2) currentRoundMatches = tournament.matches.round2;
    else if (tournament.round === 3) currentRoundMatches = tournament.matches.round3;

    const pendingMatch = currentRoundMatches.find(m => m.winner === null);
    if (!pendingMatch) {
      return res.status(400).json({ error: "No pending matches in current round. Please advance round." });
    }

    // Run the battle
    const battleRecord = await runBattle(pendingMatch.gladA, pendingMatch.gladB, false);
    pendingMatch.winner = battleRecord.winnerId;
    pendingMatch.battleRecord = battleRecord;

    const matchWinnerId = battleRecord.winnerId;

    // Survivor Auto-upgrade / marketplace purchase
    try {
      const winnerGlad = db.gladiators.find(g => g.id === matchWinnerId);
      const balanceUSDC = await getUSDCBalance(winnerGlad.walletAddress);

      const affordableItem = STORE_ITEMS.find(item => 
        (!winnerGlad.equipment || !winnerGlad.equipment.includes(item.id)) && 
        balanceUSDC >= item.cost
      );

      if (affordableItem) {
        const tx = await transferUSDC(winnerGlad.walletAddress, PLATFORM_FEE_ADDRESS, affordableItem.cost);
        if (!winnerGlad.equipment) winnerGlad.equipment = [];
        winnerGlad.equipment.push(affordableItem.id);
        logToGladiatorLedger(winnerGlad.id, 'purchase', -affordableItem.cost, 'USDC', `Auto-purchased tournament gear: ${affordableItem.name}.`, tx.txHash);
      } else if (balanceUSDC >= 5.0) {
        const stats = ["attack", "defense", "speed"];
        const lowestStat = stats.reduce((lowest, stat) => winnerGlad.stats[stat] < winnerGlad.stats[lowest] ? stat : lowest, "attack");
        const tx = await transferUSDC(winnerGlad.walletAddress, PLATFORM_FEE_ADDRESS, 5.0);
        winnerGlad.stats[lowestStat] += 2;
        logToGladiatorLedger(winnerGlad.id, 'upgrade', -5.0, 'USDC', `Auto-upgraded stat: +2 ${lowestStat}.`, tx.txHash);
      }
    } catch (upgradeErr) {
      console.warn("[Tournament Step] Survivor auto-upgrade failed:", upgradeErr.message);
    }

    // Check if round is completed
    const roundDone = currentRoundMatches.every(m => m.winner !== null);
    if (roundDone) {
      if (tournament.round === 1) {
        tournament.round = 2;
        tournament.matches.round2[0].gladA = tournament.matches.round1[0].winner;
        tournament.matches.round2[0].gladB = tournament.matches.round1[1].winner;
        tournament.matches.round2[1].gladA = tournament.matches.round1[2].winner;
        tournament.matches.round2[1].gladB = tournament.matches.round1[3].winner;
      } else if (tournament.round === 2) {
        tournament.round = 3;
        tournament.matches.round3[0].gladA = tournament.matches.round2[0].winner;
        tournament.matches.round3[0].gladB = tournament.matches.round2[1].winner;
      } else if (tournament.round === 3) {
        tournament.status = 'completed';
        tournament.winner = tournament.matches.round3[0].winner;

        // Settle tournament champion bets
        const winningGladId = tournament.winner;
        const bets = tournament.bettingPool.bets;
        const totalWinningBets = bets.filter(b => b.gladiatorId === winningGladId).reduce((sum, b) => sum + b.amount, 0);

        if (totalWinningBets > 0) {
          bets.forEach(bet => {
            if (bet.gladiatorId === winningGladId) {
              const share = bet.amount / totalWinningBets;
              const payout = parseFloat((tournament.bettingPool.totalPool * share).toFixed(2));
              if (bet.token === 'EURC') {
                db.ledgerEURC[bet.userAddress] = parseFloat(((db.ledgerEURC[bet.userAddress] || 0.0) + payout).toFixed(2));
              } else {
                db.ledger[bet.userAddress] = parseFloat(((db.ledger[bet.userAddress] || 0.0) + payout).toFixed(2));
              }
            }
          });
        }
      }
    }

    writeDb(db);
    res.json({ tournament, battleRecord });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to simulate tournament step.");
  }
});

// Tournament Betting (signature verified)
app.post('/api/tournaments/:id/bet', verifyOwnerSignature, async (req, res) => {
  const { id } = req.params;
  const { gladiatorId, amount, token } = req.body;
  const userAddress = req.ownerAddress; // signature verified

  if (!gladiatorId || !amount) {
    return res.status(400).json({ error: "Missing required fields: gladiatorId, amount" });
  }

  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum)) {
    return res.status(400).json({ error: "Amount must be a positive finite number." });
  }

  const tokenSymbol = token || 'USDC';
  const normalizedUser = userAddress.toLowerCase();

  try {
    const db = readDb();
    const tournament = db.tournaments.find(t => t.id === id);
    if (!tournament) {
      return res.status(404).json({ error: "Tournament not found." });
    }

    if (tournament.status !== 'active' || tournament.round > 1) {
      return res.status(400).json({ error: "Betting is only open during Quarterfinals (Round 1)." });
    }

    if (tokenSymbol === 'EURC') {
      const balance = db.ledgerEURC[normalizedUser] || 0.0;
      if (balance < amountNum) return res.status(400).json({ error: "Insufficient EURC balance." });
      db.ledgerEURC[normalizedUser] = parseFloat((balance - amountNum).toFixed(2));
    } else {
      const balance = db.ledger[normalizedUser] || 0.0;
      if (balance < amountNum) return res.status(400).json({ error: "Insufficient USDC balance." });
      db.ledger[normalizedUser] = parseFloat((balance - amountNum).toFixed(2));
    }

    tournament.bettingPool.totalPool = parseFloat((tournament.bettingPool.totalPool + amountNum).toFixed(2));
    tournament.bettingPool.bets.push({
      userAddress: normalizedUser,
      gladiatorId,
      amount: amountNum,
      token: tokenSymbol
    });

    writeDb(db);
    res.json({ success: true, tournament });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to place tournament bet.");
  }
});

// Fetch active tournament
app.get('/api/tournaments/active', (req, res) => {
  try {
    const db = readDb();
    const active = db.tournaments.find(t => t.status === 'active');
    res.json(active || null);
  } catch (err) {
    sendSanitizedError(res, err, "Failed to fetch active tournament.");
  }
});

// Syndicate Sponsorship (signature verified)
app.post('/api/syndicates/sponsor', verifyOwnerSignature, async (req, res) => {
  const { sponsorGladId, rookieGladId } = req.body;
  const ownerAddress = req.ownerAddress; // signature verified

  if (!sponsorGladId || !rookieGladId) {
    return res.status(400).json({ error: "Missing sponsorGladId or rookieGladId" });
  }

  try {
    const db = readDb();
    const sponsor = db.gladiators.find(g => g.id === sponsorGladId);
    const rookie = db.gladiators.find(g => g.id === rookieGladId);

    if (!sponsor || !rookie) {
      return res.status(404).json({ error: "Sponsor or rookie gladiator not found." });
    }

    if (sponsor.ownerAddress && sponsor.ownerAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      return res.status(403).json({ error: "Forbidden: You do not own the sponsor gladiator." });
    }

    if (rookie.syndicate && rookie.syndicate.parentSponsor) {
      return res.status(400).json({ error: "Rookie gladiator is already sponsored." });
    }

    const sponsorBalance = await getUSDCBalance(sponsor.walletAddress);
    if (sponsorBalance < 20.0) {
      return res.status(400).json({ error: `Sponsor has insufficient funds: has ${sponsorBalance} USDC, needs 20.0 USDC.` });
    }

    // Execute transfer
    const tx = await transferUSDC(sponsor.walletAddress, rookie.walletAddress, 20.0);

    if (!sponsor.syndicate) sponsor.syndicate = { sponsoredRookies: [], parentSponsor: null };
    if (!rookie.syndicate) rookie.syndicate = { sponsoredRookies: [], parentSponsor: null };

    sponsor.syndicate.sponsoredRookies.push(rookieGladId);
    rookie.syndicate.parentSponsor = sponsorGladId;

    logToGladiatorLedger(sponsorGladId, 'syndicate_payout', -20.0, 'USDC', `Sponsored rookie gladiator: ${rookie.name}`, tx.txHash);
    logToGladiatorLedger(rookieGladId, 'sponsorship', 20.0, 'USDC', `Received syndicate sponsorship from ${sponsor.name}`, tx.txHash);

    writeDb(db);
    res.json({ success: true, sponsor, rookie });
  } catch (err) {
    sendSanitizedError(res, err, "Failed to establish syndicate sponsorship.");
  }
});

// Telemetry route to capture uncaught client-side runtime errors
app.post('/api/client-error', (req, res) => {
  console.error("\n[Telemetry] === CLIENT-SIDE RUNTIME EXCEPTION ===");
  console.error("[Message]:", req.body.message);
  console.error("[Stack]:", req.body.stack);
  console.error("[Telemetry] =====================================\n");
  res.json({ success: true });
});

// Export app for Vercel serverless functions
export default app;

// Only listen when running directly (not in serverless environment)
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`[ArcadeServer] Server running on http://localhost:${PORT}`);
  });
}
