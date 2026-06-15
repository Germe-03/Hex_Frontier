import { buildBuilding } from "./buildings.js";
import { canCapture, captureTile } from "./combat.js";
import { getTile, setMessage } from "./gameState.js";
import { getNeighbors } from "./hexGrid.js";
import { buyUnit, canMoveInsideOwnedTerritory, getReachableOwnedMoveTiles, moveInsideOwnedTerritory, upgradeUnit } from "./units.js";
import { updateEliminations } from "./turnSystem.js";

export function selectTile(state, tileId) {
  const tile = getTile(state, tileId);
  if (!tile) {
    state.selectedTileId = null;
    return null;
  }
  state.selectedTileId = tileId;
  return tile;
}

export function buyLevelOneOnSelected(state) {
  const result = buyUnit(state, state.selectedTileId, 1);
  setMessage(state, result.message);
  return result;
}

export function upgradeSelectedUnit(state) {
  const result = upgradeUnit(state, state.selectedTileId);
  setMessage(state, result.message);
  return result;
}

export function buildOnSelected(state, type) {
  const result = buildBuilding(state, state.selectedTileId, type);
  setMessage(state, result.message);
  return result;
}

export function moveOrCaptureSelectedTo(state, targetTileId) {
  const sourceId = state.selectedTileId;
  if (!sourceId || sourceId === targetTileId) {
    selectTile(state, targetTileId);
    return { ok: true, message: "Tile selected." };
  }

  let result;
  if (canMoveInsideOwnedTerritory(state, sourceId, targetTileId)) {
    result = moveInsideOwnedTerritory(state, sourceId, targetTileId);
  } else if (canCapture(state, sourceId, targetTileId)) {
    result = captureTile(state, sourceId, targetTileId);
    updateEliminations(state);
  } else {
    result = { ok: false, message: "That move or capture is not valid." };
  }

  if (result.ok) {
    state.selectedTileId = targetTileId;
  }
  setMessage(state, result.message);
  return result;
}

export function getLegalDestinations(state, tileId) {
  const tile = getTile(state, tileId);
  if (!tile?.unit || tile.unit.ownerId !== state.currentPlayerId || tile.unit.acted) {
    return { moves: [], captures: [] };
  }

  const moves = [];
  const captures = [];
  for (const moveTile of getReachableOwnedMoveTiles(state, tileId)) {
    moves.push(moveTile.id);
  }
  for (const neighbor of getNeighbors(tile, state.tiles)) {
    if (canCapture(state, tileId, neighbor.id)) {
      captures.push(neighbor.id);
    }
  }
  return { moves, captures };
}
