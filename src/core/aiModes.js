import { getOwnedTiles, getPlayer } from "./gameState.js";
import { collectEnemyFronts, scoreFront } from "./aiFronts.js";
import { getDisconnectedRegionCount, getBestNeutralExpansion } from "./aiTerritory.js";
import { evaluateEconomyPressure } from "./aiEconomy.js";
import { hasImmediateThreat } from "./aiDefense.js";

export function chooseStrategicMode(state, playerId) {
  const player = getPlayer(state, playerId);
  if (!player || !player.isAlive || getOwnedTiles(state, playerId).length === 0) {
    return "ELIMINATED_SKIP";
  }

  const neutralPlan = getBestNeutralExpansion(state, playerId);
  const disconnectedRegions = getDisconnectedRegionCount(playerId, state);
  const economy = evaluateEconomyPressure(state, playerId);

  if (disconnectedRegions > 0 && neutralPlan?.connectsRegions) {
    return "RECONNECT_REGIONS";
  }
  if (neutralPlan && (neutralPlan.score >= 130 || (state.roundNumber ?? 1) >= 30)) {
    return "CLEANUP_NEUTRAL_FIELDS";
  }
  if (economy.needsEconomy) {
    return "BUILD_ECONOMY";
  }
  if (hasImmediateThreat(state, playerId)) {
    return "DEFEND_CRITICAL_FRONT";
  }

  const bestFront = collectEnemyFronts(state, playerId)
    .map((front) => scoreFront(state, playerId, front.enemyId))
    .sort((a, b) => b.score - a.score)[0];
  if (bestFront?.weakness.score >= 20 || bestFront?.finishPotential > 0) {
    return "ATTACK_WEAK_PLAYER";
  }

  return "CONSOLIDATE";
}
