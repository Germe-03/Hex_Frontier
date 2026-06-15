import { getConnectedRegions, hexDistance } from "./hexGrid.js";
import { RULES } from "./rules.js";

export function normalizeRegionalCities(state, playerIds = state.players.map((player) => player.id)) {
  const events = [];

  for (const playerId of playerIds) {
    const regions = getConnectedRegions(state.tiles, playerId);
    for (const region of regions) {
      events.push(...normalizeRegionCities(region));
      events.push(...cleanupSingleTileRegion(region));
    }
  }

  return events;
}

export function cleanupUnsupportedSingleTileOccupants(state, playerIds = state.players.map((player) => player.id)) {
  const events = [];

  for (const playerId of playerIds) {
    const regions = getConnectedRegions(state.tiles, playerId);
    for (const region of regions) {
      events.push(...cleanupSingleTileRegion(region));
    }
  }

  return events;
}

export function getIncomeEligibleTiles(state, playerId) {
  return getConnectedRegions(state.tiles, playerId)
    .filter((region) => region.some((tile) => tile.building?.type === "city"))
    .flat();
}

function normalizeRegionCities(region) {
  const events = [];
  const cityTiles = region.filter((tile) => tile.building?.type === "city");

  if (region.length < RULES.cities.minimumRegionSize) {
    for (const tile of cityTiles) {
      tile.building = null;
      events.push({ type: "cityRemovedSmallRegion", tileId: tile.id });
    }
    return events;
  }

  if (cityTiles.length === 0) {
    const spawnTile = chooseCitySpawnTile(region);
    if (spawnTile) {
      spawnTile.building = { type: "city" };
      events.push({ type: "citySpawned", tileId: spawnTile.id });
    }
    return events;
  }

  const keepTile = chooseCityToKeep(region, cityTiles);
  for (const tile of cityTiles) {
    if (tile.id === keepTile.id) continue;
    tile.building = null;
    events.push({ type: "cityRemovedMergedRegion", tileId: tile.id, keptTileId: keepTile.id });
  }

  return events;
}

function cleanupSingleTileRegion(region) {
  const events = [];
  if (region.length !== 1) {
    return events;
  }

  const [tile] = region;
  if (tile.unit) {
    const oldLevel = tile.unit.level;
    tile.unit = null;
    events.push({
      type: "isolatedUnitRemoved",
      tileId: tile.id,
      from: oldLevel,
      to: 0
    });
  }

  if (tile.building?.type === "tower" || tile.building?.type === "strongTower") {
    const oldType = tile.building.type;
    tile.building = null;
    events.push({
      type: "isolatedTowerRemoved",
      tileId: tile.id,
      from: oldType,
      to: null
    });
  }

  return events;
}

function chooseCitySpawnTile(region) {
  return [...region]
    .filter((tile) => !tile.unit && !tile.building)
    .sort((a, b) => scoreCityTile(b, region) - scoreCityTile(a, region))[0] ?? null;
}

function chooseCityToKeep(region, cityTiles) {
  return [...cityTiles]
    .sort((a, b) => scoreCityTile(b, region) - scoreCityTile(a, region))[0];
}

function scoreCityTile(tile, region) {
  const centerDistance = averageDistanceToRegion(tile, region);
  const emptyBonus = !tile.unit ? 2 : -8;
  const noBuildingBonus = !tile.building ? 4 : tile.building.type === "city" ? 1 : -4;
  return noBuildingBonus + emptyBonus - centerDistance;
}

function averageDistanceToRegion(tile, region) {
  const total = region.reduce((sum, other) => sum + hexDistance(tile, other), 0);
  return total / Math.max(1, region.length);
}
