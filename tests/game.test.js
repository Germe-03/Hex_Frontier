import assert from "node:assert/strict";
import test from "node:test";

import { runComputerTurn } from "../src/core/ai.js";
import { buildBuilding, canBuild, getBuildingCost } from "../src/core/buildings.js";
import { canCapture, captureTile } from "../src/core/combat.js";
import { applyStartOfTurnEconomy, calculateBuildingUpkeep, calculateGrossIncome, calculateTotalUpkeep, calculateUnitUpkeep } from "../src/core/economy.js";
import { createNewGame } from "../src/core/gameState.js";
import { getConnectedRegions, getNeighbors, hexDistance, hexId, isInsideHexRadius, listHexes } from "../src/core/hexGrid.js";
import { generateMap } from "../src/core/mapGenerator.js";
import { RULES } from "../src/core/rules.js";
import { deserializeState, serializeState } from "../src/storage/saveLoad.js";
import { getEndGameEconomyStats } from "../src/core/statistics.js";
import { normalizeRegionalCities } from "../src/core/territory.js";
import { endTurn, startTurn } from "../src/core/turnSystem.js";
import { buyUnit, canBuyUnit, canMoveInsideOwnedTerritory, getUpgradeCost, moveInsideOwnedTerritory } from "../src/core/units.js";

const MIN_TRIPLE_TILE_COUNTS = Object.freeze({
  small: 273,
  medium: 507,
  large: 813
});

test("hex neighbor lookup returns six neighbors in a radius one map", () => {
  const tiles = [
    { id: hexId(0, 0), q: 0, r: 0 },
    { id: hexId(1, 0), q: 1, r: 0 },
    { id: hexId(1, -1), q: 1, r: -1 },
    { id: hexId(0, -1), q: 0, r: -1 },
    { id: hexId(-1, 0), q: -1, r: 0 },
    { id: hexId(-1, 1), q: -1, r: 1 },
    { id: hexId(0, 1), q: 0, r: 1 }
  ];
  assert.equal(getNeighbors(tiles[0], tiles).length, 6);
});

test("map generation creates valid unique tiles for eight players", () => {
  const map = generateMap({ size: "medium", playerCount: 8 });
  const ids = new Set(map.tiles.map((tile) => tile.id));
  assert.equal(ids.size, map.tiles.length);
  assert.ok(map.tiles.every((tile) => isInsideHexRadius(tile.q, tile.r, map.radius)));
  assert.equal(map.players.length, 8);
});

test("generated maps never place units and buildings on the same tile", () => {
  const map = generateMap({ size: "medium", playerCount: 8 });
  assert.ok(map.tiles.every((tile) => !(tile.unit && tile.building)));
  assert.equal(map.tiles.filter((tile) => tile.unit).length, map.players.length);
  assert.equal(map.tiles.filter((tile) => tile.building?.type === "city").length, map.players.length);
});

test("generated playable land is organic but fully connected", () => {
  for (const size of ["small", "medium", "large"]) {
    const map = generateMap({ size, playerCount: 8 });
    const landTiles = map.tiles.filter((tile) => tile.terrain !== RULES.terrain.blocked);
    const blockedTiles = map.tiles.filter((tile) => tile.terrain === RULES.terrain.blocked);
    const nominalHexTiles = listHexes(map.radius);

    assert.equal(blockedTiles.length, 0);
    assert.equal(landTiles.length, map.tiles.length);
    assert.ok(map.tiles.length >= MIN_TRIPLE_TILE_COUNTS[size]);
    assert.ok(map.tiles.length < nominalHexTiles.length);
    assert.equal(countPlayableLandRegions(map.tiles), 1);
    assert.ok(map.tiles.some((tile) => getNeighbors(tile, map.tiles).length <= 3));
  }
});

test("each player starts with a connected territory", () => {
  const map = generateMap({ size: "medium", playerCount: 8 });
  for (const player of map.players) {
    const owned = map.tiles.filter((tile) => tile.ownerId === player.id);
    assert.ok(owned.length > 0);
    assert.equal(getConnectedRegions(map.tiles, player.id).length, 1);
  }
});

test("player setup supports one human with computer opponents", () => {
  const state = createNewGame({
    size: "medium",
    playerCount: 8,
    playerTypes: ["human", "computer", "computer", "computer", "computer", "computer", "computer", "computer"]
  });

  assert.equal(state.players.length, 8);
  assert.equal(state.players.filter((player) => player.isHuman).length, 1);
  assert.equal(state.players.filter((player) => !player.isHuman).length, 7);
});

test("income calculation includes owned tiles and farms", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  const playerId = state.players[0].id;
  const farmTile = state.tiles.find((tile) => tile.ownerId === playerId && !tile.unit && !tile.building);
  state.currentPlayerId = playerId;
  state.players[0].money = 100;
  buildBuilding(state, farmTile.id, "farm");

  const ownedCount = state.tiles.filter((tile) => tile.ownerId === playerId).length;
  assert.equal(
    calculateGrossIncome(state, playerId),
    ownedCount * RULES.economy.tileIncome + RULES.buildings.city.income + RULES.buildings.farm.income
  );
});

test("income only counts owned regions connected to a city", () => {
  const state = createCityRegionTestState([
    { q: 0, r: 0, ownerId: 1, building: { type: "city" } },
    { q: 1, r: 0, ownerId: 1 },
    { q: 4, r: 0, ownerId: 1, building: { type: "farm" } }
  ]);

  assert.equal(
    calculateGrossIncome(state, 1),
    2 * RULES.economy.tileIncome + RULES.buildings.city.income
  );
});

test("unit and tower prices match the current economy rules", () => {
  assert.equal(RULES.units[1].cost, 10);
  assert.equal(RULES.units[2].cost, 20);
  assert.equal(RULES.units[3].cost, 30);
  assert.equal(RULES.units[4].cost, 40);
  assert.equal(getUpgradeCost(1), 10);
  assert.equal(getUpgradeCost(2), 10);
  assert.equal(getUpgradeCost(3), 10);
  assert.equal(RULES.buildings.city.income, 4);
  assert.equal(RULES.buildings.tower.cost, 15);
  assert.equal(RULES.buildings.tower.upkeep, 3);
  assert.equal(RULES.buildings.strongTower.cost, 30);
  assert.equal(RULES.buildings.strongTower.upkeep, 5);
});

test("city building costs rise by two gold after each built city", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  const playerId = state.players[0].id;
  const player = state.players[0];
  state.currentPlayerId = playerId;
  player.money = 100;

  const firstCityTile = state.tiles.find((tile) => tile.ownerId === playerId && !tile.unit && !tile.building);
  assert.equal(getBuildingCost(state, playerId, "city"), 12);
  assert.equal(canBuild(state, firstCityTile.id, "city"), true);
  assert.equal(buildBuilding(state, firstCityTile.id, "city").ok, true);
  assert.equal(player.money, 88);

  const secondCityTile = state.tiles.find((tile) => tile.ownerId === playerId && !tile.unit && !tile.building);
  assert.equal(getBuildingCost(state, playerId, "city"), 14);
  assert.equal(buildBuilding(state, secondCityTile.id, "city").ok, true);
  assert.equal(player.money, 74);
  assert.equal(getBuildingCost(state, playerId, "city"), 16);
});

test("units cannot be bought on building tiles", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  const playerId = state.players[0].id;
  const cityTile = state.tiles.find((tile) => tile.ownerId === playerId && tile.building?.type === "city");
  state.currentPlayerId = playerId;
  state.players[0].money = 100;

  assert.equal(canBuyUnit(state, cityTile.id, 1), false);
  assert.equal(buyUnit(state, cityTile.id, 1).ok, false);
  assert.equal(cityTile.unit, null);
});

test("upkeep calculation sums owned units", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  const playerId = state.players[0].id;
  const unitTile = state.tiles.find((tile) => tile.unit?.ownerId === playerId);
  unitTile.unit.level = 4;
  assert.equal(calculateUnitUpkeep(state, playerId), RULES.units[4].upkeep);
});

test("tower upkeep contributes to total upkeep", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  const playerId = state.players[0].id;
  const unitTile = state.tiles.find((tile) => tile.unit?.ownerId === playerId);
  const buildingTiles = state.tiles.filter((tile) => tile.ownerId === playerId && !tile.unit && !tile.building);
  unitTile.unit.level = 2;
  buildingTiles[0].building = { type: "tower" };
  buildingTiles[1].building = { type: "strongTower" };

  assert.equal(calculateBuildingUpkeep(state, playerId), 8);
  assert.equal(calculateTotalUpkeep(state, playerId), calculateUnitUpkeep(state, playerId) + 8);
});

test("unpaid upkeep removes all units before money would become negative", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  const playerId = state.players[0].id;
  const unitTile = state.tiles.find((tile) => tile.unit?.ownerId === playerId);
  const secondUnitTile = state.tiles.find(
    (tile) => tile.ownerId === playerId && !tile.unit && !tile.building
  );
  unitTile.unit.level = 4;
  secondUnitTile.unit = { ownerId: playerId, level: 3, acted: false };
  state.players[0].money = 0;
  state.tiles
    .filter((tile) => tile.ownerId === playerId)
    .forEach((tile) => {
      if (!tile.unit && !tile.building) tile.ownerId = null;
    });

  const report = applyStartOfTurnEconomy(state, playerId);
  assert.equal(report.starvation.length, 2);
  assert.ok(report.starvation.every((event) => event.type === "remove"));
  assert.ok(state.players[0].money >= 0);
  assert.equal(state.tiles.filter((tile) => tile.unit?.ownerId === playerId).length, 0);
  assert.equal(calculateUnitUpkeep(state, playerId), 0);
});

test("a stronger unit can capture a weak neighboring target", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  const attacker = findOwnedBorderTile(state, 1);
  attacker.unit = { ownerId: 1, level: 2, acted: false };
  const target = getNeighbors(attacker, state.tiles).find((tile) => tile.terrain !== RULES.terrain.blocked && tile.ownerId !== 1);
  target.ownerId = null;
  target.unit = null;
  target.building = null;
  state.currentPlayerId = 1;

  assert.equal(canCapture(state, attacker.id, target.id), true);
  const result = captureTile(state, attacker.id, target.id);
  assert.equal(result.ok, true);
  assert.equal(target.ownerId, 1);
});

test("a weak unit cannot capture a defended target", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  const attacker = findOwnedBorderTile(state, 1);
  attacker.unit = { ownerId: 1, level: 1, acted: false };
  const target = getNeighbors(attacker, state.tiles).find((tile) => tile.terrain !== RULES.terrain.blocked && tile.ownerId !== 1);
  target.ownerId = 2;
  target.unit = null;
  target.building = { type: "strongTower" };
  state.currentPlayerId = 1;

  assert.equal(canCapture(state, attacker.id, target.id), false);
});

test("units protect adjacent owned tiles by level", () => {
  const state = createCombatTestState();
  state.tiles.find((tile) => tile.id === "0,0").unit.level = 2;
  state.tiles.find((tile) => tile.id === "1,-1").unit = { ownerId: 2, level: 2, acted: false };

  assert.equal(canCapture(state, "0,0", "1,0"), false);

  state.tiles.find((tile) => tile.id === "0,0").unit.level = 3;
  assert.equal(canCapture(state, "0,0", "1,0"), true);
});

test("maximum level units may enter equally protected max-level territory", () => {
  const state = createCombatTestState();
  state.tiles.find((tile) => tile.id === "0,0").unit.level = 4;
  state.tiles.find((tile) => tile.id === "1,-1").unit = { ownerId: 2, level: 4, acted: false };

  assert.equal(canCapture(state, "0,0", "1,0"), true);
});

test("tower capture requires specific unit levels", () => {
  const state = createCombatTestState();
  const attacker = state.tiles.find((tile) => tile.id === "0,0");
  const target = state.tiles.find((tile) => tile.id === "1,0");

  target.building = { type: "tower" };
  attacker.unit.level = 2;
  assert.equal(canCapture(state, attacker.id, target.id), false);
  attacker.unit.level = 3;
  assert.equal(canCapture(state, attacker.id, target.id), true);

  target.building = { type: "strongTower" };
  attacker.unit.level = 3;
  assert.equal(canCapture(state, attacker.id, target.id), false);
  attacker.unit.level = 4;
  assert.equal(canCapture(state, attacker.id, target.id), true);
});

test("units can move up to five tiles inside owned territory", () => {
  const state = createMovementTestState(6);

  assert.equal(canMoveInsideOwnedTerritory(state, "0,0", "5,0"), true);
  assert.equal(canMoveInsideOwnedTerritory(state, "0,0", "6,0"), false);

  const result = moveInsideOwnedTerritory(state, "0,0", "5,0");
  assert.equal(result.ok, true);
  assert.equal(state.tiles.find((tile) => tile.id === "5,0").unit.ownerId, 1);
  assert.equal(state.tiles.find((tile) => tile.id === "0,0").unit, null);
});

test("units cannot move or merge onto building tiles", () => {
  const state = createMovementTestState(2);
  const buildingTile = state.tiles.find((tile) => tile.id === "1,0");
  buildingTile.building = { type: "tower" };

  assert.equal(canMoveInsideOwnedTerritory(state, "0,0", "1,0"), false);
  assert.equal(moveInsideOwnedTerritory(state, "0,0", "1,0").ok, false);
  assert.equal(state.tiles.find((tile) => tile.id === "0,0").unit.ownerId, 1);
  assert.equal(buildingTile.unit, null);
});

test("split regions spawn a city in large regions without one", () => {
  const state = createCityRegionTestState([
    { q: 0, r: 0, ownerId: 1, building: { type: "city" } },
    { q: 1, r: 0, ownerId: 1 },
    { q: 2, r: 0, ownerId: 2 },
    { q: 3, r: 0, ownerId: 1 },
    { q: 4, r: 0, ownerId: 1 }
  ]);

  normalizeRegionalCities(state, [1]);

  const playerOneCities = state.tiles.filter((tile) => tile.ownerId === 1 && tile.building?.type === "city");
  assert.equal(playerOneCities.length, 2);
  assert.ok(playerOneCities.some((tile) => tile.id === "0,0"));
  assert.ok(playerOneCities.some((tile) => tile.id === "3,0" || tile.id === "4,0"));
});

test("merged regions keep only one city", () => {
  const state = createCityRegionTestState([
    { q: 0, r: 0, ownerId: 1, building: { type: "city" } },
    { q: 1, r: 0, ownerId: 1 },
    { q: 2, r: 0, ownerId: 1 },
    { q: 3, r: 0, ownerId: 1 },
    { q: 4, r: 0, ownerId: 1, building: { type: "city" } }
  ]);

  normalizeRegionalCities(state, [1]);

  assert.equal(state.tiles.filter((tile) => tile.ownerId === 1 && tile.building?.type === "city").length, 1);
});

test("cities are removed from regions smaller than two tiles", () => {
  const state = createCityRegionTestState([
    { q: 0, r: 0, ownerId: 1, building: { type: "city" } },
    { q: 2, r: 0, ownerId: 1 },
    { q: 3, r: 0, ownerId: 1 }
  ]);

  normalizeRegionalCities(state, [1]);

  assert.equal(state.tiles.find((tile) => tile.id === "0,0").building, null);
  assert.equal(state.tiles.filter((tile) => tile.ownerId === 1 && tile.building?.type === "city").length, 1);
});

test("single isolated fields remove units and towers but keep ownership", () => {
  const state = createCityRegionTestState([
    { q: 0, r: 0, ownerId: 1, building: { type: "city" } },
    { q: 1, r: 0, ownerId: 1 },
    { q: 4, r: 0, ownerId: 1 },
    { q: -4, r: 0, ownerId: 1, building: { type: "tower" } }
  ]);
  const isolatedUnitTile = state.tiles.find((tile) => tile.id === "4,0");
  const isolatedTowerTile = state.tiles.find((tile) => tile.id === "-4,0");
  isolatedUnitTile.unit = { ownerId: 1, level: 2, acted: false };

  const events = normalizeRegionalCities(state, [1]);

  assert.equal(isolatedUnitTile.ownerId, 1);
  assert.equal(isolatedUnitTile.unit, null);
  assert.equal(isolatedTowerTile.ownerId, 1);
  assert.equal(isolatedTowerTile.building, null);
  assert.ok(events.some((event) => event.type === "isolatedUnitRemoved" && event.tileId === "4,0"));
  assert.ok(events.some((event) => event.type === "isolatedTowerRemoved" && event.tileId === "-4,0"));
});

test("buying a unit or building a tower on a single isolated field removes it immediately", () => {
  const state = createCityRegionTestState([
    { q: 0, r: 0, ownerId: 1, building: { type: "city" } },
    { q: 1, r: 0, ownerId: 1 },
    { q: 4, r: 0, ownerId: 1 },
    { q: -4, r: 0, ownerId: 1 }
  ]);
  state.currentPlayerId = 1;
  state.players[0].money = 100;
  const isolatedUnitTile = state.tiles.find((tile) => tile.id === "4,0");
  const isolatedTowerTile = state.tiles.find((tile) => tile.id === "-4,0");

  const buyResult = buyUnit(state, isolatedUnitTile.id, 1);
  const buildResult = buildBuilding(state, isolatedTowerTile.id, "tower");

  assert.equal(buyResult.ok, true);
  assert.equal(buildResult.ok, true);
  assert.equal(isolatedUnitTile.ownerId, 1);
  assert.equal(isolatedUnitTile.unit, null);
  assert.equal(isolatedTowerTile.ownerId, 1);
  assert.equal(isolatedTowerTile.building, null);
});

test("turn switching advances to the next alive player", () => {
  const state = createNewGame({ size: "small", playerCount: 3 });
  startTurn(state, 1);
  endTurn(state);
  assert.equal(state.currentPlayerId, 2);
});

test("turn economy statistics remember who had the highest income costs and profit", () => {
  const state = createEconomyStatisticsTestState();

  startTurn(state, 1);
  state.turnNumber = 2;
  startTurn(state, 2);

  const stats = getEndGameEconomyStats(state);
  assert.equal(stats.income.playerId, 2);
  assert.equal(stats.income.value, 13);
  assert.equal(stats.costs.playerId, 1);
  assert.equal(stats.costs.value, 12);
  assert.equal(stats.profit.playerId, 2);
  assert.equal(stats.profit.value, 13);
  assert.equal(stats.profit.turnNumber, 2);
});

test("computer turn can perform deterministic actions", () => {
  const state = createNewGame({
    size: "small",
    playerCount: 2,
    playerTypes: ["human", "computer"]
  });
  startTurn(state, 2);

  const report = runComputerTurn(state);
  assert.ok(report.actions.length > 0);
  assert.ok(state.tiles.some((tile) => tile.unit?.ownerId === 2 && tile.unit.acted));
});

test("computer builds defensive towers on threatened valuable border fields", () => {
  const state = createAiDefenseTestState();

  const report = runComputerTurn(state);
  const defendedTile = state.tiles.find((tile) => tile.id === "1,0");

  assert.ok(report.actions.some((action) => action.startsWith("built")));
  assert.ok(["tower", "strongTower"].includes(defendedTile.building?.type));
});

test("computer avoids placing defensive towers directly next to existing towers", () => {
  const state = createAiDefenseTestState();
  const adjacentTowerTile = state.tiles.find((tile) => tile.id === "0,1");
  adjacentTowerTile.building = { type: "tower" };

  runComputerTurn(state);
  const defensiveTowers = state.tiles.filter((tile) => (
    tile.ownerId === 2
    && (tile.building?.type === "tower" || tile.building?.type === "strongTower")
  ));

  for (const tower of defensiveTowers) {
    for (const other of defensiveTowers) {
      if (tower.id === other.id) continue;
      assert.ok(hexDistance(tower, other) > 1);
    }
  }
});

test("computer moves idle units as a group toward its chosen front", () => {
  const state = createAiGroupMovementTestState();

  const report = runComputerTurn(state);
  const unitTiles = state.tiles.filter((tile) => tile.unit?.ownerId === 2);

  assert.equal(report.actions.filter((action) => action.startsWith("moved unit")).length, 2);
  assert.equal(unitTiles.length, 2);
  assert.ok(unitTiles.every((tile) => tile.unit.acted));
  assert.ok(unitTiles.every((tile) => hexDistance(tile, { q: 3, r: 0 }) <= 1));
});

test("save/load serialization keeps state data", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  state.players[0].money = 42;
  const restored = deserializeState(serializeState(state));
  assert.equal(restored.players[0].money, 42);
  assert.equal(restored.tiles.length, state.tiles.length);
});

test("save/load normalizes missing statistics from older saves", () => {
  const state = createNewGame({ size: "small", playerCount: 2 });
  delete state.statistics;

  const restored = deserializeState(serializeState(state));
  assert.ok(restored.statistics);
  assert.deepEqual(getEndGameEconomyStats(restored), {
    income: null,
    costs: null,
    profit: null
  });
});

test("save/load moves legacy units off building tiles", () => {
  const state = createMovementTestState(2);
  const cityTile = state.tiles.find((tile) => tile.id === "0,0");
  cityTile.building = { type: "city" };

  const restored = deserializeState(serializeState(state));
  const restoredCityTile = restored.tiles.find((tile) => tile.id === "0,0");

  assert.equal(restoredCityTile.unit, null);
  assert.ok(restored.tiles.some((tile) => (
    tile.id !== "0,0"
    && tile.unit?.ownerId === 1
    && !tile.building
  )));
  assert.ok(restored.tiles.every((tile) => !(tile.unit && tile.building)));
});

function findOwnedBorderTile(state, playerId) {
  return state.tiles.find((tile) => (
    tile.ownerId === playerId
    && getNeighbors(tile, state.tiles).some((neighbor) => (
      neighbor.terrain !== RULES.terrain.blocked && neighbor.ownerId !== playerId
    ))
  ));
}

function countPlayableLandRegions(tiles) {
  const playableIds = new Set(
    tiles
      .filter((tile) => tile.terrain !== RULES.terrain.blocked)
      .map((tile) => tile.id)
  );
  const regions = [];

  while (playableIds.size > 0) {
    const [startId] = playableIds;
    const start = tiles.find((tile) => tile.id === startId);
    const queue = [start];
    const region = [];
    playableIds.delete(startId);

    while (queue.length > 0) {
      const tile = queue.shift();
      region.push(tile);
      for (const neighbor of getNeighbors(tile, tiles)) {
        if (playableIds.has(neighbor.id)) {
          playableIds.delete(neighbor.id);
          queue.push(neighbor);
        }
      }
    }

    regions.push(region);
  }

  return regions.length;
}

function createCombatTestState() {
  return {
    version: RULES.version,
    currentPlayerId: 1,
    players: [
      { id: 1, name: "Player 1", color: "#d45f4a", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      createTile(0, 0, 1, { ownerId: 1, level: 1, acted: false }),
      createTile(1, 0, 2, null),
      createTile(1, -1, 2, null),
      createTile(0, -1, null, null),
      createTile(2, -1, null, null),
      createTile(2, 0, null, null)
    ],
    phase: "playing"
  };
}

function createMovementTestState(length) {
  return {
    version: RULES.version,
    currentPlayerId: 1,
    players: [
      { id: 1, name: "Player 1", color: "#d45f4a", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: Array.from({ length: length + 1 }, (_, q) => createTile(q, 0, 1, q === 0 ? { ownerId: 1, level: 1, acted: false } : null)),
    phase: "playing"
  };
}

function createCityRegionTestState(tileSpecs) {
  return {
    version: RULES.version,
    currentPlayerId: 1,
    players: [
      { id: 1, name: "Player 1", color: "#d45f4a", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: tileSpecs.map((spec) => ({
      ...createTile(spec.q, spec.r, spec.ownerId, null),
      building: spec.building ?? null
    })),
    phase: "playing"
  };
}

function createAiDefenseTestState() {
  return {
    version: RULES.version,
    currentPlayerId: 2,
    players: [
      { id: 1, name: "Player 1", color: "#d45f4a", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true },
      { id: 2, name: "Computer 2", color: "#3f79d8", money: 80, income: 0, upkeep: 0, isAlive: true, isHuman: false }
    ],
    tiles: [
      { ...createTile(0, 0, 2), building: { type: "city" } },
      createTile(1, 0, 2),
      { ...createTile(1, -1, 2), building: { type: "farm" } },
      createTile(0, 1, 2),
      createTile(-1, 1, 2),
      createTile(-1, 0, 2),
      createTile(2, 0, 1, { ownerId: 1, level: 3, acted: false }),
      createTile(2, -1, 1),
      createTile(1, 1, null)
    ],
    phase: "playing"
  };
}

function createEconomyStatisticsTestState() {
  return {
    version: RULES.version,
    currentPlayerId: 1,
    turnNumber: 1,
    roundNumber: 1,
    winnerId: null,
    selectedTileId: null,
    actionMode: "select",
    lastMessage: "",
    log: [],
    players: [
      { id: 1, name: "Player 1", color: "#d45f4a", money: 100, income: 0, upkeep: 0, isAlive: true, isHuman: true },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 100, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      { ...createTile(0, 0, 1, { ownerId: 1, level: 4, acted: false }), building: null },
      { ...createTile(1, 0, 1), building: { type: "city" } },
      { ...createTile(0, 1, 1), building: { type: "tower" } },
      { ...createTile(3, 0, 2), building: { type: "city" } },
      { ...createTile(4, 0, 2), building: { type: "farm" } },
      createTile(3, 1, 2),
      createTile(4, 1, 2),
      createTile(5, 0, 2),
      createTile(5, 1, 2)
    ],
    phase: "playing"
  };
}

function createAiGroupMovementTestState() {
  return {
    version: RULES.version,
    currentPlayerId: 2,
    players: [
      { id: 1, name: "Player 1", color: "#d45f4a", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true },
      { id: 2, name: "Computer 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: false }
    ],
    tiles: [
      createTile(0, 0, 2, { ownerId: 2, level: 1, acted: false }),
      createTile(0, 1, 2, { ownerId: 2, level: 2, acted: false }),
      createTile(1, 0, 2),
      createTile(1, 1, 2),
      createTile(2, 0, 2),
      createTile(2, 1, 2),
      createTile(3, 0, 2),
      createTile(3, 1, 2),
      createTile(4, 0, 1),
      createTile(4, -1, 1)
    ],
    phase: "playing"
  };
}

function createTile(q, r, ownerId, unit = null) {
  return {
    id: hexId(q, r),
    q,
    r,
    terrain: RULES.terrain.land,
    blockedKind: null,
    ownerId,
    unit,
    building: null
  };
}
