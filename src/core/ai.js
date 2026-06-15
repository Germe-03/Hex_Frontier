import { canBuild, buildBuilding } from "./buildings.js";
import { calculateTileDefense, canCapture, captureTile } from "./combat.js";
import { calculateGrossIncome, calculateNetIncome } from "./economy.js";
import { getCurrentPlayer, getOwnedTiles } from "./gameState.js";
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
  const player = getCurrentPlayer(state);
  if (!player || player.isHuman || state.phase === "finished") {
    return { actions: [] };
  }

  const actions = [];
  const plan = createStrategicPlan(state, player.id);
  actions.push(...captureWithReadyUnits(state, player.id, plan));
  actions.push(...buildOneUsefulBuilding(state, player.id, plan));
  actions.push(...buyBorderUnits(state, player.id, 2, plan));
  actions.push(...captureWithReadyUnits(state, player.id, plan));
  actions.push(...moveUnitsTowardFront(state, player.id, plan));
  actions.push(...upgradeOneUnit(state, player.id));
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
  if (!player || calculateNetIncome(state, playerId) < 2) {
    return [];
  }

  const defensiveCandidate = getOwnedEmptyTiles(state, playerId)
    .filter((tile) => countNearbyDefensiveBuildings(state, tile, playerId, 1) === 0)
    .map((tile) => ({
      tile,
      score: scoreDefensiveBuildingTile(state, tile, playerId, plan)
    }))
    .filter((candidate) => candidate.score >= 9)
    .sort((a, b) => b.score - a.score)[0];

  if (defensiveCandidate) {
    const reserve = RULES.units[1].cost;
    const type = defensiveCandidate.score >= 19
      && player.money >= RULES.buildings.strongTower.cost + reserve
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
    .sort((a, b) => scoreFarmTile(state, b, playerId) - scoreFarmTile(state, a, playerId))[0]
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
  const fronts = collectEnemyFronts(state, playerId)
    .map((front) => scoreFront(state, playerId, front.enemyId))
    .filter((front) => front.score > -Infinity)
    .sort((a, b) => b.score - a.score);

  if (fronts.length === 0) {
    return createFallbackFrontPlan(state, playerId);
  }

  const chosen = choosePersistentFront(state, playerId, fronts);
  const frontTile = chooseOwnFrontTile(state, playerId, chosen);

  return {
    ...chosen,
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

function filterCaptureTargetsForPlan(targets, plan) {
  if (!plan?.targetPlayerId) {
    return targets;
  }

  const targetEnemyTiles = plan.localPower?.canAttack
    ? targets.filter((tile) => tile.ownerId === plan.targetPlayerId)
    : [];
  const frontNeutralTiles = targets.filter((tile) => (
    tile.ownerId === null && plan.frontTile && hexDistance(tile, plan.frontTile) <= 2
  ));
  return [...targetEnemyTiles, ...frontNeutralTiles];
}

function createFallbackFrontPlan(state, playerId) {
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
  const planDistance = plan?.frontTile ? hexDistance(tile, plan.frontTile) : 0;
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
  const planScore = plan?.frontTile ? Math.max(0, 6 - hexDistance(tile, plan.frontTile)) * 0.9 : 0;
  const supportScore = countAlliedUnitsAround(state, tile, playerId, 2, sourceTile.id) * 1.5;
  const targetFocusScore = plan?.targetPlayerId === tile.ownerId ? 10 : 0;
  const finishScore = plan?.targetPlayerId === tile.ownerId ? plan.finishPotential * 0.35 : 0;
  const cutoffScore = estimateCutoffValue(state, playerId, tile.id) * 2.2;
  const stabilityScore = scorePostCaptureStability(state, playerId, tile) * 1.4;

  return ownerScore
    + defenseScore
    + buildingScore
    + planScore
    + supportScore
    + targetFocusScore
    + finishScore
    + cutoffScore
    + stabilityScore;
}

function scoreMoveTarget(state, tile, playerId, plan, sourceTile) {
  const focusDistance = plan?.frontTile ? hexDistance(tile, plan.frontTile) : 0;
  const sourceDistance = plan?.frontTile ? hexDistance(sourceTile, plan.frontTile) : focusDistance;
  const distanceImprovement = plan?.frontTile ? sourceDistance - focusDistance : 0;
  const frontPressure = countNonOwnedNeighbors(state, tile, playerId);
  const adjacentAllies = countAlliedUnitsAround(state, tile, playerId, 1, sourceTile.id);
  const nearbyAllies = countAlliedUnitsAround(state, tile, playerId, 2, sourceTile.id);
  const mergeBonus = tile.unit?.ownerId === playerId && tile.unit.level === sourceTile.unit?.level ? 5 : 0;

  return frontPressure * 2.3
    + distanceImprovement * 4
    + (plan?.frontTile ? Math.max(0, 6 - focusDistance) * 0.9 : 0)
    + adjacentAllies * 2.6
    + nearbyAllies * 1.2
    + mergeBonus;
}

function scoreRecruitTile(state, tile, playerId, plan) {
  const focusScore = plan?.frontTile ? Math.max(0, 6 - hexDistance(tile, plan.frontTile)) * 1.4 : 0;
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

function scoreFarmTile(state, tile, playerId) {
  return countOwnedLandNeighbors(state, tile, playerId) * 1.5
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
