/**
 * BattlePolicy Engine — AI Gladiator Arena
 * 
 * Mirrors Shadow's on-chain policy concept but for battle wagers.
 * Every wager request is scored against policy rules before execution.
 * Blocked wagers are logged with SHA-256 attested reasons — fully auditable.
 * 
 * Policy Rules:
 *  P-001: Wager must not exceed gladiator's available USDC balance
 *  P-002: Gladiator must not be in an active battle (no double-booking)
 *  P-003: Wager cannot exceed MAX_WAGER_LIMIT (circuit breaker)
 *  P-004: Gladiator must have minimum health (>= 10 HP) to wager
 *  P-005: Cooldown: gladiator must wait 30s between battles (anti-spam)
 *  P-006: Wager amount must be positive and non-zero
 *  P-007: Same wallet cannot wager on both sides of a battle (collusion guard)
 */

import crypto from 'crypto';

const MAX_WAGER_LIMIT = 50.0; // USDC circuit breaker
const BATTLE_COOLDOWN_MS = 30 * 1000; // 30 seconds
const MIN_HEALTH_TO_WAGER = 10;

// In-memory policy audit log (persisted via DB)
// Each entry: { timestamp, battleId, gladiatorId, decision, ruleCode, reason, sha256 }

/**
 * SHA-256 attest a policy decision — identical pattern to Shadow's PilotAttestor.
 * Produces a cryptographic fingerprint of the decision that can be independently verified.
 */
function attestDecision(payload) {
  const canonical = JSON.stringify({
    timestamp: payload.timestamp,
    battleId: payload.battleId,
    gladiatorId: payload.gladiatorId,
    decision: payload.decision,
    ruleCode: payload.ruleCode,
    wagerAmount: payload.wagerAmount,
    reason: payload.reason,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Evaluate a wager request against all policy rules.
 * Returns { approved: boolean, ruleCode, reason, attestation }
 */
export function evaluateWagerPolicy(params) {
  const {
    gladiator,
    opponentId,
    wagerAmount,
    walletA,
    walletB,
    currentBalance,
    lastBattleTimestamp,
    activeBattleIds = [],
  } = params;

  const battleId = `policy_eval_${Date.now()}`;
  const timestamp = new Date().toISOString();

  const createDecision = (approved, ruleCode, reason) => {
    const payload = {
      timestamp,
      battleId,
      gladiatorId: gladiator.id,
      decision: approved ? 'APPROVED' : 'BLOCKED',
      ruleCode,
      wagerAmount,
      reason,
    };
    const sha256 = attestDecision(payload);
    return { approved, ruleCode, reason, sha256, timestamp };
  };

  // P-006: Wager must be positive
  if (!wagerAmount || wagerAmount <= 0) {
    return createDecision(false, 'P-006', `Wager amount ${wagerAmount} USDC is invalid (must be > 0)`);
  }

  // P-003: Circuit breaker — max wager limit
  if (wagerAmount > MAX_WAGER_LIMIT) {
    return createDecision(false, 'P-003', `Wager ${wagerAmount} USDC exceeds circuit breaker limit of ${MAX_WAGER_LIMIT} USDC`);
  }

  // P-001: Balance sufficiency check
  if (currentBalance < wagerAmount) {
    return createDecision(false, 'P-001', `Insufficient balance: gladiator has ${currentBalance.toFixed(2)} USDC but wager requires ${wagerAmount} USDC`);
  }

  // P-004: Minimum health check
  const health = gladiator.stats?.health ?? 100;
  if (health < MIN_HEALTH_TO_WAGER) {
    return createDecision(false, 'P-004', `Gladiator health (${health} HP) is below minimum threshold of ${MIN_HEALTH_TO_WAGER} HP — too injured to wager`);
  }

  // P-002: Active battle check (no double-booking)
  if (activeBattleIds.includes(gladiator.id)) {
    return createDecision(false, 'P-002', `Gladiator ${gladiator.name} is already in an active battle — double-booking blocked`);
  }

  // P-005: Cooldown check
  if (lastBattleTimestamp) {
    const elapsed = Date.now() - new Date(lastBattleTimestamp).getTime();
    if (elapsed < BATTLE_COOLDOWN_MS) {
      const remaining = ((BATTLE_COOLDOWN_MS - elapsed) / 1000).toFixed(1);
      return createDecision(false, 'P-005', `Cooldown active: ${gladiator.name} must wait ${remaining}s before next wager`);
    }
  }

  // P-007: Collusion guard — same wallet on both sides
  if (walletA && walletB && walletA.toLowerCase() === walletB.toLowerCase()) {
    return createDecision(false, 'P-007', `Collusion guard triggered: same wallet address (${walletA}) cannot wager on both gladiators in a single battle`);
  }

  // All rules passed — APPROVED
  return createDecision(true, 'APPROVED', `All ${7} policy rules passed. Wager of ${wagerAmount} USDC approved for ${gladiator.name}.`);
}

/**
 * Evaluate a battle initiation request (independent of wager size).
 * Used for sandbox/spectator battles too.
 */
export function evaluateBattlePolicy(params) {
  const {
    gladiatorA,
    gladiatorB,
    activeBattleIds = [],
    lastBattleTimestampA,
    lastBattleTimestampB,
  } = params;

  const battleId = `battle_policy_${Date.now()}`;
  const timestamp = new Date().toISOString();

  const createDecision = (approved, ruleCode, reason, gladiatorId) => {
    const payload = {
      timestamp,
      battleId,
      gladiatorId: gladiatorId || gladiatorA.id,
      decision: approved ? 'APPROVED' : 'BLOCKED',
      ruleCode,
      wagerAmount: 0,
      reason,
    };
    const sha256 = attestDecision(payload);
    return { approved, ruleCode, reason, sha256, timestamp };
  };

  // Same gladiator check
  if (gladiatorA.id === gladiatorB.id) {
    return createDecision(false, 'P-008', 'A gladiator cannot fight themselves — self-battle blocked', gladiatorA.id);
  }

  // Active battle double-booking
  if (activeBattleIds.includes(gladiatorA.id)) {
    return createDecision(false, 'P-002', `${gladiatorA.name} is already in an active battle`, gladiatorA.id);
  }
  if (activeBattleIds.includes(gladiatorB.id)) {
    return createDecision(false, 'P-002', `${gladiatorB.name} is already in an active battle`, gladiatorB.id);
  }

  // Cooldown checks
  if (lastBattleTimestampA) {
    const elapsed = Date.now() - new Date(lastBattleTimestampA).getTime();
    if (elapsed < BATTLE_COOLDOWN_MS) {
      const remaining = ((BATTLE_COOLDOWN_MS - elapsed) / 1000).toFixed(1);
      return createDecision(false, 'P-005', `${gladiatorA.name} cooldown: ${remaining}s remaining`, gladiatorA.id);
    }
  }
  if (lastBattleTimestampB) {
    const elapsed = Date.now() - new Date(lastBattleTimestampB).getTime();
    if (elapsed < BATTLE_COOLDOWN_MS) {
      const remaining = ((BATTLE_COOLDOWN_MS - elapsed) / 1000).toFixed(1);
      return createDecision(false, 'P-005', `${gladiatorB.name} cooldown: ${remaining}s remaining`, gladiatorB.id);
    }
  }

  return createDecision(true, 'APPROVED', `Battle policy cleared: ${gladiatorA.name} vs ${gladiatorB.name} approved`, gladiatorA.id);
}

export const POLICY_RULES = [
  { code: 'P-001', name: 'Balance Sufficiency',    description: 'Wager must not exceed gladiator\'s available USDC balance' },
  { code: 'P-002', name: 'No Double-Booking',      description: 'Gladiator must not already be in an active battle' },
  { code: 'P-003', name: 'Circuit Breaker',         description: `Wager cannot exceed ${MAX_WAGER_LIMIT} USDC max limit` },
  { code: 'P-004', name: 'Minimum Health',          description: `Gladiator must have >= ${MIN_HEALTH_TO_WAGER} HP to participate` },
  { code: 'P-005', name: 'Battle Cooldown',         description: `Gladiator must wait ${BATTLE_COOLDOWN_MS / 1000}s between battles` },
  { code: 'P-006', name: 'Valid Wager Amount',      description: 'Wager amount must be positive and non-zero' },
  { code: 'P-007', name: 'Collusion Guard',         description: 'Same wallet cannot wager on both sides of a battle' },
  { code: 'P-008', name: 'No Self-Battle',          description: 'A gladiator cannot fight themselves' },
];
