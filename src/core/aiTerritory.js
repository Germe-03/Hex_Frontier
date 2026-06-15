import { getConnectedRegions } from "./hexGrid.js";
import { RULES } from "./rules.js";
import {
  countOwnedLandNeighbors,
  getLandNeighbors
} from "./aiUtils.js";

export function getOwnedRegions(playerId, state) {
  return getConnectedRegions(state.tiles, playerId)
    .sort((a, b) => b.length - a.length);
}

export function getLargestOwnedRegion(playerId, state) {
  return getOwnedRegions(playerId, state)[0] ?? [];
}

export function getDisconnectedRegionCount(playerId, state) {
  return Math.max(0, getOwnedRegions(playerId, state).length - 1);
}

export function wouldConnectOwnRegions(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.terrain === RULES.terrain.blocked || tile.ownerId === playerId) {
    return false;
  }

  const regionIds = getAdjacentOwnedRegionIds(tile, playerId, state);
  return regionIds.size >= 2;
}

export function wouldFillNeutralHole(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.ownerId !== null || tile.terrain === RULES.terrain.blocked) {
    return false;
  }

  return countOwnedLandNeighbors(state, tile, playerId) >= 3;
}

export function scoreExpansionCompactness(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.terrain === RULES.terrain.blocked) {
    return -Infinity;
  }

  const ownNeighbors = countOwnedLandNeighbors(state, tile, playerId);
  const hostileNeighbors = getLandNeighbors(state, tile).filter((neighbor) => (
    neighbor.ownerId !== null && neighbor.ownerId !== playerId
  )).length;
  const neutralNeighbors = getLandNeighbors(state, tile).filter((neighbor) => neighbor.ownerId === null).length;
  const largestRegionIds = new Set(getLargestOwnedRegion(playerId, state).map((regionTile) => regionTile.id));
  const touchesLargestRegion = getLandNeighbors(state, tile).some((neighbor) => largestRegionIds.has(neighbor.id));

  return ownNeighbors * 7
    + (touchesLargestRegion ? 10 : 0)
    + (wouldConnectOwnRegions(tileId, playerId, state) ? 35 : 0)
    - hostileNeighbors * 4
    - neutralNeighbors * 0.8
    - (ownNeighbors <= 1 ? 20 : 0);
}

export function scoreNeutralExpansion(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.ownerId !== null || tile.terrain === RULES.terrain.blocked) {
    return -Infinity;
  }

  const ownNeighbors = countOwnedLandNeighbors(state, tile, playerId);
  if (ownNeighbors === 0) {
    return -Infinity;
  }

  const round = state.roundNumber ?? 1;
  const holeBonus = ownNeighbors >= 4 ? 120 : ownNeighbors === 3 ? 55 : 0;
  const lateBonus = round >= 40 ? 85 : round >= 25 ? 35 : 0;
  const connectBonus = wouldConnectOwnRegions(tileId, playerId, state) ? 95 : 0;
  return 12
    + ownNeighbors * 11
    + holeBonus
    + lateBonus
    + connectBonus
    + scoreExpansionCompactness(tileId, playerId, state);
}

export function getBestNeutralExpansion(state, playerId) {
  return state.tiles
    .filter((tile) => tile.ownerId === null && tile.terrain !== RULES.terrain.blocked)
    .filter((tile) => countOwnedLandNeighbors(state, tile, playerId) > 0)
    .map((tile) => ({
      tile,
      score: scoreNeutralExpansion(tile.id, playerId, state),
      fillsHole: wouldFillNeutralHole(tile.id, playerId, state),
      connectsRegions: wouldConnectOwnRegions(tile.id, playerId, state)
    }))
    .sort((a, b) => b.score - a.score)[0] ?? null;
}

function getAdjacentOwnedRegionIds(tile, playerId, state) {
  const regionByTileId = new Map();
  for (const [regionIndex, region] of getOwnedRegions(playerId, state).entries()) {
    for (const regionTile of region) {
      regionByTileId.set(regionTile.id, regionIndex);
    }
  }

  return new Set(
    getLandNeighbors(state, tile)
      .filter((neighbor) => neighbor.ownerId === playerId)
      .map((neighbor) => regionByTileId.get(neighbor.id))
      .filter((regionId) => regionId !== undefined)
  );
}
