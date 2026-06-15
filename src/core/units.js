import { getPlayer, getTile } from "./gameState.js";
import { getNeighbors } from "./hexGrid.js";
import { RULES, getMaxUnitLevel, getUnitRule } from "./rules.js";
import { cleanupUnsupportedSingleTileOccupants } from "./territory.js";

export function createUnit(ownerId, level = 1) {
  return {
    ownerId,
    level,
    acted: false
  };
}

export function resetUnitsForPlayer(state, playerId) {
  for (const tile of state.tiles) {
    if (tile.unit?.ownerId === playerId) {
      tile.unit.acted = false;
    }
  }
}

export function getPlayerUnitTiles(state, playerId) {
  return state.tiles.filter((tile) => tile.unit?.ownerId === playerId);
}

export function canBuyUnit(state, tileId, level = 1) {
  const tile = getTile(state, tileId);
  const player = getPlayer(state, state.currentPlayerId);
  const rule = getUnitRule(level);
  if (!tile || !player || !rule) return false;
  return tile.terrain !== RULES.terrain.blocked
    && tile.ownerId === player.id
    && !tile.unit
    && !tile.building
    && player.money >= rule.cost;
}

export function buyUnit(state, tileId, level = 1) {
  if (!canBuyUnit(state, tileId, level)) {
    return { ok: false, message: "A unit can only be bought on an owned empty tile without a building and with enough money." };
  }
  const tile = getTile(state, tileId);
  const player = getPlayer(state, state.currentPlayerId);
  const rule = getUnitRule(level);
  player.money -= rule.cost;
  tile.unit = createUnit(player.id, level);
  const cleanupEvents = cleanupUnsupportedSingleTileOccupants(state, [player.id]);
  const removedBoughtUnit = cleanupEvents.some((event) => (
    event.tileId === tile.id && event.type === "isolatedUnitRemoved"
  ));
  if (removedBoughtUnit) {
    return { ok: true, message: `${rule.name} was lost because the field is isolated.` };
  }
  return { ok: true, message: `${rule.name} bought.` };
}

export function getUpgradeCost(level) {
  const current = getUnitRule(level);
  const next = getUnitRule(level + 1);
  if (!current || !next) return null;
  return Math.max(0, next.cost - current.cost);
}

export function canUpgradeUnit(state, tileId) {
  const tile = getTile(state, tileId);
  const player = getPlayer(state, state.currentPlayerId);
  if (!tile?.unit || !player) return false;
  if (tile.unit.ownerId !== player.id || tile.unit.acted) return false;
  if (tile.unit.level >= getMaxUnitLevel()) return false;
  return player.money >= getUpgradeCost(tile.unit.level);
}

export function upgradeUnit(state, tileId) {
  if (!canUpgradeUnit(state, tileId)) {
    return { ok: false, message: "That unit cannot upgrade now." };
  }
  const tile = getTile(state, tileId);
  const player = getPlayer(state, state.currentPlayerId);
  const cost = getUpgradeCost(tile.unit.level);
  player.money -= cost;
  tile.unit.level += 1;
  tile.unit.acted = true;
  return { ok: true, message: `Unit upgraded to level ${tile.unit.level}.` };
}

export function canMoveInsideOwnedTerritory(state, fromId, toId) {
  const from = getTile(state, fromId);
  const to = getTile(state, toId);
  const player = getPlayer(state, state.currentPlayerId);
  if (!from || !to || !player) return false;
  if (!from.unit || from.unit.ownerId !== player.id || from.unit.acted) return false;
  if (to.terrain === RULES.terrain.blocked || to.ownerId !== player.id) return false;
  if (to.building) return false;
  if (from.id === to.id) return false;
  if (!getReachableOwnedMoveTiles(state, fromId).some((tile) => tile.id === toId)) return false;
  if (!to.unit) return true;
  return to.unit.ownerId === player.id
    && to.unit.level === from.unit.level
    && to.unit.level < getMaxUnitLevel();
}

export function moveInsideOwnedTerritory(state, fromId, toId) {
  if (!canMoveInsideOwnedTerritory(state, fromId, toId)) {
    return { ok: false, message: "Units move up to five owned land tiles or merge with a same-level unit." };
  }

  const from = getTile(state, fromId);
  const to = getTile(state, toId);
  if (!to.unit) {
    to.unit = from.unit;
    to.unit.acted = true;
    from.unit = null;
    return { ok: true, message: "Unit moved." };
  }

  to.unit.level += 1;
  to.unit.acted = true;
  from.unit = null;
  return { ok: true, message: `Units merged into level ${to.unit.level}.` };
}

export function getReachableOwnedMoveTiles(state, fromId, range = RULES.movement.ownedTerritoryRange) {
  const from = getTile(state, fromId);
  const player = getPlayer(state, state.currentPlayerId);
  if (!from?.unit || !player || from.unit.ownerId !== player.id || from.unit.acted) {
    return [];
  }

  const visited = new Set([from.id]);
  const queue = [{ tile: from, distance: 0 }];
  const reachable = [];

  while (queue.length > 0) {
    const { tile, distance } = queue.shift();
    if (distance >= range) continue;

    for (const neighbor of getNeighbors(tile, state.tiles)) {
      if (visited.has(neighbor.id)) continue;
      if (neighbor.terrain === RULES.terrain.blocked || neighbor.ownerId !== player.id) continue;

      visited.add(neighbor.id);
      queue.push({ tile: neighbor, distance: distance + 1 });

      if (canEndMoveOnTile(from, neighbor)) {
        reachable.push(neighbor);
      }
    }
  }

  return reachable;
}

function canEndMoveOnTile(from, to) {
  if (to.building) {
    return false;
  }
  if (!to.unit) {
    return true;
  }
  return to.unit.ownerId === from.unit.ownerId
    && to.unit.level === from.unit.level
    && to.unit.level < getMaxUnitLevel();
}
