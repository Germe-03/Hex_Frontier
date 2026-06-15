import { getNeighbors, hexDistance } from "./hexGrid.js";
import { RULES, getUnitRule } from "./rules.js";

export function getLandNeighbors(state, tile) {
  return getNeighbors(tile, state.tiles).filter((neighbor) => neighbor.terrain !== RULES.terrain.blocked);
}

export function countOwnedLandNeighbors(state, tile, playerId) {
  return getLandNeighbors(state, tile).filter((neighbor) => neighbor.ownerId === playerId).length;
}

export function countNonOwnedLandNeighbors(state, tile, playerId) {
  return getLandNeighbors(state, tile).filter((neighbor) => neighbor.ownerId !== playerId).length;
}

export function isFrontTile(state, tile, playerId) {
  return countNonOwnedLandNeighbors(state, tile, playerId) > 0;
}

export function countAlliedUnitsAround(state, tile, playerId, range, ignoredTileId = null) {
  return state.tiles.filter((candidate) => (
    candidate.id !== ignoredTileId
    && candidate.unit?.ownerId === playerId
    && hexDistance(candidate, tile) <= range
  )).length;
}

export function countNearbyDefensiveBuildings(state, tile, playerId, range) {
  return state.tiles.filter((candidate) => (
    candidate.ownerId === playerId
    && candidate.building
    && isDefensiveBuilding(candidate.building.type)
    && hexDistance(candidate, tile) <= range
  )).length;
}

export function isDefensiveBuilding(type) {
  return type === "tower" || type === "strongTower";
}

export function distanceToAny(tile, targets) {
  return targets.reduce((best, target) => Math.min(best, hexDistance(tile, target)), Infinity);
}

export function scoreUnitPower(unit) {
  if (!unit) {
    return 0;
  }

  return (getUnitRule(unit.level)?.strength ?? unit.level) + unit.level * 0.35;
}

export function scoreEconomicTarget(tile) {
  if (!tile.building) {
    return tile.unit ? scoreUnitPower(tile.unit) * 0.4 : 0;
  }

  if (tile.building.type === "city") return 9;
  if (tile.building.type === "farm") return 5;
  if (tile.building.type === "strongTower") return 4;
  if (tile.building.type === "tower") return 3;
  return 1;
}

export function scoreProtectedBuilding(type) {
  if (type === "city") return 5;
  if (type === "farm") return 3;
  return 0;
}

export function scorePostCaptureStability(state, playerId, tile) {
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

export function createEmptyLocalPower() {
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
