import { getPlayer } from "./gameState.js";
import { RULES, getBuildingRule, getUnitRule } from "./rules.js";
import { getIncomeEligibleTiles } from "./territory.js";

export function calculateGrossIncome(state, playerId) {
  return getIncomeEligibleTiles(state, playerId).reduce((total, tile) => {
    const buildingIncome = tile.building
      ? getBuildingRule(tile.building.type)?.income ?? 0
      : 0;
    return total + RULES.economy.tileIncome + buildingIncome;
  }, 0);
}

export function calculateUnitUpkeep(state, playerId) {
  return state.tiles.reduce((total, tile) => {
    if (!tile.unit || tile.unit.ownerId !== playerId) {
      return total;
    }
    return total + (getUnitRule(tile.unit.level)?.upkeep ?? 0);
  }, 0);
}

export function calculateBuildingUpkeep(state, playerId) {
  return state.tiles.reduce((total, tile) => {
    if (tile.ownerId !== playerId || !tile.building) {
      return total;
    }
    return total + (getBuildingRule(tile.building.type)?.upkeep ?? 0);
  }, 0);
}

export function calculateTotalUpkeep(state, playerId) {
  return calculateUnitUpkeep(state, playerId) + calculateBuildingUpkeep(state, playerId);
}

export function calculateNetIncome(state, playerId) {
  return calculateGrossIncome(state, playerId) - calculateTotalUpkeep(state, playerId);
}

export function updatePlayerEconomyPreview(state, playerId) {
  const player = getPlayer(state, playerId);
  if (!player) return null;

  player.income = calculateGrossIncome(state, playerId);
  player.upkeep = calculateTotalUpkeep(state, playerId);
  return {
    income: player.income,
    upkeep: player.upkeep,
    net: player.income - player.upkeep
  };
}

export function applyStartOfTurnEconomy(state, playerId) {
  const player = getPlayer(state, playerId);
  if (!player || !player.isAlive) {
    return { income: 0, upkeep: 0, net: 0, starvation: [] };
  }

  const income = calculateGrossIncome(state, playerId);
  const upkeep = calculateTotalUpkeep(state, playerId);
  const projectedMoney = player.money + income - upkeep;
  let starvation = [];

  if (projectedMoney < 0) {
    starvation = removeAllUnitsForPlayer(state, playerId);
    const reducedUpkeep = calculateTotalUpkeep(state, playerId);
    player.money = Math.max(0, player.money + income - reducedUpkeep);
  } else {
    player.money = projectedMoney;
  }

  const preview = updatePlayerEconomyPreview(state, playerId);

  return {
    income: preview?.income ?? income,
    upkeep: preview?.upkeep ?? calculateTotalUpkeep(state, playerId),
    net: preview?.net ?? calculateNetIncome(state, playerId),
    starvation
  };
}

export function applyStarvation(state, playerId) {
  const player = getPlayer(state, playerId);
  if (!player || player.money >= 0) {
    return [];
  }

  const events = removeAllUnitsForPlayer(state, playerId);
  player.money = Math.max(0, player.money);
  updatePlayerEconomyPreview(state, playerId);
  return events;
}

function removeAllUnitsForPlayer(state, playerId) {
  const events = [];
  for (const tile of state.tiles) {
    if (tile.unit?.ownerId !== playerId) {
      continue;
    }

    const oldLevel = tile.unit.level;
    tile.unit = null;
    events.push({
      tileId: tile.id,
      type: "remove",
      from: oldLevel,
      to: 0
    });
  }

  return events;
}
