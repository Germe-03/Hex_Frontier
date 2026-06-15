import { getPlayer, getTile } from "./gameState.js";
import { RULES, getBuildingRule } from "./rules.js";
import { cleanupUnsupportedSingleTileOccupants } from "./territory.js";

export function createBuilding(type) {
  return { type };
}

export function countPlayerBuildings(state, playerId, type) {
  return state.tiles.filter((tile) => tile.ownerId === playerId && tile.building?.type === type).length;
}

export function getBuildingCost(state, playerId, type) {
  const rule = getBuildingRule(type);
  if (!rule) return null;

  if (type === "city") {
    const ownedCities = countPlayerBuildings(state, playerId, "city");
    const paidCities = Math.max(0, ownedCities - 1);
    return rule.cost + paidCities * (rule.costIncrement ?? 0);
  }

  return rule.cost;
}

export function canBuild(state, tileId, type) {
  const tile = getTile(state, tileId);
  const player = getPlayer(state, state.currentPlayerId);
  const rule = getBuildingRule(type);
  const cost = player ? getBuildingCost(state, player.id, type) : null;
  if (!tile || !player || !rule) return false;
  return tile.terrain !== RULES.terrain.blocked
    && tile.ownerId === player.id
    && !tile.unit
    && !tile.building
    && cost !== null
    && player.money >= cost;
}

export function buildBuilding(state, tileId, type) {
  if (!canBuild(state, tileId, type)) {
    return { ok: false, message: "Buildings need an owned empty land tile and enough money." };
  }

  const tile = getTile(state, tileId);
  const player = getPlayer(state, state.currentPlayerId);
  const rule = getBuildingRule(type);
  const cost = getBuildingCost(state, player.id, type);
  player.money -= cost;
  tile.building = createBuilding(type);
  const cleanupEvents = cleanupUnsupportedSingleTileOccupants(state, [player.id]);
  const removedBuiltTower = cleanupEvents.some((event) => (
    event.tileId === tile.id && event.type === "isolatedTowerRemoved"
  ));
  if (removedBuiltTower) {
    return { ok: true, message: `${rule.name} was lost because the field is isolated.` };
  }
  return { ok: true, message: `${rule.name} built.` };
}
