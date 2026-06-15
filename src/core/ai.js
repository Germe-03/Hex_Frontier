import { canBuild, buildBuilding } from "./buildings.js";
import { calculateTileDefense, canCapture, captureTile } from "./combat.js";
import { calculateNetIncome } from "./economy.js";
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

export function runComputerTurn(state) {
  const player = getCurrentPlayer(state);
  if (!player || player.isHuman || state.phase === "finished") {
    return { actions: [] };
  }

  const actions = [];
  let plan = createStrategicPlan(state, player.id);
  actions.push(...captureWithReadyUnits(state, player.id, plan));
  plan = createStrategicPlan(state, player.id);
  actions.push(...buildOneUsefulBuilding(state, player.id, plan));
  actions.push(...buyBorderUnits(state, player.id, 2, plan));
  actions.push(...captureWithReadyUnits(state, player.id, plan));
  plan = createStrategicPlan(state, player.id);
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
    const target = getNeighbors(tile, state.tiles)
      .filter((neighbor) => canCapture(state, tile.id, neighbor.id))
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
  const borderTiles = getOwnedEmptyTiles(state, playerId)
    .filter((tile) => isFrontTile(state, tile, playerId))
    .sort((a, b) => scoreRecruitTile(state, b, playerId, plan) - scoreRecruitTile(state, a, playerId, plan));

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

function createStrategicPlan(state, playerId) {
  const frontTiles = getOwnedTiles(state, playerId)
    .filter((tile) => isFrontTile(state, tile, playerId))
    .map((tile) => ({
      tile,
      score: scoreFrontPlanTile(state, tile, playerId)
    }))
    .sort((a, b) => b.score - a.score);

  const best = frontTiles[0];
  return best ? { frontTile: best.tile, score: best.score } : null;
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
  const buildingScore = tile.building ? 2 : 0;
  const planScore = plan?.frontTile ? Math.max(0, 6 - hexDistance(tile, plan.frontTile)) * 0.9 : 0;
  const supportScore = countAlliedUnitsAround(state, tile, playerId, 2, sourceTile.id) * 1.5;
  return ownerScore + defenseScore + buildingScore + planScore + supportScore;
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
  const enemyUnitPressure = getLandNeighbors(state, tile).reduce((total, neighbor) => (
    total + (neighbor.unit && neighbor.unit.ownerId !== playerId ? 3 + neighbor.unit.level * 2 : 0)
  ), 0);
  return countNonOwnedNeighbors(state, tile, playerId) * 3
    + focusScore
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
