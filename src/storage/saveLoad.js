import { getNeighbors } from "../core/hexGrid.js";
import { normalizeStatisticsState } from "../core/statistics.js";
import { cleanupUnsupportedSingleTileOccupants } from "../core/territory.js";

const SAVE_KEY = "hex-frontier-save-v1";

export function serializeState(state) {
  return JSON.stringify({
    savedAt: new Date().toISOString(),
    state
  });
}

export function deserializeState(serialized) {
  const payload = JSON.parse(serialized);
  if (!payload?.state || !Array.isArray(payload.state.tiles) || !Array.isArray(payload.state.players)) {
    throw new Error("Invalid save data.");
  }
  normalizeTileOccupancy(payload.state);
  normalizeStatisticsState(payload.state);
  cleanupUnsupportedSingleTileOccupants(payload.state);
  return payload.state;
}

export function saveGame(state, storage = globalThis.localStorage) {
  if (!storage) {
    return { ok: false, message: "localStorage is not available." };
  }
  storage.setItem(SAVE_KEY, serializeState(state));
  return { ok: true, message: "Game saved." };
}

export function loadGame(storage = globalThis.localStorage) {
  if (!storage) {
    return { ok: false, message: "localStorage is not available." };
  }

  const serialized = storage.getItem(SAVE_KEY);
  if (!serialized) {
    return { ok: false, message: "No saved game found." };
  }

  try {
    return { ok: true, state: deserializeState(serialized), message: "Game loaded." };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export function hasSavedGame(storage = globalThis.localStorage) {
  return Boolean(storage?.getItem(SAVE_KEY));
}

function normalizeTileOccupancy(state) {
  for (const tile of state.tiles) {
    if (!tile.unit || !tile.building) continue;

    const target = findUnitRelocationTile(state, tile);
    if (target) {
      target.unit = tile.unit;
    }
    tile.unit = null;
  }
}

function findUnitRelocationTile(state, sourceTile) {
  const candidates = [
    ...getNeighbors(sourceTile, state.tiles),
    ...state.tiles
  ];

  return candidates.find((tile) => (
    tile.id !== sourceTile.id
    && tile.ownerId === sourceTile.unit.ownerId
    && tile.terrain !== "blocked"
    && !tile.unit
    && !tile.building
  )) ?? null;
}
