import { calculateTileDefense, canCapture } from "./combat.js";
import { calculateGrossIncome } from "./economy.js";
import { getConnectedRegions, getNeighbors } from "./hexGrid.js";
import { RULES } from "./rules.js";
import {
  createEmptyLocalPower,
  distanceToAny,
  getLandNeighbors,
  scoreEconomicTarget,
  scorePostCaptureStability,
  scoreUnitPower
} from "./aiUtils.js";

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
