import { getBuildingCost } from "./buildings.js";
import { calculateTileDefense } from "./combat.js";
import { getOwnedTiles, getPlayer } from "./gameState.js";
import { hexDistance } from "./hexGrid.js";
import { RULES } from "./rules.js";
import {
  countNearbyDefensiveBuildings,
  countOwnedLandNeighbors,
  getLandNeighbors,
  isDefensiveBuilding,
  isFrontTile,
  scoreProtectedBuilding
} from "./aiUtils.js";
import { getBestNeutralExpansion } from "./aiTerritory.js";

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

export function shouldSuppressTowerBuilding(state, playerId, plan) {
  const neutralPlan = plan?.neutralPlan ?? getBestNeutralExpansion(state, playerId);
  if (neutralPlan && neutralPlan.score >= 100 && !hasImmediateThreat(state, playerId)) {
    return true;
  }
  if (plan?.mode === "BUILD_ECONOMY" && !hasImmediateThreat(state, playerId)) {
    return true;
  }
  return false;
}

export function getTowerBuildThreshold(state) {
  const round = state.roundNumber ?? 1;
  if (round < 15) return 24;
  if (round < 30) return 20;
  return 16;
}

export function scoreDefensiveBuildingTile(state, tile, playerId, plan) {
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

export function hasImmediateThreat(state, playerId) {
  return getOwnedTiles(state, playerId).some((tile) => isTileThreatenedByEnemy(state, tile, playerId));
}

export function isTileThreatenedByEnemy(state, tile, playerId) {
  return state.tiles.some((candidate) => (
    candidate.unit?.ownerId !== undefined
    && candidate.unit.ownerId !== playerId
    && hexDistance(candidate, tile) <= 2
  ));
}

export function getTowerCount(state, playerId) {
  return state.tiles.filter((tile) => (
    tile.ownerId === playerId && tile.building && isDefensiveBuilding(tile.building.type)
  )).length;
}

export function getMaxTowerCount(state, playerId) {
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

function getNearestEnemyDistance(state, tile, playerId) {
  return state.tiles.reduce((best, candidate) => (
    candidate.ownerId !== null && candidate.ownerId !== playerId
      ? Math.min(best, hexDistance(tile, candidate))
      : best
  ), Infinity);
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
