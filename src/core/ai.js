import { canBuild, buildBuilding } from "./buildings.js";
import { calculateTileDefense, canCapture, captureTile } from "./combat.js";
import { getCurrentPlayer, getOwnedTiles } from "./gameState.js";
import { getNeighbors, hexDistance } from "./hexGrid.js";
import { RULES } from "./rules.js";
import {
  buyUnit,
  canBuyUnit,
  canUpgradeUnit,
  getReachableOwnedMoveTiles,
  moveInsideOwnedTerritory,
  upgradeUnit
} from "./units.js";
import { updateEliminations } from "./turnSystem.js";
import {
  canBuildTownSmart,
  evaluateEconomyPressure,
  getEconomyBuildThreshold,
  getUnitBuyLimit,
  scoreFarmTile,
  scoreTownBuild
} from "./aiEconomy.js";
import {
  canBuildTowerSmart,
  hasImmediateThreat,
  getTowerBuildThreshold,
  scoreDefensiveBuildingTile,
  shouldSuppressTowerBuilding
} from "./aiDefense.js";
import {
  collectEnemyFronts,
  estimateCutoffValue,
  evaluateEnemyWeakness,
  evaluateLocalPower,
  scoreFront
} from "./aiFronts.js";
import { chooseStrategicMode } from "./aiModes.js";
import {
  getBestNeutralExpansion,
  getDisconnectedRegionCount,
  getLargestOwnedRegion,
  getOwnedRegions,
  scoreExpansionCompactness,
  scoreNeutralExpansion,
  wouldConnectOwnRegions,
  wouldFillNeutralHole
} from "./aiTerritory.js";
import {
  countAlliedUnitsAround,
  countNonOwnedLandNeighbors,
  countOwnedLandNeighbors,
  createEmptyLocalPower,
  getLandNeighbors,
  isFrontTile,
  scoreEconomicTarget,
  scorePostCaptureStability
} from "./aiUtils.js";

export {
  canBuildTowerSmart,
  canBuildTownSmart,
  chooseStrategicMode,
  collectEnemyFronts,
  estimateCutoffValue,
  evaluateEnemyWeakness,
  evaluateLocalPower,
  getDisconnectedRegionCount,
  getLargestOwnedRegion,
  getOwnedRegions,
  scoreExpansionCompactness,
  scoreFront,
  scoreNeutralExpansion,
  scoreTownBuild,
  wouldConnectOwnRegions,
  wouldFillNeutralHole
};

export function runComputerTurn(state) {
  updateEliminations(state);
  const player = getCurrentPlayer(state);
  if (!player || !player.isAlive || player.isHuman || state.phase === "finished") {
    return { actions: [] };
  }

  const actions = [];
  const plan = createStrategicPlan(state, player.id);
  actions.push(...captureWithReadyUnits(state, player.id, plan));
  actions.push(...buildOneUsefulBuilding(state, player.id, plan));
  actions.push(...buyBorderUnits(state, player.id, getUnitBuyLimit(state, player.id, plan), plan));
  actions.push(...captureWithReadyUnits(state, player.id, plan));
  actions.push(...moveUnitsTowardFront(state, player.id, plan));
  actions.push(...upgradeOneUnit(state, player.id));
  logAiDecision(state, player.id, plan, actions);
  updateEliminations(state);

  return { actions };
}

export function createStrategicPlan(state, playerId) {
  const mode = chooseStrategicMode(state, playerId);
  const fronts = collectEnemyFronts(state, playerId)
    .map((front) => scoreFront(state, playerId, front.enemyId))
    .filter((front) => front.score > -Infinity)
    .sort((a, b) => b.score - a.score);

  if (fronts.length === 0) {
    return createFallbackFrontPlan(state, playerId, mode);
  }

  const chosen = choosePersistentFront(state, playerId, fronts);
  const frontTile = chooseOwnFrontTile(state, playerId, chosen);

  return {
    ...chosen,
    mode,
    economy: evaluateEconomyPressure(state, playerId),
    neutralPlan: getBestNeutralExpansion(state, playerId),
    disconnectedRegionCount: getDisconnectedRegionCount(playerId, state),
    targetPlayerId: chosen.enemyId,
    enemyFrontTiles: chosen.enemyTiles,
    ownFrontTiles: chosen.ownTiles,
    frontTile
  };
}

function captureWithReadyUnits(state, playerId, plan) {
  const actions = [];
  const unitTiles = getUnitTiles(state, playerId, plan);

  for (const tile of unitTiles) {
    if (!tile.unit || tile.unit.acted) continue;
    const targets = getNeighbors(tile, state.tiles)
      .filter((neighbor) => canCapture(state, tile.id, neighbor.id));
    const focusedTargets = filterCaptureTargetsForPlan(targets, plan);
    const target = focusedTargets
      .sort((a, b) => scoreCaptureTarget(state, b, playerId, plan, tile) - scoreCaptureTarget(state, a, playerId, plan, tile))[0];

    if (!target) continue;
    const result = captureTile(state, tile.id, target.id);
    if (result.ok) {
      actions.push(`captured ${target.id}`);
    }
  }

  return actions;
}

function buyBorderUnits(state, playerId, limit, plan) {
  const actions = [];
  const borderCandidates = getOwnedEmptyTiles(state, playerId)
    .filter((tile) => isFrontTile(state, tile, playerId))
    .sort((a, b) => scoreRecruitTile(state, b, playerId, plan) - scoreRecruitTile(state, a, playerId, plan));
  const focusedBorderTiles = plan?.frontTile
    ? borderCandidates.filter((tile) => hexDistance(tile, plan.frontTile) <= 5)
    : borderCandidates;
  const borderTiles = focusedBorderTiles.length > 0 ? focusedBorderTiles : borderCandidates;

  for (const tile of borderTiles) {
    if (actions.length >= limit) break;
    if (!canBuyUnit(state, tile.id, 1)) continue;
    const result = buyUnit(state, tile.id, 1);
    if (result.ok) {
      actions.push(`bought unit at ${tile.id}`);
    }
  }

  return actions;
}

function moveUnitsTowardFront(state, playerId, plan) {
  const actions = [];
  const unitTiles = getUnitTiles(state, playerId, plan);

  for (const tile of unitTiles) {
    if (!tile.unit || tile.unit.acted) continue;
    const currentScore = scoreMoveTarget(state, tile, playerId, plan, tile);
    const target = getReachableOwnedMoveTiles(state, tile.id)
      .sort((a, b) => scoreMoveTarget(state, b, playerId, plan, tile) - scoreMoveTarget(state, a, playerId, plan, tile))[0];

    if (!target || scoreMoveTarget(state, target, playerId, plan, tile) <= Math.max(2, currentScore + 1)) continue;
    const result = moveInsideOwnedTerritory(state, tile.id, target.id);
    if (result.ok) {
      actions.push(`moved unit to ${target.id}`);
    }
  }

  return actions;
}

function buildOneUsefulBuilding(state, playerId, plan) {
  const player = getCurrentPlayer(state);
  if (!player) {
    return [];
  }
  const immediateThreat = hasImmediateThreat(state, playerId);

  const economyCandidate = getOwnedEmptyTiles(state, playerId)
    .map((tile) => ({
      tile,
      type: canBuildTownSmart(tile.id, playerId, state) ? "city" : "farm",
      score: Math.max(scoreTownBuild(tile.id, playerId, state), scoreFarmTile(state, tile, playerId, plan))
    }))
    .filter((candidate) => candidate.score >= getEconomyBuildThreshold(state, playerId, plan))
    .sort((a, b) => b.score - a.score)[0];

  if (!immediateThreat && economyCandidate && canBuild(state, economyCandidate.tile.id, economyCandidate.type)) {
    const result = buildBuilding(state, economyCandidate.tile.id, economyCandidate.type);
    return result.ok ? [`built ${economyCandidate.type} at ${economyCandidate.tile.id}`] : [];
  }

  if (shouldSuppressTowerBuilding(state, playerId, plan)) {
    return [];
  }

  const defensiveCandidate = getOwnedEmptyTiles(state, playerId)
    .filter((tile) => canBuildTowerSmart(tile.id, playerId, state, "tower", plan))
    .map((tile) => ({
      tile,
      score: scoreDefensiveBuildingTile(state, tile, playerId, plan)
    }))
    .filter((candidate) => candidate.score >= getTowerBuildThreshold(state, playerId))
    .sort((a, b) => b.score - a.score)[0];

  if (defensiveCandidate) {
    const reserve = RULES.units[1].cost;
    const type = defensiveCandidate.score >= 19
      && player.money >= RULES.buildings.strongTower.cost + reserve
      && canBuildTowerSmart(defensiveCandidate.tile.id, playerId, state, "strongTower", plan)
      && canBuild(state, defensiveCandidate.tile.id, "strongTower")
      ? "strongTower"
      : "tower";

    if (player.money >= RULES.buildings[type].cost + reserve && canBuild(state, defensiveCandidate.tile.id, type)) {
      const result = buildBuilding(state, defensiveCandidate.tile.id, type);
      return result.ok ? [`built ${type} at ${defensiveCandidate.tile.id}`] : [];
    }
  }

  const farmTile = getOwnedEmptyTiles(state, playerId)
    .filter((tile) => scoreDefensiveBuildingTile(state, tile, playerId, plan) < 5)
    .sort((a, b) => scoreFarmTile(state, b, playerId, plan) - scoreFarmTile(state, a, playerId, plan))[0]
    ?? getOwnedEmptyTiles(state, playerId)[0];

  if (farmTile && canBuild(state, farmTile.id, "farm")) {
    const result = buildBuilding(state, farmTile.id, "farm");
    return result.ok ? [`built farm at ${farmTile.id}`] : [];
  }

  return [];
}

function upgradeOneUnit(state, playerId) {
  const candidates = getUnitTiles(state, playerId)
    .filter((tile) => canUpgradeUnit(state, tile.id))
    .sort((a, b) => b.unit.level - a.unit.level);
  const tile = candidates[0];
  if (!tile) {
    return [];
  }

  const result = upgradeUnit(state, tile.id);
  return result.ok ? [`upgraded unit at ${tile.id}`] : [];
}

function filterCaptureTargetsForPlan(targets, plan) {
  if (!plan?.targetPlayerId) {
    return targets;
  }

  if (plan.mode === "CLEANUP_NEUTRAL_FIELDS" || plan.mode === "RECONNECT_REGIONS") {
    const neutralTargets = targets.filter((tile) => tile.ownerId === null);
    if (neutralTargets.length > 0) return neutralTargets;
  }

  const targetEnemyTiles = plan.localPower?.canAttack
    ? targets.filter((tile) => tile.ownerId === plan.targetPlayerId)
    : [];
  const frontNeutralTiles = targets.filter((tile) => (
    tile.ownerId === null && plan.frontTile && hexDistance(tile, plan.frontTile) <= 2
  ));
  return [...targetEnemyTiles, ...frontNeutralTiles];
}

function createFallbackFrontPlan(state, playerId, mode = chooseStrategicMode(state, playerId)) {
  const frontTiles = getOwnedTiles(state, playerId)
    .filter((tile) => isFrontTile(state, tile, playerId))
    .map((tile) => ({
      tile,
      score: scoreFrontPlanTile(state, tile, playerId)
    }))
    .sort((a, b) => b.score - a.score);

  const best = frontTiles[0];
  return best
    ? {
      frontTile: best.tile,
      targetPlayerId: null,
      enemyId: null,
      enemyTiles: [],
      ownTiles: [best.tile],
      enemyFrontTiles: [],
      ownFrontTiles: [best.tile],
      mode,
      economy: evaluateEconomyPressure(state, playerId),
      neutralPlan: getBestNeutralExpansion(state, playerId),
      disconnectedRegionCount: getDisconnectedRegionCount(playerId, state),
      localPower: { ...createEmptyLocalPower(), canAttack: true },
      score: best.score
    }
    : null;
}

function choosePersistentFront(state, playerId, fronts) {
  const best = fronts[0];
  const memory = getAiMemory(state, playerId);
  const previous = memory.targetPlayerId
    ? fronts.find((front) => front.enemyId === memory.targetPlayerId)
    : null;
  const chosen = previous && shouldKeepPreviousFront(previous, best, memory)
    ? previous
    : best;
  const currentTurn = state.turnNumber ?? 0;
  const alreadyPlannedThisTurn = memory.lastPlannedTurn === currentTurn;

  if (!alreadyPlannedThisTurn) {
    if (chosen.enemyId === memory.targetPlayerId) {
      memory.commitmentTurns = Math.max(0, (memory.commitmentTurns ?? 0) - 1);
    } else {
      memory.commitmentTurns = getFrontCommitmentTurns(chosen);
    }
  }

  memory.targetPlayerId = chosen.enemyId;
  memory.lastScore = chosen.score;
  memory.lastPlannedTurn = currentTurn;
  return chosen;
}

function getAiMemory(state, playerId) {
  state.aiMemory ??= {};
  state.aiMemory[playerId] ??= {};
  return state.aiMemory[playerId];
}

function shouldKeepPreviousFront(previous, best, memory) {
  if (!previous || previous.enemyId === best.enemyId) {
    return true;
  }

  const scoreRatio = previous.score / Math.max(1, best.score);
  if (previous.finishPotential > 0 && scoreRatio >= 0.55) {
    return true;
  }

  return (memory.commitmentTurns ?? 0) > 0 && scoreRatio >= 0.7;
}

function getFrontCommitmentTurns(front) {
  return front.finishPotential > 0 ? 4 : 2;
}

function chooseOwnFrontTile(state, playerId, front) {
  return front.ownTiles
    .map((tile) => {
      const targetContact = getLandNeighbors(state, tile)
        .filter((neighbor) => neighbor.ownerId === front.enemyId)
        .length;
      return {
        tile,
        score: scoreFrontPlanTile(state, tile, playerId)
          + targetContact * 5
          + countAlliedUnitsAround(state, tile, playerId, 3) * 1.2
      };
    })
    .sort((a, b) => b.score - a.score)[0]?.tile
    ?? front.ownTiles[0]
    ?? null;
}

function getUnitTiles(state, playerId, plan = null) {
  return state.tiles
    .filter((tile) => tile.unit?.ownerId === playerId)
    .sort((a, b) => (
      scoreUnitActivation(state, b, playerId, plan) - scoreUnitActivation(state, a, playerId, plan)
    ));
}

function getOwnedEmptyTiles(state, playerId) {
  return getOwnedTiles(state, playerId).filter((tile) => !tile.unit && !tile.building);
}

function scoreUnitActivation(state, tile, playerId, plan) {
  const focusTile = getPlanFocusTile(plan);
  const planDistance = focusTile ? hexDistance(tile, focusTile) : 0;
  return tile.unit.level * 8
    + countNonOwnedLandNeighbors(state, tile, playerId) * 3
    - planDistance * 0.8
    + countAlliedUnitsAround(state, tile, playerId, 2, tile.id) * 0.8;
}

function scoreFrontPlanTile(state, tile, playerId) {
  const hostileNeighbors = getLandNeighbors(state, tile)
    .filter((neighbor) => neighbor.ownerId !== playerId);
  const enemyUnitPressure = hostileNeighbors.reduce((total, neighbor) => (
    total + (neighbor.unit && neighbor.unit.ownerId !== playerId ? 4 + neighbor.unit.level * 2 : 0)
  ), 0);
  const enemyBuildingValue = hostileNeighbors.reduce((total, neighbor) => (
    total + (neighbor.building ? neighbor.building.type === "city" ? 8 : 3 : 0)
  ), 0);
  const alliedMass = countAlliedUnitsAround(state, tile, playerId, 3);
  return hostileNeighbors.length * 3
    + enemyUnitPressure
    + enemyBuildingValue
    + alliedMass * 1.2
    + countOwnedLandNeighbors(state, tile, playerId) * 0.6;
}

function scoreCaptureTarget(state, tile, playerId, plan, sourceTile) {
  const ownerScore = tile.ownerId === null ? 2 : 5;
  const defenseScore = Math.max(0, 5 - calculateTileDefense(state, tile.id));
  const buildingScore = tile.building ? 2 + scoreEconomicTarget(tile) : 0;
  const focusTile = getPlanFocusTile(plan);
  const planScore = focusTile ? Math.max(0, 6 - hexDistance(tile, focusTile)) * 0.9 : 0;
  const supportScore = countAlliedUnitsAround(state, tile, playerId, 2, sourceTile.id) * 1.5;
  const targetFocusScore = plan?.targetPlayerId === tile.ownerId ? 10 : 0;
  const finishScore = plan?.targetPlayerId === tile.ownerId ? plan.finishPotential * 0.35 : 0;
  const cutoffScore = estimateCutoffValue(state, playerId, tile.id) * 2.2;
  const neutralScore = tile.ownerId === null ? scoreNeutralExpansion(tile.id, playerId, state) * 0.55 : 0;
  const reconnectScore = wouldConnectOwnRegions(tile.id, playerId, state) ? 60 : 0;
  const stabilityScore = scorePostCaptureStability(state, playerId, tile) * 1.4;

  return ownerScore
    + defenseScore
    + buildingScore
    + planScore
    + supportScore
    + targetFocusScore
    + finishScore
    + cutoffScore
    + neutralScore
    + reconnectScore
    + stabilityScore;
}

function scoreMoveTarget(state, tile, playerId, plan, sourceTile) {
  const focusTile = getPlanFocusTile(plan);
  const focusDistance = focusTile ? hexDistance(tile, focusTile) : 0;
  const sourceDistance = focusTile ? hexDistance(sourceTile, focusTile) : focusDistance;
  const distanceImprovement = focusTile ? sourceDistance - focusDistance : 0;
  const frontPressure = countNonOwnedLandNeighbors(state, tile, playerId);
  const adjacentAllies = countAlliedUnitsAround(state, tile, playerId, 1, sourceTile.id);
  const nearbyAllies = countAlliedUnitsAround(state, tile, playerId, 2, sourceTile.id);
  const mergeBonus = tile.unit?.ownerId === playerId && tile.unit.level === sourceTile.unit?.level ? 5 : 0;

  return frontPressure * 2.3
    + distanceImprovement * 4
    + (focusTile ? Math.max(0, 6 - focusDistance) * 0.9 : 0)
    + adjacentAllies * 2.6
    + nearbyAllies * 1.2
    + mergeBonus;
}

function scoreRecruitTile(state, tile, playerId, plan) {
  const focusTile = getPlanFocusTile(plan);
  const focusScore = focusTile ? Math.max(0, 6 - hexDistance(tile, focusTile)) * 1.4 : 0;
  const targetPressure = plan?.targetPlayerId
    ? getLandNeighbors(state, tile).filter((neighbor) => neighbor.ownerId === plan.targetPlayerId).length * 4
    : 0;
  const enemyUnitPressure = getLandNeighbors(state, tile).reduce((total, neighbor) => (
    total + (neighbor.unit && neighbor.unit.ownerId !== playerId ? 3 + neighbor.unit.level * 2 : 0)
  ), 0);
  return countNonOwnedLandNeighbors(state, tile, playerId) * 3
    + focusScore
    + targetPressure
    + enemyUnitPressure
    + countAlliedUnitsAround(state, tile, playerId, 2) * 0.8;
}

function logAiDecision(state, playerId, plan, actions) {
  if (!RULES.ai?.debug) return;
  state.log.push({
    turnNumber: state.turnNumber,
    playerId,
    message: `AI ${plan?.mode ?? "NONE"} chose ${actions[0] ?? "no action"}.`
  });
  if (state.log.length > 80) {
    state.log.shift();
  }
}

function getPlanFocusTile(plan) {
  if (plan?.mode === "CLEANUP_NEUTRAL_FIELDS" || plan?.mode === "RECONNECT_REGIONS") {
    return plan.neutralPlan?.tile ?? plan.frontTile ?? null;
  }
  return plan?.frontTile ?? plan?.neutralPlan?.tile ?? null;
}
