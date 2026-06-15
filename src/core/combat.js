import { getTile } from "./gameState.js";
import { areNeighbors, buildTileMap, getNeighbors } from "./hexGrid.js";
import { RULES, getBuildingRule, getMaxUnitLevel, getUnitRule } from "./rules.js";
import { normalizeRegionalCities } from "./territory.js";

export function calculateTileDefense(state, tileId) {
  const tile = getTile(state, tileId);
  if (!tile || tile.terrain === RULES.terrain.blocked) {
    return Infinity;
  }

  let defense = tile.ownerId === null
    ? RULES.combat.neutralDefense
    : RULES.combat.ownedBaseDefense;

  const unitProtectionLevel = getUnitProtectionLevel(state, tileId);
  if (unitProtectionLevel > 0) {
    defense += getUnitRule(unitProtectionLevel)?.strength ?? 0;
  }

  if (tile.building) {
    defense += getBuildingRule(tile.building.type)?.defense ?? 0;
  }

  if (tile.ownerId !== null) {
    const tileMap = buildTileMap(state.tiles);
    for (const neighbor of getNeighbors(tile, tileMap)) {
      if (neighbor.ownerId !== tile.ownerId || !neighbor.building) continue;
      defense += getBuildingRule(neighbor.building.type)?.auraDefense ?? 0;
    }
  }

  return defense;
}

export function canCapture(state, fromId, toId) {
  const from = getTile(state, fromId);
  const to = getTile(state, toId);
  if (!from || !to || !from.unit) return false;
  if (from.unit.ownerId !== state.currentPlayerId || from.unit.acted) return false;
  if (to.terrain === RULES.terrain.blocked || to.ownerId === from.unit.ownerId) return false;
  if (!areNeighbors(from, to)) return false;

  const attackerLevel = from.unit.level;
  const protectedLevel = getUnitProtectionLevel(state, toId);
  if (!canDefeatProtectedLevel(attackerLevel, protectedLevel)) {
    return false;
  }

  if (attackerLevel < getRequiredBuildingCaptureLevel(to)) {
    return false;
  }

  const attackerStrength = getUnitRule(from.unit.level)?.strength ?? 0;
  return attackerStrength > calculateStaticTileDefense(state, toId);
}

export function captureTile(state, fromId, toId) {
  if (!canCapture(state, fromId, toId)) {
    return { ok: false, message: "The attacking unit must beat nearby protection and tower requirements." };
  }

  const from = getTile(state, fromId);
  const to = getTile(state, toId);
  const previousOwnerId = to.ownerId;
  const movingUnit = from.unit;
  to.ownerId = movingUnit.ownerId;
  to.unit = movingUnit;
  to.unit.acted = true;
  to.building = null;
  from.unit = null;
  normalizeRegionalCities(state, [movingUnit.ownerId, previousOwnerId].filter((ownerId) => ownerId !== null));

  return { ok: true, message: "Tile captured." };
}

export function getUnitProtectionLevel(state, tileId) {
  const tile = getTile(state, tileId);
  if (!tile || tile.ownerId === null || tile.terrain === RULES.terrain.blocked) {
    return 0;
  }

  let protectedLevel = tile.unit?.ownerId === tile.ownerId ? tile.unit.level : 0;
  const tileMap = buildTileMap(state.tiles);
  for (const neighbor of getNeighbors(tile, tileMap)) {
    if (neighbor.ownerId !== tile.ownerId || neighbor.unit?.ownerId !== tile.ownerId) {
      continue;
    }
    protectedLevel = Math.max(protectedLevel, neighbor.unit.level);
  }

  return protectedLevel;
}

export function canDefeatProtectedLevel(attackerLevel, protectedLevel) {
  if (protectedLevel <= 0) {
    return true;
  }
  const maxLevel = getMaxUnitLevel();
  return attackerLevel > protectedLevel || (attackerLevel === maxLevel && protectedLevel === maxLevel);
}

export function getRequiredBuildingCaptureLevel(tile) {
  if (!tile?.building) {
    return 1;
  }
  return getBuildingRule(tile.building.type)?.requiredCaptureLevel ?? 1;
}

function calculateStaticTileDefense(state, tileId) {
  const tile = getTile(state, tileId);
  if (!tile || tile.terrain === RULES.terrain.blocked) {
    return Infinity;
  }

  let defense = tile.ownerId === null
    ? RULES.combat.neutralDefense
    : RULES.combat.ownedBaseDefense;

  if (tile.building) {
    defense += getBuildingRule(tile.building.type)?.defense ?? 0;
  }

  if (tile.ownerId !== null) {
    const tileMap = buildTileMap(state.tiles);
    for (const neighbor of getNeighbors(tile, tileMap)) {
      if (neighbor.ownerId !== tile.ownerId || !neighbor.building) continue;
      defense += getBuildingRule(neighbor.building.type)?.auraDefense ?? 0;
    }
  }

  return defense;
}
