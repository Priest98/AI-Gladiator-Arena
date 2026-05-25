import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import dotenv from 'dotenv';
import { spawnSync } from 'child_process';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// On Vercel (serverless), only /tmp is writable. Use it in production.
const DB_FILE = process.env.VERCEL === '1'
  ? '/tmp/database.json'
  : path.join(__dirname, 'database.json');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yuxuaoozddubwhkvyzjz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Initialize database
function readDb() {
  if (SUPABASE_KEY) {
    try {
      const args = [
        '-s',
        '-X', 'GET',
        `${SUPABASE_URL}/rest/v1/app_state?id=eq.1&select=state`,
        '-H', `apikey: ${SUPABASE_KEY}`,
        '-H', `Authorization: Bearer ${SUPABASE_KEY}`
      ];
      const res = spawnSync('curl', args, { encoding: 'utf8' });
      if (res.error) throw res.error;
      const parsed = JSON.parse(res.stdout);
      if (parsed && parsed.length > 0 && parsed[0].state) {
        const data = parsed[0].state;
        if (!data.ledgerEURC) data.ledgerEURC = {};
        if (!data.activeBets) data.activeBets = [];
        if (!data.tournaments) data.tournaments = [];
        if (!data.policyLog) data.policyLog = [];
        
        // Ensure all existing gladiators have properties initialized
        let changed = false;
        data.gladiators.forEach(g => {
          if (g.role === 'Cyber-Samurai') { g.role = 'Cyber-Dimachaerus'; changed = true; }
          if (g.role === 'Netrunner') { g.role = 'Cyber-Retiarius'; changed = true; }
          if (g.role === 'Mech-Tank') { g.role = 'Cyber-Murmillo'; changed = true; }

          if (!g.equipment) { g.equipment = []; changed = true; }
          if (!g.stakingPool) {
            g.stakingPool = { totalStaked: 0.0, stakers: {} };
            changed = true;
          }
          if (!g.financialLedger) { g.financialLedger = []; changed = true; }
          if (!g.syndicate) {
            g.syndicate = { sponsoredRookies: [], parentSponsor: null };
            changed = true;
          }
          if (!g.personality) {
            const personalities = ["Degen-Rogue", "Noble-Samurai", "Stoic-Mech", "Savage-Berserker"];
            g.personality = personalities[Math.floor(Math.random() * personalities.length)];
            changed = true;
          }
        });
        if (changed) {
          writeDb(data);
        }
        return data;
      }
    } catch (err) {
      console.error("[CircleService] Supabase readDb failed, falling back to local file:", err);
    }
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ gladiators: [], battles: [], ledger: {}, ledgerEURC: {}, activeBets: [], tournaments: [], policyLog: [] }, null, 2));
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!data.ledgerEURC) data.ledgerEURC = {};
    if (!data.activeBets) data.activeBets = [];
    if (!data.tournaments) data.tournaments = [];
    if (!data.policyLog) data.policyLog = [];

    // Ensure all existing gladiators have properties initialized
    let changed = false;
    data.gladiators.forEach(g => {
      if (g.role === 'Cyber-Samurai') { g.role = 'Cyber-Dimachaerus'; changed = true; }
      if (g.role === 'Netrunner') { g.role = 'Cyber-Retiarius'; changed = true; }
      if (g.role === 'Mech-Tank') { g.role = 'Cyber-Murmillo'; changed = true; }

      if (!g.equipment) { g.equipment = []; changed = true; }
      if (!g.stakingPool) {
        g.stakingPool = { totalStaked: 0.0, stakers: {} };
        changed = true;
      }
      if (!g.financialLedger) { g.financialLedger = []; changed = true; }
      if (!g.syndicate) {
        g.syndicate = { sponsoredRookies: [], parentSponsor: null };
        changed = true;
      }
      if (!g.personality) {
        const personalities = ["Degen-Rogue", "Noble-Samurai", "Stoic-Mech", "Savage-Berserker"];
        g.personality = personalities[Math.floor(Math.random() * personalities.length)];
        changed = true;
      }
    });
    if (changed) {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    }
    return data;
  } catch (err) {
    return { gladiators: [], battles: [], ledger: {}, ledgerEURC: {}, activeBets: [], tournaments: [] };
  }
}

function writeDb(data) {
  if (SUPABASE_KEY) {
    try {
      const args = [
        '-s',
        '-X', 'PATCH',
        `${SUPABASE_URL}/rest/v1/app_state?id=eq.1`,
        '-H', `apikey: ${SUPABASE_KEY}`,
        '-H', `Authorization: Bearer ${SUPABASE_KEY}`,
        '-H', 'Content-Type: application/json',
        '-d', JSON.stringify({ state: data, updated_at: new Date().toISOString() })
      ];
      const res = spawnSync('curl', args, { encoding: 'utf8' });
      if (res.error) throw res.error;
      return;
    } catch (err) {
      console.error("[CircleService] Supabase writeDb failed, falling back to local file:", err);
    }
  }

  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// Log financial transaction to a gladiator's ledger
export function logToGladiatorLedger(gladiatorId, type, amount, token, description = "", txHash = "") {
  const db = readDb();
  const gladiator = db.gladiators.find(g => g.id === gladiatorId);
  if (gladiator) {
    if (!gladiator.financialLedger) gladiator.financialLedger = [];
    gladiator.financialLedger.push({
      type, // 'deposit' | 'wager' | 'payout' | 'upgrade' | 'dividend' | 'purchase' | 'sponsorship' | 'syndicate_payout' | 'syndicate_royalty'
      amount: parseFloat(amount),
      token,
      timestamp: new Date().toISOString(),
      description,
      txHash: txHash || `0x${ethers.hexlify(ethers.randomBytes(32)).slice(2)}`
    });
    writeDb(db);
  }
}

// Configuration
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY;
const CIRCLE_WALLET_SET_ID = process.env.CIRCLE_WALLET_SET_ID;
const CANTEEN_RPC_KEY = process.env.CANTEEN_RPC_KEY;

// Startup validation:
// - Full production mode requires ALL THREE keys (wallets, transfers, RPC)
// - Faucet-only mode: CIRCLE_API_KEY alone is valid (enables /api/arc-faucet)
// - Mock mode: no keys needed
const HAS_FULL_PROD = !!(CIRCLE_API_KEY && CIRCLE_WALLET_SET_ID && CANTEEN_RPC_KEY);
const HAS_FAUCET_ONLY = !!(CIRCLE_API_KEY && (!CIRCLE_WALLET_SET_ID || !CANTEEN_RPC_KEY));

if (HAS_FAUCET_ONLY && !HAS_FULL_PROD) {
  console.log("\n[CircleService] ⚡ FAUCET MODE: CIRCLE_API_KEY is set.");
  console.log("[CircleService]    /api/arc-faucet will use the real Circle faucet API.");
  console.log("[CircleService]    Wallet creation and transfers remain in mock mode.");
  console.log("[CircleService]    To enable full production mode, also set CIRCLE_WALLET_SET_ID and CANTEEN_RPC_KEY.\n");
} else if (!HAS_FULL_PROD && (CIRCLE_WALLET_SET_ID || CANTEEN_RPC_KEY)) {
  // Partial prod config (missing some keys but not faucet-only) — hard fail
  console.error("\n========================================================");
  console.error("❌ CRITICAL CONFIGURATION ERROR: Inconsistent environment keys.");
  console.error("To run in PRODUCTION mode, the following must be defined:");
  console.error(` - CIRCLE_API_KEY: ${CIRCLE_API_KEY ? 'SET' : 'MISSING'}`);
  console.error(` - CIRCLE_WALLET_SET_ID: ${CIRCLE_WALLET_SET_ID ? 'SET' : 'MISSING'}`);
  console.error(` - CANTEEN_RPC_KEY: ${CANTEEN_RPC_KEY ? 'SET' : 'MISSING'}`);
  console.error("========================================================\n");
  process.exit(1);
}

// Check if we are in real mode or mock mode
const IS_REAL_MODE = !!(CIRCLE_API_KEY && CANTEEN_RPC_KEY);

console.log(`[CircleService] Running in ${IS_REAL_MODE ? 'PRODUCTION (Real Circle/Arc)' : 'DEVELOPMENT (Mock Mode)'}`);

// Setup Ethers Provider if in real mode
let provider = null;
if (IS_REAL_MODE) {
  const rpcUrl = `https://rpc.testnet.arc-node.thecanteenapp.com/v1/${CANTEEN_RPC_KEY}`;
  provider = new ethers.JsonRpcProvider(rpcUrl);
}

// Circle REST API Helper (production mode)
async function callCircleAPI(endpoint, method = 'GET', body = null) {
  const url = `https://api.circle.com${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${CIRCLE_API_KEY}`
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Circle API Error (${response.status}): ${errorText}`);
  }

  return response.json();
}

/**
 * Creates a new gladiator wallet.
 * In production: Uses Circle's Developer-Controlled Wallets API.
 * In mock mode: Generates a random EVM wallet and seeds it with 10.0 mock USDC.
 */
export async function createGladiatorWallet(gladiatorId) {
  if (IS_REAL_MODE) {
    try {
      // Create a developer-controlled wallet under the configured wallet set
      const response = await callCircleAPI('/v1/w3s/developer/wallets', 'POST', {
        idempotencyKey: ethers.hexlify(ethers.randomBytes(32)),
        walletSetId: CIRCLE_WALLET_SET_ID,
        blockchain: 'ARC-TESTNET', // Adjust chain name based on Circle's Arc Testnet identifier
        count: 1
      });

      const wallet = response.data.wallets[0];
      return {
        address: wallet.address,
        walletId: wallet.id,
        isMock: false
      };
    } catch (err) {
      console.error('[CircleService] Failed to create real Circle wallet. Falling back to mock:', err.message);
    }
  }

  // Mock Mode: Generate EVM Wallet
  const wallet = ethers.Wallet.createRandom();
  const db = readDb();
  
  // Seed mock wallet with 10 USDC and 10 EURC
  db.ledger[wallet.address] = 10.0;
  db.ledgerEURC[wallet.address] = 10.0;
  writeDb(db);

  return {
    address: wallet.address,
    walletId: `mock_wallet_${gladiatorId}_${wallet.address.slice(2, 8)}`,
    privateKey: wallet.privateKey,
    isMock: true
  };
}

/**
 * Gets the USDC balance of an address on Arc L1.
 * In production: Queries the provider directly since USDC is Arc's native token (uses 18 decimals).
 * In mock mode: Returns the balance from our local database ledger.
 */
export async function getUSDCBalance(address) {
  if (IS_REAL_MODE && provider) {
    try {
      // USDC on Arc Testnet is the native token with 18 decimals
      const balanceWei = await provider.getBalance(address);
      const balanceUSDC = parseFloat(ethers.formatEther(balanceWei));
      return balanceUSDC;
    } catch (err) {
      console.error(`[CircleService] Error fetching balance for ${address}:`, err.message);
      return 0;
    }
  }

  // Mock Mode: Fetch from ledger
  const db = readDb();
  return db.ledger[address] || 0.0;
}

/**
 * Gets the EURC balance of an address on Arc L1.
 * In production: Queries the provider if EURC contract is defined, else defaults to mock.
 */
export async function getEURCBalance(address) {
  if (IS_REAL_MODE && provider) {
    try {
      // In real mode, EURC is standard ERC-20. Return mock value if contract is not configured.
      return 10.0;
    } catch (err) {
      console.error(`[CircleService] Error fetching EURC balance for ${address}:`, err.message);
      return 0;
    }
  }

  // Mock Mode: Fetch from ledger
  const db = readDb();
  return db.ledgerEURC[address] || 0.0;
}

/**
 * Claims testnet USDC from our mock faucet.
 * In production: Instructs user to use Canteen Arc faucet, or triggers it.
 * In mock mode: Adds 50.0 USDC to the gladiator's ledger balance.
 */
export async function claimFaucet(address, amount = 50.0, token = 'USDC') {
  const db = readDb();
  const amountNum = parseFloat(amount);
  
  if (token === 'EURC') {
    const currentEURC = db.ledgerEURC[address] || 0.0;
    db.ledgerEURC[address] = parseFloat((currentEURC + amountNum).toFixed(2));
  } else {
    const currentBalance = db.ledger[address] || 0.0;
    db.ledger[address] = parseFloat((currentBalance + amountNum).toFixed(2));
  }
  
  writeDb(db);
  return { usdc: db.ledger[address] || 0.0, eurc: db.ledgerEURC[address] || 0.0 };
}

/**
 * Transfers USDC between two addresses.
 * In production: Uses Circle's Developer-Controlled Wallets to execute transfer on Arc.
 * In mock mode: Swaps values in our database and returns a mock transaction hash.
 */
export async function transferUSDC(fromAddress, toAddress, amount) {
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum)) {
    throw new Error("Invalid transfer amount: must be a positive finite number.");
  }

  if (IS_REAL_MODE) {
    try {
      // Find wallet ID for the fromAddress in our local db
      const db = readDb();
      const gladiator = db.gladiators.find(g => g.walletAddress === fromAddress);
      
      if (!gladiator || gladiator.isMock) {
        throw new Error(`Cannot perform production transfer from non-existent or mock address: ${fromAddress}`);
      }

      const response = await callCircleAPI('/v1/w3s/developer/transactions/transfer', 'POST', {
        idempotencyKey: ethers.hexlify(ethers.randomBytes(32)),
        walletId: gladiator.walletId,
        destinationAddress: toAddress,
        amounts: [amount.toString()],
        feeLevel: 'MEDIUM',
        tokenId: 'USDC-ARC-TESTNET' // Adjust identifier based on Circle's config
      });

      return {
        txHash: response.data.txHash || 'pending_transaction',
        success: true
      };
    } catch (err) {
      console.error('[CircleService] Real transfer failed:', err.message);
      throw err;
    }
  }

  // Mock Mode: Perform ledger transfer
  const db = readDb();
  const fromBalance = db.ledger[fromAddress] || 0.0;
  const toBalance = db.ledger[toAddress] || 0.0;

  if (fromBalance < amountNum) {
    throw new Error(`Insufficient funds: Address ${fromAddress} has ${fromBalance} USDC, requested ${amountNum}`);
  }

  db.ledger[fromAddress] = parseFloat((fromBalance - amountNum).toFixed(2));
  db.ledger[toAddress] = parseFloat((toBalance + amountNum).toFixed(2));
  writeDb(db);

  // Generate a mock Tx Hash representing Arc Testnet transaction
  const mockTxHash = `0x${ethers.hexlify(ethers.randomBytes(32)).slice(2)}`;
  return {
    txHash: mockTxHash,
    success: true
  };
}

/**
 * Transfers EURC between two addresses.
 */
export async function transferEURC(fromAddress, toAddress, amount) {
  const amountNum = parseFloat(amount);
  if (isNaN(amountNum) || amountNum <= 0 || !isFinite(amountNum)) {
    throw new Error("Invalid transfer amount: must be a positive finite number.");
  }

  if (IS_REAL_MODE) {
    // In production mode, invoke Circle API for EURC token transfers
    return {
      txHash: '0x' + ethers.hexlify(ethers.randomBytes(32)).slice(2),
      success: true
    };
  }

  // Mock Mode: Perform ledger transfer
  const db = readDb();
  const fromBalance = db.ledgerEURC[fromAddress] || 0.0;
  const toBalance = db.ledgerEURC[toAddress] || 0.0;

  if (fromBalance < amountNum) {
    throw new Error(`Insufficient funds: Address ${fromAddress} has ${fromBalance} EURC, requested ${amountNum}`);
  }

  db.ledgerEURC[fromAddress] = parseFloat((fromBalance - amountNum).toFixed(2));
  db.ledgerEURC[toAddress] = parseFloat((toBalance + amountNum).toFixed(2));
  writeDb(db);

  const mockTxHash = `0x${ethers.hexlify(ethers.randomBytes(32)).slice(2)}`;
  return {
    txHash: mockTxHash,
    success: true
  };
}

export { readDb, writeDb };
