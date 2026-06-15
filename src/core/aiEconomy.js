import { getBuildingCost } from "./buildings.js";
import { calculateGrossIncome, calculateTotalUpkeep } from "./economy.js";
import { getPlayer } from "./gameState.js";
import { hexDistance } from "./hexGrid.js";
import { RULES } from "./rules.js";
import {
  countNearbyDefensiveBuildings,
  countNonOwnedLandNeighbors,
  countOwnedLandNeighbors
} from "./aiUtils.js";
import {
  getLargestOwnedRegion,
  scoreExpansionCompactness
} from "./aiTerritory.js";

export function evaluateEconomyPressure(state, playerId) {
  const grossIncome = calculateGrossIncome(state, playerId);
  const upkeep = calculateTotalUpkeep(state, playerId);
  const netIncome = grossIncome - upkeep;
  const upkeepRatio = upkeep / Math.max(1, grossIncome);
  return {
    grossIncome,
    upkeep,
    netIncome,
    upkeepRatio,
    lowNetScore: Math.max(0, 5 - netIncome) * 12,
    upkeepRatioScore: upkeepRatio > 0.5 ? (upkeepRatio - 0.5) * 80 : 0,
    needsEconomy: netIncome < 5 || upkeepRatio > 0.5
  };
}

export function canBuildTownSmart(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  const player = getPlayer(state, playerId);
  if (!tile || !player || tile.terrain === RULES.terrain.blocked) return false;
  if (tile.ownerId !== playerId || tile.unit || tile.building) return false;
  if (player.money < (getBuildingCost(state, playerId, "city") ?? Infinity)) return false;
  if (countOwnedLandNeighbors(state, tile, playerId) < 4) return false;
  if (hasEnemyWithinDistance(state, tile, playerId, 2)) return false;
  if (getNearestOwnBuildingDistance(state, tile, playerId, "city") <= 3) return false;

  const largestRegionIds = new Set(getLargestOwnedRegion(playerId, state).map((regionTile) => regionTile.id));
  return largestRegionIds.has(tile.id);
}

export function scoreTownBuild(tileId, playerId, state) {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile || tile.ownerId !== playerId || tile.unit || tile.building) {
    return -Infinity;
  }

  const economy = evaluateEconomyPressure(state, playerId);
  const smartPlacementScore = canBuildTownSmart(tileId, playerId, state) ? 35 : -45;
  return smartPlacementScore
    + economy.lowNetScore
    + economy.upkeepRatioScore
    + countOwnedLandNeighbors(state, tile, playerId) * 5
    + scoreExpansionCompactness(tileId, playerId, state) * 0.5;
}

export function scoreFarmTile(state, tile, playerId, plan = null) {
  const economy = plan?.economy ?? evaluateEconomyPressure(state, playerId);
  return countOwnedLandNeighbors(state, tile, playerId) * 2.2
    + (economy.needsEconomy ? 28 : 0)
    + (getLargestOwnedRegion(playerId, state).some((regionTile) => regionTile.id === tile.id) ? 8 : 0)
    - countNonOwnedLandNeighbors(state, tile, playerId) * 6
    - countNearbyDefensiveBuildings(state, tile, playerId, 1);
}

export function getUnitBuyLimit(state, playerId, plan) {
  if (!plan || plan.mode === "ELIMINATED_SKIP") return 0;
  if (plan.mode === "BUILD_ECONOMY") return 0;
  if (plan.economy?.upkeepRatio > 0.5 || plan.economy?.netIncome < 5) return 1;
  if (plan.mode === "CLEANUP_NEUTRAL_FIELDS" || plan.mode === "RECONNECT_REGIONS") return 1;
  return 2;
}

export function getEconomyBuildThreshold(state, playerId, plan) {
  if (plan?.mode === "BUILD_ECONOMY") return 25;
  if (plan?.mode === "CLEANUP_NEUTRAL_FIELDS" || plan?.mode === "RECONNECT_REGIONS") return 60;
  return evaluateEconomyPressure(state, playerId).needsEconomy ? 35 : 85;
}

function hasEnemyWithinDistance(state, tile, playerId, distance) {
  return state.tiles.some((candidate) => (
    candidate.ownerId !== null
    && candidate.ownerId !== playerId
    && hexDistance(tile, candidate) <= distance
  ));
}

function getNearestOwnBuildingDistance(state, tile, playerId, type) {
  return state.tiles.reduce((best, candidate) => (
    candidate.ownerId === playerId && candidate.building?.type === type
      ? Math.min(best, hexDistance(tile, candidate))
      : best
  ), Infinity);
}
