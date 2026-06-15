import { canBuild, buildBuilding, getBuildingCost } from "./buildings.js";
import { calculateTileDefense, canCapture, captureTile } from "./combat.js";
import { calculateGrossIncome, calculateNetIncome, calculateTotalUpkeep } from "./economy.js";
import { getCurrentPlayer, getOwnedTiles, getPlayer } from "./gameState.js";
import { getConnectedRegions, getNeighbors, hexDistance } from "./hexGrid.js";
import { RULES, getUnitRule } from "./rules.js";
import {
  buyUnit,
  canBuyUnit,
  canUpgradeUnit,
  getReachableOwnedMoveTiles,
  moveInsideOwnedTerritory,
  upgradeUnit
} from "./units.js";
import { updateEliminations } from "./turnSystem.js";

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

export function evaluateEnemyWeakness(state, playerId, enemyId) {
  const enemyTiles = state.tiles.filter((tile) => (
    tile.ownerId === enemyId && tile.terrain !== RULES.terrain.blocked
  ));

  if (enemyTiles.length === 0) {
    return {
      enemyId,
      tileCount: 0,
      income: 0,
      exposedBorderEdges: 0,
      exposedBorderTiles: 0,
      touchingEnemyCount: 0,
      score: -Infinity
    };
  }

  const exposedTileIds = new Set();
  const touchingEnemyIds = new Set();
  let exposedBorderEdges = 0;

  for (const tile of enemyTiles) {
    for (const neighbor of getLandNeighbors(state, tile)) {
      if (neighbor.ownerId === enemyId) continue;
      exposedBorderEdges += 1;
      exposedTileIds.add(tile.id);
      if (neighbor.ownerId !== null && neighbor.ownerId !== enemyId) {
        touchingEnemyIds.add(neighbor.ownerId);
      }
    }
  }

  const tileCount = enemyTiles.length;
  const income = calculateGrossIncome(state, enemyId);
  const exposureRatio = exposedBorderEdges / Math.max(1, tileCount);
  const lowTileScore = Math.max(0, 16 - tileCount) * 2.2;
  const lowIncomeScore = Math.max(0, 14 - income) * 1.15;
  const criticalScore = tileCount <= 4 ? 18 : tileCount <= 7 ? 9 : 0;
  const multiFrontScore = Math.max(0, touchingEnemyIds.size - 1) * 5;

  return {
    enemyId,
    tileCount,
    income,
    exposedBorderEdges,
    exposedBorderTiles: exposedTileIds.size,
    touchingEnemyCount: touchingEnemyIds.size,
    score: lowTileScore
      + lowIncomeScore
      + exposureRatio * 4.5
      + multiFrontScore
      + criticalScore
  };
}

export function collectEnemyFronts(state, playerId) {
  const tileById = new Map(state.tiles.map((tile) => [tile.id, tile]));
  const fronts = new Map();

  for (const tile of state.tiles) {
    if (tile.terrain === RULES.terrain.blocked || tile.ownerId === null || tile.ownerId === playerId) {
      continue;
    }

    for (const neighbor of getLandNeighbors(state, tile)) {
      if (neighbor.ownerId !== playerId) continue;

      if (!fronts.has(tile.ownerId)) {
        fronts.set(tile.ownerId, {
          enemyId: tile.ownerId,
          enemyTileIds: new Set(),
          ownTileIds: new Set(),
          sharedBorderLength: 0
        });
      }

      const front = fronts.get(tile.ownerId);
      front.enemyTileIds.add(tile.id);
      front.ownTileIds.add(neighbor.id);
      front.sharedBorderLength += 1;
    }
  }

  return [...fronts.values()].map((front) => ({
    enemyId: front.enemyId,
    enemyTiles: [...front.enemyTileIds].map((id) => tileById.get(id)).filter(Boolean),
    ownTiles: [...front.ownTileIds].map((id) => tileById.get(id)).filter(Boolean),
    sharedBorderLength: front.sharedBorderLength
  }));
}

export function scoreFront(state, playerId, enemyId) {
  const front = collectEnemyFronts(state, playerId)
    .find((candidate) => candidate.enemyId === enemyId);

  if (!front) {
    return {
      enemyId,
      enemyTiles: [],
      ownTiles: [],
      sharedBorderLength: 0,
      weakness: evaluateEnemyWeakness(state, playerId, enemyId),
      localPower: createEmptyLocalPower(),
      cutoffScore: 0,
      economicScore: 0,
      stabilityScore: 0,
      weakEnemyTiles: 0,
      finishPotential: 0,
      score: -Infinity
    };
  }

  const weakness = evaluateEnemyWeakness(state, playerId, enemyId);
  const localPower = evaluateLocalPower(state, playerId, enemyId, front.enemyTiles);
  const cutoffScore = front.enemyTiles.reduce((best, tile) => (
    Math.max(best, estimateCutoffValue(state, playerId, tile.id))
  ), 0);
  const economicScore = front.enemyTiles.reduce((total, tile) => total + scoreEconomicTarget(tile), 0);
  const stabilityScore = front.enemyTiles.reduce((total, tile) => (
    total + scorePostCaptureStability(state, playerId, tile)
  ), 0) / Math.max(1, front.enemyTiles.length);
  const weakEnemyTiles = front.enemyTiles.filter((tile) => calculateTileDefense(state, tile.id) <= 2).length;
  const finishPotential = weakness.tileCount <= 4
    ? 28
    : weakness.tileCount <= 7 && localPower.ownPower >= localPower.enemyPower * 0.75
      ? 14
      : 0;
  const localPowerScore = localPower.canAttack
    ? 12 + Math.max(-4, localPower.advantage) * 1.2
    : Math.max(-14, localPower.advantage * 1.4);

  return {
    ...front,
    weakness,
    localPower,
    cutoffScore,
    economicScore,
    stabilityScore,
    weakEnemyTiles,
    finishPotential,
    score: front.sharedBorderLength * 2
      + weakness.score * 1.25
      + weakEnemyTiles * 4
      + cutoffScore * 2.4
      + economicScore * 1.7
      + stabilityScore * 1.2
      + localPowerScore
      + finishPotential
  };
}

export function evaluateLocalPower(state, playerId, enemyId, frontTiles) {
  const targets = frontTiles.filter((tile) => tile.ownerId === enemyId);
  if (targets.length === 0) {
    return createEmptyLocalPower();
  }

  const ownUnits = state.tiles.filter((tile) => (
    tile.unit?.ownerId === playerId && distanceToAny(tile, targets) <= 3
  ));
  const enemyUnits = state.tiles.filter((tile) => (
    tile.unit?.ownerId === enemyId && distanceToAny(tile, targets) <= 2
  ));
  const easiestDefenses = targets
    .map((tile) => calculateTileDefense(state, tile.id))
    .sort((a, b) => a - b)
    .slice(0, 3);

  const ownPower = ownUnits.reduce((total, tile) => total + scoreUnitPower(tile.unit), 0);
  const enemyUnitPower = enemyUnits.reduce((total, tile) => total + scoreUnitPower(tile.unit), 0);
  const enemyDefense = easiestDefenses.reduce((total, defense) => total + Math.max(1, defense), 0);
  const enemyPower = enemyUnitPower + enemyDefense;
  const attackableTargets = targets.filter((target) => ownUnits.some((unitTile) => canCapture(state, unitTile.id, target.id)));
  const canAttack = attackableTargets.length > 0 || ownPower >= enemyPower * 0.85 + 1;

  return {
    ownPower,
    enemyPower,
    enemyUnitPower,
    enemyDefense,
    advantage: ownPower - enemyPower,
    ownUnitCount: ownUnits.length,
    enemyUnitCount: enemyUnits.length,
    attackableTargetCount: attackableTargets.length,
    canAttack
  };
}

export function estimateCutoffValue(state, playerId, targetTileId) {
  const target = state.tiles.find((tile) => tile.id === targetTileId);
  if (!target || target.ownerId === null || target.ownerId === playerId || target.terrain === RULES.terrain.blocked) {
    return 0;
  }

  const enemyId = target.ownerId;
  const region = getConnectedRegions(state.tiles, enemyId)
    .find((candidate) => candidate.some((tile) => tile.id === targetTileId));
  if (!region || region.length < 4) {
    return 0;
  }

  const remainingIds = new Set(
    region
      .filter((tile) => tile.id !== targetTileId)
      .map((tile) => tile.id)
  );
  const components = getComponentsWithinIds(state, remainingIds);
  if (components.length <= 1) {
    return 0;
  }

  components.sort((a, b) => b.length - a.length);
  return components.slice(1).reduce((total, component) => (
    total + component.reduce((componentTotal, tile) => (
      componentTotal + 2 + scoreEconomicTarget(tile) + (tile.unit ? scoreUnitPower(tile.unit) : 0)
    ), 0)
  ), 0);
}

export function getOwnedRegions(playerId, state) {
  return getConnectedRegions(state.tiles, playerId)
    .sort((a, b) => b.length - a.length);
}

export function getLargestOwnedRegion(playerId, state) {
  return getOwnedRegions(playerId, state)[0] ?? [];
}

export function getDisconnectedRegionCount(playerId, state) {
  return Math.max(0, getOwnedRegions(playerId, state).length - 1);
}

export function wouldConnectOwnRegions(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.terrain === RULES.terrain.blocked || tile.ownerId === playerId) {
    return false;
  }

  const regionIds = getAdjacentOwnedRegionIds(tile, playerId, state);
  return regionIds.size >= 2;
}

export function wouldFillNeutralHole(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.ownerId !== null || tile.terrain === RULES.terrain.blocked) {
    return false;
  }

  return countOwnedLandNeighbors(state, tile, playerId) >= 3;
}

export function scoreExpansionCompactness(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.terrain === RULES.terrain.blocked) {
    return -Infinity;
  }

  const ownNeighbors = countOwnedLandNeighbors(state, tile, playerId);
  const hostileNeighbors = getLandNeighbors(state, tile).filter((neighbor) => (
    neighbor.ownerId !== null && neighbor.ownerId !== playerId
  )).length;
  const neutralNeighbors = getLandNeighbors(state, tile).filter((neighbor) => neighbor.ownerId === null).length;
  const largestRegionIds = new Set(getLargestOwnedRegion(playerId, state).map((regionTile) => regionTile.id));
  const touchesLargestRegion = getLandNeighbors(state, tile).some((neighbor) => largestRegionIds.has(neighbor.id));

  return ownNeighbors * 7
    + (touchesLargestRegion ? 10 : 0)
    + (wouldConnectOwnRegions(tileId, playerId, state) ? 35 : 0)
    - hostileNeighbors * 4
    - neutralNeighbors * 0.8
    - (ownNeighbors <= 1 ? 20 : 0);
}

export function scoreNeutralExpansion(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.ownerId !== null || tile.terrain === RULES.terrain.blocked) {
    return -Infinity;
  }

  const ownNeighbors = countOwnedLandNeighbors(state, tile, playerId);
  if (ownNeighbors === 0) {
    return -Infinity;
  }

  const round = state.roundNumber ?? 1;
  const holeBonus = ownNeighbors >= 4 ? 120 : ownNeighbors === 3 ? 55 : 0;
  const lateBonus = round >= 40 ? 85 : round >= 25 ? 35 : 0;
  const connectBonus = wouldConnectOwnRegions(tileId, playerId, state) ? 95 : 0;
  return 12
    + ownNeighbors * 11
    + holeBonus
    + lateBonus
    + connectBonus
    + scoreExpansionCompactness(tileId, playerId, state);
}

export function canBuildTownSmart(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  const player = getPlayer(state, playerId);
  if (!tile || !player || tile.terrain === RULES.terrain.blocked) return false;
  if (tile.ownerId !== playerId || tile.unit || tile.building) return false;
  if (player.money < (getBuildingCost(state, playerId, "city") ?? Infinity)) return false;
  if (countOwnedLandNeighbors(state, tile, playerId) < 4) return false;
  if (hasEnemyWithinDistance(state, tile, playerId, 2)) return false;
  if (getNearestOwnBuildingDistance(state, tile, playerId, "city") <= 3) return false;

  const largestRegionIds = new Set(getLargestOwnedRegion(playerId, state).map((regionTile) => regionTile.id));
  return largestRegionIds.has(tile.id);
}

export function scoreTownBuild(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.ownerId !== playerId || tile.unit || tile.building) {
    return -Infinity;
  }

  const economy = evaluateEconomyPressure(state, playerId);
  const smartPlacementScore = canBuildTownSmart(tileId, playerId, state) ? 35 : -45;
  return smartPlacementScore
    + economy.lowNetScore
    + economy.upkeepRatioScore
    + countOwnedLandNeighbors(state, tile, playerId) * 5
    + scoreExpansionCompactness(tileId, playerId, state) * 0.5;
}

export function canBuildTowerSmart(tileId, playerId, state, type = "tower", plan = null) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  const player = getPlayer(state, playerId);
  if (!tile || !player || tile.terrain === RULES.terrain.blocked) return false;
  if (tile.ownerId !== playerId || tile.unit || tile.building) return false;
  if (player.money < (getBuildingCost(state, playerId, type) ?? Infinity)) return false;
  if (type === "strongTower" && !canBuildStrongTowerNow(state, tile, playerId)) return false;

  const round = state.roundNumber ?? 1;
  const enemyDistance = getNearestEnemyDistance(state, tile, playerId);
  const threatened = isTileThreatenedByEnemy(state, tile, playerId);
  const chokepoint = isCriticalChokepoint(state, tile, playerId);
  const protectsValue = protectsValuableCluster(state, tile, playerId);
  const onMainDefenseFront = plan?.mode === "DEFEND_CRITICAL_FRONT" && plan.frontTile && hexDistance(tile, plan.frontTile) <= 2;
  const earlyDirectThreat = round < 15 && enemyDistance === 1 && threatened;

  if (getTowerCount(state, playerId) >= getMaxTowerCount(state, playerId) && !earlyDirectThreat) return false;
  if (countOwnedLandNeighbors(state, tile, playerId) >= 5 && enemyDistance > 2) return false;
  if (enemyDistance > 2 && !chokepoint && !protectsValue) return false;
  if (isNeutralOnlyBorder(state, tile, playerId)) return false;
  if (countNearbyDefensiveBuildings(state, tile, playerId, 3) > 0 && !chokepoint) return false;
  if (round < 15 && !earlyDirectThreat) return false;
  if (round < 30 && !(threatened || chokepoint || protectsValue)) return false;

  return threatened || chokepoint || protectsValue || onMainDefenseFront;
}

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

function createEmptyLocalPower() {
  return {
    ownPower: 0,
    enemyPower: 0,
    enemyUnitPower: 0,
    enemyDefense: 0,
    advantage: 0,
    ownUnitCount: 0,
    enemyUnitCount: 0,
    attackableTargetCount: 0,
    canAttack: false
  };
}

function getComponentsWithinIds(state, remainingIds) {
  const tileById = new Map(state.tiles.map((tile) => [tile.id, tile]));
  const pendingIds = new Set(remainingIds);
  const components = [];

  while (pendingIds.size > 0) {
    const startId = pendingIds.values().next().value;
    const start = tileById.get(startId);
    pendingIds.delete(startId);
    if (!start) continue;

    const queue = [start];
    const component = [];

    while (queue.length > 0) {
      const tile = queue.shift();
      component.push(tile);

      for (const neighbor of getNeighbors(tile, state.tiles)) {
        if (!pendingIds.has(neighbor.id)) continue;
        pendingIds.delete(neighbor.id);
        queue.push(neighbor);
      }
    }

    components.push(component);
  }

  return components;
}

function distanceToAny(tile, targets) {
  return targets.reduce((best, target) => Math.min(best, hexDistance(tile, target)), Infinity);
}

function scoreUnitPower(unit) {
  if (!unit) {
    return 0;
  }

  return (getUnitRule(unit.level)?.strength ?? unit.level) + unit.level * 0.35;
}

function scoreEconomicTarget(tile) {
  if (!tile.building) {
    return tile.unit ? scoreUnitPower(tile.unit) * 0.4 : 0;
  }

  if (tile.building.type === "city") return 9;
  if (tile.building.type === "farm") return 5;
  if (tile.building.type === "strongTower") return 4;
  if (tile.building.type === "tower") return 3;
  return 1;
}

function scorePostCaptureStability(state, playerId, tile) {
  const neighbors = getLandNeighbors(state, tile);
  const ownNeighbors = neighbors.filter((neighbor) => neighbor.ownerId === playerId).length;
  const hostileNeighbors = neighbors.filter((neighbor) => (
    neighbor.ownerId !== null && neighbor.ownerId !== playerId
  )).length;
  const neutralNeighbors = neighbors.filter((neighbor) => neighbor.ownerId === null).length;
  const nearbyAllies = countAlliedUnitsAround(state, tile, playerId, 2);

  return ownNeighbors * 2.4
    + nearbyAllies * 0.8
    - hostileNeighbors * 2.2
    - neutralNeighbors * 0.6
    + (ownNeighbors >= 2 ? 3 : 0)
    - (hostileNeighbors >= 4 ? 5 : 0);
}

function getAdjacentOwnedRegionIds(tile, playerId, state) {
  const regionByTileId = new Map();
  for (const [regionIndex, region] of getOwnedRegions(playerId, state).entries()) {
    for (const regionTile of region) {
      regionByTileId.set(regionTile.id, regionIndex);
    }
  }

  return new Set(
    getLandNeighbors(state, tile)
      .filter((neighbor) => neighbor.ownerId === playerId)
      .map((neighbor) => regionByTileId.get(neighbor.id))
      .filter((regionId) => regionId !== undefined)
  );
}

function evaluateEconomyPressure(state, playerId) {
  const grossIncome = calculateGrossIncome(state, playerId);
  const upkeep = calculateTotalUpkeep(state, playerId);
  const netIncome = grossIncome - upkeep;
  const upkeepRatio = upkeep / Math.max(1, grossIncome);
  return {
    grossIncome,
    upkeep,
    netIncome,
    upkeepRatio,
    lowNetScore: Math.max(0, 5 - netIncome) * 12,
    upkeepRatioScore: upkeepRatio > 0.5 ? (upkeepRatio - 0.5) * 80 : 0,
    needsEconomy: netIncome < 5 || upkeepRatio > 0.5
  };
}

function getBestNeutralExpansion(state, playerId) {
  return state.tiles
    .filter((tile) => tile.ownerId === null && tile.terrain !== RULES.terrain.blocked)
    .filter((tile) => countOwnedLandNeighbors(state, tile, playerId) > 0)
    .map((tile) => ({
      tile,
      score: scoreNeutralExpansion(tile.id, playerId, state),
      fillsHole: wouldFillNeutralHole(tile.id, playerId, state),
      connectsRegions: wouldConnectOwnRegions(tile.id, playerId, state)
    }))
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function getUnitBuyLimit(state, playerId, plan) {
  if (!plan || plan.mode === "ELIMINATED_SKIP") return 0;
  if (plan.mode === "BUILD_ECONOMY") return 0;
  if (plan.economy?.upkeepRatio > 0.5 || plan.economy?.netIncome < 5) return 1;
  if (plan.mode === "CLEANUP_NEUTRAL_FIELDS" || plan.mode === "RECONNECT_REGIONS") return 1;
  return 2;
}

function getEconomyBuildThreshold(state, playerId, plan) {
  if (plan?.mode === "BUILD_ECONOMY") return 25;
  if (plan?.mode === "CLEANUP_NEUTRAL_FIELDS" || plan?.mode === "RECONNECT_REGIONS") return 60;
  return evaluateEconomyPressure(state, playerId).needsEconomy ? 35 : 85;
}

function shouldSuppressTowerBuilding(state, playerId, plan) {
  const neutralPlan = plan?.neutralPlan ?? getBestNeutralExpansion(state, playerId);
  if (neutralPlan && neutralPlan.score >= 100 && !hasImmediateThreat(state, playerId)) {
    return true;
  }
  if (plan?.mode === "BUILD_ECONOMY" && !hasImmediateThreat(state, playerId)) {
    return true;
  }
  return false;
}

function getTowerBuildThreshold(state, playerId) {
  const round = state.roundNumber ?? 1;
  if (round < 15) return 24;
  if (round < 30) return 20;
  return 16;
}

function getTowerCount(state, playerId) {
  return state.tiles.filter((tile) => (
    tile.ownerId === playerId && tile.building && isDefensiveBuilding(tile.building.type)
  )).length;
}

function getMaxTowerCount(state, playerId) {
  const ownedTiles = getOwnedTiles(state, playerId).length;
  const round = state.roundNumber ?? 1;
  if (round < 15) return 0;
  if (round < 30) return Math.max(1, Math.floor(ownedTiles / 16));
  if (round < 50) return Math.max(2, Math.floor(ownedTiles / 12));
  return Math.max(3, Math.floor(ownedTiles / 10));
}

function canBuildStrongTowerNow(state, tile, playerId) {
  const round = state.roundNumber ?? 1;
  return round >= 40 || (isCriticalChokepoint(state, tile, playerId) && isTileThreatenedByEnemy(state, tile, playerId));
}

function hasEnemyWithinDistance(state, tile, playerId, distance) {
  return getNearestEnemyDistance(state, tile, playerId) <= distance;
}

function getNearestEnemyDistance(state, tile, playerId) {
  return state.tiles.reduce((best, candidate) => (
    candidate.ownerId !== null && candidate.ownerId !== playerId
      ? Math.min(best, hexDistance(tile, candidate))
      : best
  ), Infinity);
}

function getNearestOwnBuildingDistance(state, tile, playerId, type) {
  return state.tiles.reduce((best, candidate) => (
    candidate.ownerId === playerId && candidate.building?.type === type
      ? Math.min(best, hexDistance(tile, candidate))
      : best
  ), Infinity);
}

function isTileThreatenedByEnemy(state, tile, playerId) {
  return state.tiles.some((candidate) => (
    candidate.unit?.ownerId !== undefined
    && candidate.unit.ownerId !== playerId
    && hexDistance(candidate, tile) <= 2
  ));
}

function hasImmediateThreat(state, playerId) {
  return getOwnedTiles(state, playerId).some((tile) => isTileThreatenedByEnemy(state, tile, playerId));
}

function isCriticalChokepoint(state, tile, playerId) {
  const ownNeighbors = countOwnedLandNeighbors(state, tile, playerId);
  const hostileNeighbors = getLandNeighbors(state, tile).filter((neighbor) => (
    neighbor.ownerId !== null && neighbor.ownerId !== playerId
  )).length;
  return hostileNeighbors >= 2 && ownNeighbors <= 2;
}

function protectsValuableCluster(state, tile, playerId) {
  const nearbyValue = state.tiles
    .filter((candidate) => candidate.ownerId === playerId && candidate.building && hexDistance(candidate, tile) <= 2)
    .reduce((total, candidate) => total + scoreProtectedBuilding(candidate.building.type), 0);
  return nearbyValue >= 6;
}

function isNeutralOnlyBorder(state, tile, playerId) {
  const neighbors = getLandNeighbors(state, tile).filter((neighbor) => neighbor.ownerId !== playerId);
  return neighbors.length > 0 && neighbors.every((neighbor) => neighbor.ownerId === null);
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

function isFrontTile(state, tile, playerId) {
  return countNonOwnedNeighbors(state, tile, playerId) > 0;
}

function countNonOwnedNeighbors(state, tile, playerId) {
  return getNeighbors(tile, state.tiles).filter((neighbor) => (
    neighbor.terrain !== RULES.terrain.blocked && neighbor.ownerId !== playerId
  )).length;
}

function scoreUnitActivation(state, tile, playerId, plan) {
  const focusTile = getPlanFocusTile(plan);
  const planDistance = focusTile ? hexDistance(tile, focusTile) : 0;
  return tile.unit.level * 8
    + countNonOwnedNeighbors(state, tile, playerId) * 3
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
  const frontPressure = countNonOwnedNeighbors(state, tile, playerId);
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
  return countNonOwnedNeighbors(state, tile, playerId) * 3
    + focusScore
    + targetPressure
    + enemyUnitPressure
    + countAlliedUnitsAround(state, tile, playerId, 2) * 0.8;
}

function scoreDefensiveBuildingTile(state, tile, playerId, plan) {
  const hostileNeighbors = getLandNeighbors(state, tile)
    .filter((neighbor) => neighbor.ownerId !== playerId);
  if (hostileNeighbors.length === 0) {
    return 0;
  }

  const enemyOwnedPressure = hostileNeighbors.filter((neighbor) => neighbor.ownerId !== null).length * 3;
  const neutralPressure = hostileNeighbors.filter((neighbor) => neighbor.ownerId === null).length * 0.8;
  const enemyUnitPressure = hostileNeighbors.reduce((total, neighbor) => (
    total + (neighbor.unit && neighbor.unit.ownerId !== playerId ? 5 + neighbor.unit.level * 2 : 0)
  ), 0);
  const protectedFronts = getLandNeighbors(state, tile)
    .filter((neighbor) => neighbor.ownerId === playerId && isFrontTile(state, neighbor, playerId))
    .length * 2.2;
  const protectedBuildings = getLandNeighbors(state, tile)
    .filter((neighbor) => neighbor.ownerId === playerId && neighbor.building)
    .reduce((total, neighbor) => total + scoreProtectedBuilding(neighbor.building.type), 0);
  const protectedUnits = getLandNeighbors(state, tile)
    .filter((neighbor) => neighbor.unit?.ownerId === playerId)
    .reduce((total, neighbor) => total + 1 + neighbor.unit.level, 0);
  const weakPointBonus = Math.max(0, 4 - calculateTileDefense(state, tile.id)) * 1.3;
  const chokeBonus = hostileNeighbors.length >= 2 && countOwnedLandNeighbors(state, tile, playerId) <= 3 ? 2.5 : 0;
  const planBonus = plan?.frontTile ? Math.max(0, 6 - hexDistance(tile, plan.frontTile)) * 1.2 : 0;
  const towerPenalty = countNearbyDefensiveBuildings(state, tile, playerId, 1) * 8
    + countNearbyDefensiveBuildings(state, tile, playerId, 2) * 2.5;

  return enemyOwnedPressure
    + neutralPressure
    + enemyUnitPressure
    + protectedFronts
    + protectedBuildings
    + protectedUnits
    + weakPointBonus
    + chokeBonus
    + planBonus
    - towerPenalty;
}

function scoreFarmTile(state, tile, playerId, plan = null) {
  const economy = plan?.economy ?? evaluateEconomyPressure(state, playerId);
  return countOwnedLandNeighbors(state, tile, playerId) * 2.2
    + (economy.needsEconomy ? 28 : 0)
    + (getLargestOwnedRegion(playerId, state).some((regionTile) => regionTile.id === tile.id) ? 8 : 0)
    - countNonOwnedNeighbors(state, tile, playerId) * 6
    - countNearbyDefensiveBuildings(state, tile, playerId, 1);
}

function scoreProtectedBuilding(type) {
  if (type === "city") return 5;
  if (type === "farm") return 3;
  return 0;
}

function countOwnedLandNeighbors(state, tile, playerId) {
  return getLandNeighbors(state, tile).filter((neighbor) => neighbor.ownerId === playerId).length;
}

function getLandNeighbors(state, tile) {
  return getNeighbors(tile, state.tiles).filter((neighbor) => neighbor.terrain !== RULES.terrain.blocked);
}

function countAlliedUnitsAround(state, tile, playerId, range, ignoredTileId = null) {
  return state.tiles.filter((candidate) => (
    candidate.id !== ignoredTileId
    && candidate.unit?.ownerId === playerId
    && hexDistance(candidate, tile) <= range
  )).length;
}

function countNearbyDefensiveBuildings(state, tile, playerId, range) {
  return state.tiles.filter((candidate) => (
    candidate.ownerId === playerId
    && candidate.building
    && isDefensiveBuilding(candidate.building.type)
    && hexDistance(candidate, tile) <= range
  )).length;
}

function isDefensiveBuilding(type) {
  return type === "tower" || type === "strongTower";
}
