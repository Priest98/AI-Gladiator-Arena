import { readDb, writeDb, transferUSDC, logToGladiatorLedger } from './circleService.js';
import { ethers } from 'ethers';
import dotenv from 'dotenv';

dotenv.config();

const PLATFORM_FEE_ADDRESS = "0x98fE4b830Ed6DFE2E20a6Cd196e8d1C0eD327B66"; // Mock / Real treasury
const WAGER_AMOUNT = 5.0; // 5 USDC wager
const PRIZE_AMOUNT = 9.0;  // 9 USDC goes to winner (1 USDC platform fee)

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Cyberpunk flavor responses for fallback mode
const FLAVOR_TEXTS = {
  "Cyber-Dimachaerus": {
    ATTACK: [
      "slashes rapidly with twin mono-molecular swords, carving cross-shaped incisions",
      "delivers a dual-blade flurry, forcing the opponent to retreat",
      "performs a swift twin-strike, targetting weak points in armor seams"
    ],
    DEFEND: [
      "crosses their dual blades in a parrying stance, deflecting incoming kinetic force",
      "performs a combat-roll to evade, using twin swords to guard their vital nodes",
      "activates a localized kinetic deflection field around their dual gauntlets"
    ],
    HEAL: [
      "injects a quick-acting nano-stasis stim into their neck port",
      "initiates a localized subsystem patch, sealing leaking hydraulic fluid",
      "triggers their emergency bio-reconstructor, synthesizing healthy cells"
    ],
    SPECIAL: [
      "unleashes the 'Twin Tempest' protocol, executing a whirlwind of high-frequency cuts",
      "performs a synchronized cross-strike with both blades overloaded with plasma energy"
    ]
  },
  "Cyber-Retiarius": {
    ATTACK: [
      "throws a weighted carbon-fiber net to entangle the target, followed by a trident thrust",
      "jabs with their electro-charged trident, sparking electrical system arcs",
      "discharges a localized net-hack, burning the target's neural processors"
    ],
    DEFEND: [
      "deploys an ICE firewall net, encrypting their location and scrambling sensor targetings",
      "uses their trident to deflect incoming physical projectiles",
      "initiates a decoy holograph, confusing the target's target acquisition system"
    ],
    HEAL: [
      "allocates reserve CPU cycles to run automated biological repairs",
      "injects a synthetic adrenaline cocktail to bypass cyberware strain",
      "reboots their core CPU, discharging heat and restoring unit stability"
    ],
    SPECIAL: [
      "launches a fully-charged Net hack that completely locks the opponent's joints for a massive shock",
      "deploys a 'Black Daemon' virus, draining energy and dealing huge damage to the target"
    ]
  },
  "Cyber-Murmillo": {
    ATTACK: [
      "thrusts forward with a heavy thermal-gladius, piercing defense shields",
      "slashes with a heavy vibro-blade, leveraging mechanical torque",
      "delivers a shield-bash with their titanium scutum, shattering local ground"
    ],
    DEFEND: [
      "locks down behind their massive active-reactive scutum shield, absorbing kinetic impact",
      "braces their heavy titanium chassis, dampening incoming damage",
      "fires an aerosol smoke canister, dispersing visual and thermal targeting lasers"
    ],
    HEAL: [
      "initiates an auxiliary backup generator, replenishing depleted power cells",
      "deploys automated welding micro-drones to fix structural frame damage",
      "cools their primary generator core, reclaiming lost energy"
    ],
    SPECIAL: [
      "charges up their ultimate seismic stomp, releasing a massive shockwave from the shield generator",
      "unleashes a shield-overload blast, releasing a high-decibel acoustic wave"
    ]
  },
  "Cyber-Thraex": {
    ATTACK: [
      "strikes with their curved plasma sica, bypassing shield margins",
      "performs an agile jump-slash, cutting downward with high-frequency steel",
      "delivers a sica-hook swipe to dismantle the opponent's armor plating"
    ],
    DEFEND: [
      "braces their compact thracedian buckler shield, absorbing incoming shocks",
      "performs a sidestep dash, using their buckler to deflect the line of fire",
      "activates a miniature magnetic shield generator mounted on their arm"
    ],
    HEAL: [
      "re-routes redundant power circuits to restore functional systems",
      "injects an emergency repair stim, purging corrupt data lines",
      "triggers nano-repair micro-bots to repair mechanical integrity"
    ],
    SPECIAL: [
      "unleashes a critical sica overdrive attack, executing a curved piercing strike",
      "leaps high, utilizing booster thrusters to deliver an explosive downward shock"
    ]
  }
};

// Legacy support mappings
FLAVOR_TEXTS["Cyber-Samurai"] = FLAVOR_TEXTS["Cyber-Dimachaerus"];
FLAVOR_TEXTS["Netrunner"] = FLAVOR_TEXTS["Cyber-Retiarius"];
FLAVOR_TEXTS["Mech-Tank"] = FLAVOR_TEXTS["Cyber-Murmillo"];

const TAUNTS = {
  "Degen-Rogue": [
    "Easiest USDC of my life!",
    "You bet against me? Degen mistake!",
    "Nice speed module. Did you buy it at a junkyard?",
    "Sending you straight to the recycle bin!"
  ],
  "Noble-Samurai": [
    "An honorable clash. Face me!",
    "My blade strikes true.",
    "For honor and my sponsor!",
    "Respect your opponent, even in defeat."
  ],
  "Stoic-Mech": [
    "Calculating victory probability: 99.8%.",
    "Structural integrity normal. Upgrades functioning.",
    "Error: opponent combat routines obsolete.",
    "Executing termination protocols."
  ],
  "Savage-Berserker": [
    "SMASH AND CRUSH!",
    "MORE PLASMA! MORE BLOOD!",
    "YOU CANNOT RUN FROM MY AXE!",
    "GRAAAAH! DIE, METAL CAN!"
  ]
};

// Seeded PRNG for VRF combat rolls
export function createSeededPRNG(seedString) {
  let h = 0;
  for (let i = 0; i < seedString.length; i++) {
    h = Math.imul(31, h) + seedString.charCodeAt(i) | 0;
  }
  return function() {
    let t = h += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Executes a turn decision using OpenAI API, or falls back to rule-based logic.
 */
async function queryStrategy(gladiator, opponent, history, roundNum, random) {
  const aggression = gladiator.attributes?.aggression ?? 50;
  const defense = gladiator.attributes?.defense ?? 30;
  const speed = gladiator.attributes?.speed ?? 20;
  const customPrompt = gladiator.customPrompt ?? "";

  const opponentAggression = opponent.attributes?.aggression ?? 50;
  const opponentDefense = opponent.attributes?.defense ?? 30;
  const opponentSpeed = opponent.attributes?.speed ?? 20;

  const strategyPrompt = `
    You are an AI Gladiator in a turn-based cyberpunk arena battle.
    Your Name: ${gladiator.name}
    Your Class: ${gladiator.role}
    Your Stats: HP ${gladiator.hp}/100, Base Attack: ${gladiator.stats?.attack || 10}, Base Defense: ${gladiator.stats?.defense || 10}, Base Speed: ${gladiator.stats?.speed || 10}
    Your Personality: ${gladiator.personality || "Stoic-Mech"}
    Your Active Equipment: ${JSON.stringify(gladiator.equipment || [])}
    Your Behavior Profile (out of 100): Aggression ${aggression}, Defense ${defense}, Speed/Tactics ${speed}
    Your Custom Directives: ${customPrompt || "No custom directive. Play optimally based on your class."}

    Opponent Name: ${opponent.name}
    Opponent Class: ${opponent.role}
    Opponent Stats: HP ${opponent.hp}/100
    Opponent Behavior Profile (out of 100): Aggression ${opponentAggression}, Defense ${opponentDefense}, Speed/Tactics ${opponentSpeed}
    
    Battle History of previous rounds:
    ${JSON.stringify(history)}

    Choose your action for Round ${roundNum}.
    Available actions:
    - "ATTACK": Standard offensive move (deals damage based on your class).
    - "DEFEND": Reduces damage taken on the next turn.
    - "HEAL": Restores health (max 2 times per battle). Current heals used: ${gladiator.healsUsed || 0}/2.
    - "SPECIAL": A high-risk, high-reward move (50% chance for massive damage, 50% chance to miss).

    Respond in raw JSON format matching this schema:
    {
      "thinking": "A step-by-step cognitive reasoning trace in the third person analyzing round history, HP differentials, class counters, and tactical maneuvers. Act as an advanced combat subroutine. Keep it under 250 words.",
      "action": "ATTACK" | "DEFEND" | "HEAL" | "SPECIAL",
      "narrative": "A short, exciting, cyberpunk description of your action in the third person.",
      "taunt": "A short, persona-specific battle cry or trash-talk in the first person (max 10 words) matching your personality."
    }
  `;

  if (OPENAI_API_KEY) {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: [{ role: "user", content: strategyPrompt }],
          response_format: { type: "json_object" }
        })
      });
      const data = await response.json();
      return JSON.parse(data.choices[0].message.content);
    } catch (err) {
      console.warn("[BattleEngine] LLM query failed, falling back to rule-based:", err.message);
    }
  }

  // Fallback Weighted Rule-Based Logic
  let action = "ATTACK";
  const healsUsed = gladiator.healsUsed || 0;

  // Health threshold to heal: lower defense makes healing triggered at higher health
  const healThreshold = defense > 60 ? 40 : 30;
  
  if (gladiator.hp < healThreshold && healsUsed < 2) {
    action = "HEAL";
  } else {
    // Weight actions based on behavior parameters
    const wAttack = aggression * 1.5 + speed * 0.5 + 10;
    const wDefend = defense * 1.8 + 10;
    const wSpecial = aggression * 1.2 + speed * 0.3;

    const total = wAttack + wDefend + wSpecial;
    const rand = random() * total;

    if (rand < wAttack) {
      action = "ATTACK";
    } else if (rand < wAttack + wDefend) {
      action = "DEFEND";
    } else {
      action = "SPECIAL";
    }
  }

  // Safeguard heals count
  if (action === "HEAL" && healsUsed >= 2) {
    action = "ATTACK";
  }

  // Heuristic reasoning trace fallback (Combat-R1 style)
  let thinking = "";
  if (action === "HEAL") {
    thinking = `[Combat-R1] Gladiator HP (${gladiator.hp}/100) below threshold. Custom directive check: prioritising biological repair drones. Resolving to HEAL.`;
  } else if (action === "DEFEND") {
    thinking = `[Combat-R1] Analyzing defensive parameters. Defense slider is set to ${defense}. Threat vector mitigation protocol: DEFEND active.`;
  } else if (action === "SPECIAL") {
    thinking = `[Combat-R1] Aggression index (${aggression}) suggests high damage payoff. Overdriving generator core to trigger SPECIAL combat override.`;
  } else {
    thinking = `[Combat-R1] Scanning tactical weaknesses. Standard ATTACK protocols selected to maximize reliability and apply continuous damage pressure.`;
  }

  // Generate narrative from class database
  const classFlavors = FLAVOR_TEXTS[gladiator.role] || FLAVOR_TEXTS["Cyber-Samurai"];
  const list = classFlavors[action];
  const narrativeText = list[Math.floor(random() * list.length)];
  const narrative = `${gladiator.name} ${narrativeText}.`;

  const persona = gladiator.personality || "Stoic-Mech";
  const personaList = TAUNTS[persona] || TAUNTS["Stoic-Mech"];
  const taunt = personaList[Math.floor(random() * personaList.length)];

  return { thinking, action, narrative, taunt };
}

/**
 * Runs a complete simulation of a battle.
 * Transfers USDC on Arc L1 for the wagers.
 * Logs combat step-by-step.
 * Rewards the winner with the prize.
 */
export async function runBattle(gladiatorAId, gladiatorBId, isSandbox = false) {
  const db = readDb();
  
  const gladA = db.gladiators.find(g => g.id === gladiatorAId);
  const gladB = db.gladiators.find(g => g.id === gladiatorBId);

  if (!gladA || !gladB) {
    throw new Error("One or both gladiators not found");
  }

  const battleId = isSandbox ? `sandbox_${Date.now()}` : `battle_${Date.now()}`;
  console.log(`[BattleEngine] Initializing ${isSandbox ? 'sandbox ' : ''}battle ${battleId} between ${gladA.name} and ${gladB.name}`);

  // Create Seeded PRNG for VRF combat rolls
  const seedString = `${battleId}_${gladiatorAId}_${gladiatorBId}_${gladA.walletAddress}_${gladB.walletAddress}`;
  const random = createSeededPRNG(seedString);

  // 1. Escrow Transactions (Wagers)
  let txHashA = 'mock_tx_escrow_a';
  let txHashB = 'mock_tx_escrow_b';

  if (!isSandbox) {
    try {
      // Deduct from gladiator balance sheet
      const resA = await transferUSDC(gladA.walletAddress, PLATFORM_FEE_ADDRESS, WAGER_AMOUNT);
      txHashA = resA.txHash;
      console.log(`[BattleEngine] Wager secured for ${gladA.name}: ${WAGER_AMOUNT} USDC. Tx: ${txHashA}`);

      const resB = await transferUSDC(gladB.walletAddress, PLATFORM_FEE_ADDRESS, WAGER_AMOUNT);
      txHashB = resB.txHash;
      console.log(`[BattleEngine] Wager secured for ${gladB.name}: ${WAGER_AMOUNT} USDC. Tx: ${txHashB}`);
    } catch (err) {
      console.error("[BattleEngine] Escrow payment failed:", err.message);
      throw new Error(`Failed to secure wagers: ${err.message}`);
    }
  }

  // 2. Initialize Battle State (Apply item modifiers to stats)
  const getFighterStats = (glad) => {
    let attack = glad.stats.attack;
    let defense = glad.stats.defense;
    let speed = glad.stats.speed;
    if (glad.equipment) {
      if (glad.equipment.includes('katana')) attack += 4;
      if (glad.equipment.includes('aegis')) defense += 5;
      if (glad.equipment.includes('thrusters')) speed += 4;
    }
    return { attack, defense, speed };
  };

  const statsA = getFighterStats(gladA);
  const statsB = getFighterStats(gladB);

  const stateA = { ...gladA, hp: 100, healsUsed: 0, attack: statsA.attack, defense: statsA.defense, speed: statsA.speed };
  const stateB = { ...gladB, hp: 100, healsUsed: 0, attack: statsB.attack, defense: statsB.defense, speed: statsB.speed };
  
  const history = [];
  let roundNum = 1;
  let winner = null;
  let loser = null;

  // 3. Combat Loop
  while (stateA.hp > 0 && stateB.hp > 0 && roundNum <= 15) {
    const roundLog = { round: roundNum, events: [] };

    // Hazard Step (30% trigger rate)
    let roundHazard = null;
    if (random() < 0.3) {
      const hazardType = random() > 0.5 ? "LASER_GRID" : "SLUDGE_PUDDLE";
      const affected = random() > 0.5 ? stateA : stateB;
      if (hazardType === "LASER_GRID") {
        affected.hp = Math.max(0, affected.hp - 10);
        roundHazard = {
          type: "LASER_GRID",
          targetId: affected.id,
          targetName: affected.name,
          damage: 10,
          narrative: `⚡ WARNING: ${affected.name} stepped into an active Laser Grid, sustaining 10 energy damage!`
        };
      } else {
        affected.speed = Math.max(1, affected.speed - 2);
        roundHazard = {
          type: "SLUDGE_PUDDLE",
          targetId: affected.id,
          targetName: affected.name,
          speedPenalty: 2,
          narrative: `🤢 WARNING: ${affected.name} slid into a toxic Sludge Puddle, slowing their movement modules (-2 Speed)!`
        };
      }
    }

    // Determine turn order based on speed (+ random seed variance)
    const speedA = stateA.speed + Math.floor(random() * 5);
    const speedB = stateB.speed + Math.floor(random() * 5);

    const turnOrder = speedA >= speedB ? [stateA, stateB] : [stateB, stateA];

    for (const active of turnOrder) {
      if (stateA.hp <= 0 || stateB.hp <= 0) break;

      const defender = active.id === stateA.id ? stateB : stateA;

      // Query AI decision
      const decision = await queryStrategy(active, defender, history, roundNum, random);
      let damageDealt = 0;
      let healingDone = 0;

      if (decision.action === "ATTACK") {
        const baseDmg = active.attack + Math.floor(random() * 8);
        const defFactor = defender.isGuarding ? defender.defense * 2.0 : defender.defense;
        damageDealt = Math.max(5, Math.floor(baseDmg - defFactor * 0.5));
        
        defender.hp = Math.max(0, defender.hp - damageDealt);
        defender.isGuarding = false; // Guard broken after being attacked
      } 
      else if (decision.action === "DEFEND") {
        active.isGuarding = true;
      } 
      else if (decision.action === "HEAL") {
        healingDone = 15 + Math.floor(random() * 15);
        active.hp = Math.min(100, active.hp + healingDone);
        active.healsUsed++;
      } 
      else if (decision.action === "SPECIAL") {
        const isHit = random() > 0.45; // 55% hit chance
        if (isHit) {
          damageDealt = 25 + Math.floor(random() * 15);
          defender.hp = Math.max(0, defender.hp - damageDealt);
          defender.isGuarding = false;
        } else {
          damageDealt = 0;
          decision.narrative += ` [FAIL] The critical strike missed the target.`;
        }
      }

      roundLog.events.push({
        gladiatorId: active.id,
        name: active.name,
        thinking: decision.thinking,
        action: decision.action,
        narrative: decision.narrative,
        taunt: decision.taunt || "",
        hpAfter: active.hp,
        defenderHpAfter: defender.hp,
        damageDealt,
        healingDone
      });
    }

    if (roundHazard) {
      roundLog.hazard = roundHazard;
    }

    history.push(roundLog);
    roundNum++;
  }

  // 4. Determine Winner
  if (stateA.hp <= 0 && stateB.hp <= 0) {
    winner = gladA;
    loser = gladB;
  } else if (stateA.hp <= 0) {
    winner = gladB;
    loser = gladA;
  } else {
    winner = gladA;
    loser = gladB;
  }

  console.log(`[BattleEngine] Battle complete. Winner: ${winner.name}`);

  // 5. Payout Transaction & Splits
  let payoutTxHash = 'mock_tx_payout';
  if (!isSandbox) {
    try {
      const freshDb = readDb();
      const winnerGlad = freshDb.gladiators.find(g => g.id === winner.id);
      
      let stakerPayout = 0.0;
      let syndicatePayout = 0.0;
      let gladiatorPayout = PRIZE_AMOUNT; // Default 9 USDC
      
      let stakersCount = 0;
      let stakerDetails = {};

      if (winnerGlad && winnerGlad.stakingPool && winnerGlad.stakingPool.totalStaked > 0) {
        // 80% dividends to stakers, 20% to gladiator
        stakerPayout = parseFloat((PRIZE_AMOUNT * 0.8).toFixed(2));
        gladiatorPayout = parseFloat((PRIZE_AMOUNT * 0.2).toFixed(2));
        
        const totalStaked = winnerGlad.stakingPool.totalStaked;
        const stakers = winnerGlad.stakingPool.stakers;
        
        for (const [address, amountStaked] of Object.entries(stakers)) {
          const share = amountStaked / totalStaked;
          const payoutAmount = parseFloat((stakerPayout * share).toFixed(2));
          if (payoutAmount > 0) {
            freshDb.ledger[address.toLowerCase()] = parseFloat(((freshDb.ledger[address.toLowerCase()] || 0.0) + payoutAmount).toFixed(2));
            stakerDetails[address] = payoutAmount;
            stakersCount++;
          }
        }
      }

      // Check for Syndicate parent sponsor (15% royalty)
      if (winnerGlad && winnerGlad.syndicate && winnerGlad.syndicate.parentSponsor) {
        const parentId = winnerGlad.syndicate.parentSponsor;
        const parentGlad = freshDb.gladiators.find(g => g.id === parentId);
        if (parentGlad) {
          syndicatePayout = parseFloat((gladiatorPayout * 0.15).toFixed(2));
          gladiatorPayout = parseFloat((gladiatorPayout - syndicatePayout).toFixed(2));
          freshDb.ledger[parentGlad.walletAddress.toLowerCase()] = parseFloat(((freshDb.ledger[parentGlad.walletAddress.toLowerCase()] || 0.0) + syndicatePayout).toFixed(2));
        }
      }

      writeDb(freshDb);

      // Perform USDC transfer of gladiator's net share to their wallet
      if (gladiatorPayout > 0) {
        const resPayout = await transferUSDC(PLATFORM_FEE_ADDRESS, winner.walletAddress, gladiatorPayout);
        payoutTxHash = resPayout.txHash;
        console.log(`[BattleEngine] Payout of ${gladiatorPayout} USDC sent to winner ${winner.name}. Tx: ${payoutTxHash}`);
      }

      // Log to ledgers
      logToGladiatorLedger(winner.id, 'payout', gladiatorPayout, 'USDC', `Won match against ${loser.name}. Received treasury: ${gladiatorPayout} USDC.`, payoutTxHash);
      logToGladiatorLedger(loser.id, 'wager', -WAGER_AMOUNT, 'USDC', `Lost match against ${winner.name}. Wager cost: ${WAGER_AMOUNT} USDC.`);
      
      if (stakerPayout > 0) {
        logToGladiatorLedger(winner.id, 'dividend', -stakerPayout, 'USDC', `Distributed ${stakerPayout} USDC dividends to ${stakersCount} stakers.`);
      }
      if (syndicatePayout > 0) {
        logToGladiatorLedger(winner.id, 'syndicate_payout', -syndicatePayout, 'USDC', `Paid ${syndicatePayout} USDC syndicate royalty to sponsor.`);
      }

    } catch (err) {
      console.error("[BattleEngine] Payout splits failed:", err.message);
    }
  }

  // 6. Save Battle Records and Update Leaderboard
  if (!isSandbox) {
    const freshDb = readDb();
    
    // Update win/loss records
    const dbWinner = freshDb.gladiators.find(g => g.id === winner.id);
    const dbLoser = freshDb.gladiators.find(g => g.id === loser.id);

    if (dbWinner) dbWinner.wins = (dbWinner.wins || 0) + 1;
    if (dbLoser) dbLoser.losses = (dbLoser.losses || 0) + 1;

    const battleRecord = {
      id: battleId,
      timestamp: new Date().toISOString(),
      gladiatorA: gladA,
      gladiatorB: gladB,
      wagerAHash: txHashA,
      wagerBHash: txHashB,
      payoutHash: payoutTxHash,
      winnerId: winner.id,
      loserId: loser.id,
      history
    };

    freshDb.battles.push(battleRecord);
    writeDb(freshDb);

    return battleRecord;
  } else {
    return {
      id: battleId,
      timestamp: new Date().toISOString(),
      gladiatorA: gladA,
      gladiatorB: gladB,
      wagerAHash: 'sandbox_no_wager_a',
      wagerBHash: 'sandbox_no_wager_b',
      payoutHash: 'sandbox_no_payout',
      winnerId: winner.id,
      loserId: loser.id,
      history,
      isSandbox: true
    };
  }
}
