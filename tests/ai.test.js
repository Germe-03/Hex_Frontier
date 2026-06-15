import assert from "node:assert/strict";
import test from "node:test";

import {
  canBuildTowerSmart,
  canBuildTownSmart,
  chooseStrategicMode,
  createStrategicPlan,
  evaluateEnemyWeakness,
  evaluateLocalPower,
  estimateCutoffValue,
  getDisconnectedRegionCount,
  getLargestOwnedRegion,
  getOwnedRegions,
  runComputerTurn,
  scoreExpansionCompactness,
  scoreFront,
  scoreNeutralExpansion,
  scoreTownBuild,
  wouldConnectOwnRegions,
  wouldFillNeutralHole
} from "../src/core/ai.js";
import { createNewGame } from "../src/core/gameState.js";
import { hexDistance, hexId } from "../src/core/hexGrid.js";
import { RULES } from "../src/core/rules.js";
import { endTurn, startTurn } from "../src/core/turnSystem.js";

test("eliminated AI player does not act", () => {
  const state = createEliminationTestState();
  state.currentPlayerId = 2;

  const report = runComputerTurn(state);

  assert.deepEqual(report.actions, []);
  assert.equal(state.players.find((player) => player.id === 2).isAlive, false);
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

test("computer-only games can advance through AI turns", () => {
  const state = createNewGame({
    size: "small",
    playerCount: 2,
    playerTypes: ["computer", "computer"]
  });
  startTurn(state, 1);

  const report = runComputerTurn(state);
  const result = endTurn(state);

  assert.ok(report.actions.length > 0);
  assert.equal(result.ok, true);
  assert.equal(state.currentPlayerId, 2);
  assert.equal(state.players.filter((player) => player.isHuman).length, 0);
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

test("computer identifies weak exposed enemies as priority targets", () => {
  const state = createAiStrategicWarTestState();

  const weak = evaluateEnemyWeakness(state, 1, 2);
  const strong = evaluateEnemyWeakness(state, 1, 3);

  assert.ok(weak.tileCount < strong.tileCount);
  assert.ok(weak.touchingEnemyCount >= 2);
  assert.ok(weak.score > strong.score);
});

test("computer front scoring prefers the weak reachable opponent", () => {
  const state = createAiStrategicWarTestState();

  const weakFront = scoreFront(state, 1, 2);
  const strongFront = scoreFront(state, 1, 3);
  const plan = createStrategicPlan(state, 1);

  assert.ok(weakFront.sharedBorderLength > 0);
  assert.ok(weakFront.score > strongFront.score);
  assert.equal(plan.targetPlayerId, 2);
});

test("computer local power evaluation detects attack-ready fronts", () => {
  const state = createAiStrategicWarTestState();
  const weakFront = scoreFront(state, 1, 2);

  const power = evaluateLocalPower(state, 1, 2, weakFront.enemyTiles);

  assert.ok(power.ownPower > 0);
  assert.ok(power.enemyPower > 0);
  assert.ok(power.attackableTargetCount > 0);
  assert.equal(power.canAttack, true);
});

test("computer cutoff scoring rewards attacks that split enemy territory", () => {
  const state = createAiCutoffTestState();

  const bridgeCutoff = estimateCutoffValue(state, 1, "1,0");
  const edgeCutoff = estimateCutoffValue(state, 1, "1,-1");

  assert.ok(bridgeCutoff > 0);
  assert.ok(bridgeCutoff > edgeCutoff);
});

test("computer keeps a finishing target for several turns", () => {
  const state = createAiStrategicWarTestState();
  state.tiles.push(
    { ...createTile(-2, 2, 3), building: { type: "farm" } },
    { ...createTile(0, -1, 3), building: { type: "farm" } },
    { ...createTile(-1, -1, 3), building: { type: "farm" } },
    { ...createTile(0, 2, 3), building: { type: "farm" } }
  );
  state.aiMemory = {
    1: {
      targetPlayerId: 2,
      commitmentTurns: 2,
      lastPlannedTurn: 0,
      lastScore: 10
    }
  };
  state.turnNumber = 3;

  const weakFront = scoreFront(state, 1, 2);
  const strongerNewFront = scoreFront(state, 1, 3);

  const plan = createStrategicPlan(state, 1);

  assert.ok(strongerNewFront.score > weakFront.score);
  assert.equal(plan.targetPlayerId, 2);
  assert.equal(state.aiMemory[1].commitmentTurns, 1);
});

test("owned region helpers detect disconnected territories", () => {
  const state = createRegionAnalysisTestState();

  assert.equal(getOwnedRegions(1, state).length, 2);
  assert.equal(getLargestOwnedRegion(1, state).length, 2);
  assert.equal(getDisconnectedRegionCount(1, state), 1);
  assert.equal(wouldConnectOwnRegions("2,0", 1, state), true);
});

test("neutral hole detection and compactness scoring prefer filled territory", () => {
  const state = createNeutralHoleTestState();

  assert.equal(wouldFillNeutralHole("0,0", 1, state), true);
  assert.ok(scoreExpansionCompactness("0,0", 1, state) > scoreExpansionCompactness("3,0", 1, state));
});

test("late neutral expansion remains a high priority", () => {
  const state = createNeutralHoleTestState();
  state.roundNumber = 45;

  assert.ok(scoreNeutralExpansion("0,0", 1, state) > 180);
  assert.ok(scoreNeutralExpansion("0,0", 1, state) > scoreNeutralExpansion("3,0", 1, state));
});

test("neutral hole cleanup beats tower construction when there is no immediate threat", () => {
  const state = createNeutralCleanupAiTestState();

  const report = runComputerTurn(state);

  assert.ok(report.actions.some((action) => action === "captured 0,0"));
  assert.ok(report.actions.every((action) => !action.startsWith("built tower") && !action.startsWith("built strongTower")));
  assert.equal(state.tiles.find((tile) => tile.id === "0,0").ownerId, 1);
});

test("town smart placement accepts safe interior tiles", () => {
  const state = createTownStrategyTestState();

  assert.equal(canBuildTownSmart("0,0", 1, state), true);
});

test("town smart placement rejects enemy pressure and nearby towns", () => {
  const nearEnemy = createTownStrategyTestState();
  nearEnemy.tiles.push(createTile(0, 2, 2));

  const nearTown = createTownStrategyTestState();
  nearTown.tiles.find((tile) => tile.id === "2,0").building = { type: "city" };

  assert.equal(canBuildTownSmart("0,0", 1, nearEnemy), false);
  assert.equal(canBuildTownSmart("0,0", 1, nearTown), false);
});

test("weak economy increases town score and triggers economy mode", () => {
  const stable = createTownStrategyTestState();
  const strained = createTownStrategyTestState();
  strained.tiles.find((tile) => tile.id === "1,0").unit = { ownerId: 1, level: 4, acted: false };
  strained.tiles.find((tile) => tile.id === "0,1").unit = { ownerId: 1, level: 3, acted: false };

  assert.ok(scoreTownBuild("0,0", 1, strained) > scoreTownBuild("0,0", 1, stable));
  assert.equal(chooseStrategicMode(strained, 1), "BUILD_ECONOMY");
});

test("tower gating blocks neutral borders and safe interior tiles", () => {
  const neutralBorder = createTowerGateTestState({ neutralBorder: true });
  const safeInterior = createTownStrategyTestState();
  safeInterior.roundNumber = 45;

  assert.equal(canBuildTowerSmart("0,0", 1, neutralBorder), false);
  assert.equal(canBuildTowerSmart("0,0", 1, safeInterior), false);
});

test("tower gating allows threatened borders but blocks close clusters and early strong towers", () => {
  const threatened = createTowerGateTestState({ threatened: true });
  const clustered = createTowerGateTestState({ threatened: true, nearbyTower: true });
  const earlyStrong = createTowerGateTestState({ threatened: true, roundNumber: 30 });

  assert.equal(canBuildTowerSmart("0,0", 1, threatened), true);
  assert.equal(canBuildTowerSmart("0,0", 1, clustered), false);
  assert.equal(canBuildTowerSmart("0,0", 1, earlyStrong, "strongTower"), false);
});

test("tower gating respects maximum tower count", () => {
  const state = createTowerLimitTestState();

  assert.equal(canBuildTowerSmart("0,0", 1, state), false);
});

test("strategic mode selection detects reconnect, late cleanup, and defense", () => {
  const reconnect = createRegionAnalysisTestState();
  const cleanup = createNeutralHoleTestState();
  cleanup.roundNumber = 45;
  const defense = createTowerGateTestState({ threatened: true });

  assert.equal(chooseStrategicMode(reconnect, 1), "RECONNECT_REGIONS");
  assert.equal(chooseStrategicMode(cleanup, 1), "CLEANUP_NEUTRAL_FIELDS");
  assert.equal(chooseStrategicMode(defense, 1), "DEFEND_CRITICAL_FRONT");
});

function createEliminationTestState() {
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
      { id: 1, name: "Player 1", color: "#d45f4a", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true },
      { id: 2, name: "Computer 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: false },
      { id: 3, name: "Player 3", color: "#4f9d5d", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      { ...createTile(0, 0, 1), building: { type: "city" } },
      createTile(1, 0, 1),
      { ...createTile(4, 0, 3), building: { type: "city" } },
      createTile(5, 0, 3)
    ],
    phase: "playing"
  };
}

function createRegionAnalysisTestState() {
  return {
    version: RULES.version,
    currentPlayerId: 1,
    turnNumber: 1,
    roundNumber: 20,
    winnerId: null,
    selectedTileId: null,
    actionMode: "select",
    lastMessage: "",
    log: [],
    players: [
      { id: 1, name: "Computer 1", color: "#d45f4a", money: 50, income: 0, upkeep: 0, isAlive: true, isHuman: false },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      createTile(0, 0, 1),
      createTile(1, 0, 1),
      createTile(2, 0, null),
      createTile(3, 0, 1),
      createTile(4, 0, 1)
    ],
    phase: "playing"
  };
}

function createNeutralHoleTestState() {
  return {
    version: RULES.version,
    currentPlayerId: 1,
    turnNumber: 1,
    roundNumber: 20,
    winnerId: null,
    selectedTileId: null,
    actionMode: "select",
    lastMessage: "",
    log: [],
    players: [
      { id: 1, name: "Computer 1", color: "#d45f4a", money: 50, income: 0, upkeep: 0, isAlive: true, isHuman: false },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      createTile(0, 0, null),
      createTile(1, 0, 1),
      createTile(1, -1, 1),
      createTile(0, -1, 1),
      createTile(-1, 0, 1),
      createTile(-1, 1, 1),
      createTile(0, 1, 1),
      createTile(2, 0, 1),
      createTile(3, 0, null)
    ],
    phase: "playing"
  };
}

function createNeutralCleanupAiTestState() {
  const state = createNeutralHoleTestState();
  state.roundNumber = 45;
  state.tiles.find((tile) => tile.id === "1,0").unit = { ownerId: 1, level: 1, acted: false };
  state.tiles.find((tile) => tile.id === "-1,1").building = { type: "city" };
  return state;
}

function createTownStrategyTestState() {
  return {
    version: RULES.version,
    currentPlayerId: 1,
    turnNumber: 1,
    roundNumber: 35,
    winnerId: null,
    selectedTileId: null,
    actionMode: "select",
    lastMessage: "",
    log: [],
    players: [
      { id: 1, name: "Computer 1", color: "#d45f4a", money: 100, income: 0, upkeep: 0, isAlive: true, isHuman: false },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      createTile(0, 0, 1),
      createTile(1, 0, 1),
      createTile(1, -1, 1),
      createTile(0, -1, 1),
      createTile(-1, 0, 1),
      createTile(-1, 1, 1),
      createTile(0, 1, 1),
      createTile(2, 0, 1),
      createTile(3, 0, 1),
      { ...createTile(4, 0, 1), building: { type: "city" } }
    ],
    phase: "playing"
  };
}

function createTowerGateTestState({ threatened = false, neutralBorder = false, nearbyTower = false, roundNumber = 45 } = {}) {
  const borderTile = neutralBorder
    ? createTile(1, 0, null)
    : threatened
      ? createTile(1, 0, 2, { ownerId: 2, level: 2, acted: false })
      : createTile(1, 0, 1);

  return {
    version: RULES.version,
    currentPlayerId: 1,
    turnNumber: 1,
    roundNumber,
    winnerId: null,
    selectedTileId: null,
    actionMode: "select",
    lastMessage: "",
    log: [],
    players: [
      { id: 1, name: "Computer 1", color: "#d45f4a", money: 100, income: 0, upkeep: 0, isAlive: true, isHuman: false },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      createTile(0, 0, 1),
      borderTile,
      createTile(1, -1, 1),
      createTile(0, -1, 1),
      createTile(-1, 0, 1),
      { ...createTile(-1, 1, 1), building: { type: "city" } },
      createTile(0, 1, 1)
    ].map((tile) => (
      nearbyTower && tile.id === "-1,0"
        ? { ...tile, building: { type: "tower" } }
        : tile
    )),
    phase: "playing"
  };
}

function createTowerLimitTestState() {
  const tiles = Array.from({ length: 24 }, (_, index) => createTile(index - 12, 0, 1));
  tiles.find((tile) => tile.id === "2,0").building = { type: "tower" };
  tiles.find((tile) => tile.id === "-2,0").building = { type: "tower" };
  tiles.find((tile) => tile.id === "1,0").ownerId = 2;
  tiles.find((tile) => tile.id === "1,0").unit = { ownerId: 2, level: 2, acted: false };

  return {
    version: RULES.version,
    currentPlayerId: 1,
    turnNumber: 1,
    roundNumber: 35,
    winnerId: null,
    selectedTileId: null,
    actionMode: "select",
    lastMessage: "",
    log: [],
    players: [
      { id: 1, name: "Computer 1", color: "#d45f4a", money: 100, income: 0, upkeep: 0, isAlive: true, isHuman: false },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles,
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

function createAiStrategicWarTestState() {
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
      { id: 1, name: "Computer 1", color: "#d45f4a", money: 80, income: 0, upkeep: 0, isAlive: true, isHuman: false },
      { id: 2, name: "Weak Enemy", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true },
      { id: 3, name: "Large Enemy", color: "#4f9d5d", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      { ...createTile(0, 0, 1), building: { type: "city" } },
      createTile(1, 0, 1, { ownerId: 1, level: 3, acted: false }),
      createTile(1, -1, 1, { ownerId: 1, level: 2, acted: false }),
      createTile(0, 1, 1),
      createTile(-1, 1, 1, { ownerId: 1, level: 1, acted: false }),
      createTile(-1, 0, 1),
      createTile(2, 0, 2),
      createTile(2, -1, 2, { ownerId: 2, level: 1, acted: false }),
      { ...createTile(3, -1, 2), building: { type: "city" } },
      { ...createTile(-2, 1, 3), building: { type: "city" } },
      createTile(-2, 0, 3, { ownerId: 3, level: 2, acted: false }),
      createTile(-3, 0, 3),
      createTile(-3, 1, 3),
      createTile(-4, 1, 3),
      createTile(-4, 2, 3),
      createTile(3, -2, 3),
      createTile(4, -2, 3)
    ],
    phase: "playing"
  };
}

function createAiCutoffTestState() {
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
      { id: 1, name: "Computer 1", color: "#d45f4a", money: 50, income: 0, upkeep: 0, isAlive: true, isHuman: false },
      { id: 2, name: "Player 2", color: "#3f79d8", money: 0, income: 0, upkeep: 0, isAlive: true, isHuman: true }
    ],
    tiles: [
      createTile(0, 0, 1, { ownerId: 1, level: 4, acted: false }),
      createTile(0, -1, 1),
      createTile(1, 0, 2),
      createTile(1, -1, 2),
      { ...createTile(2, 0, 2), building: { type: "city" } },
      createTile(3, 0, 2)
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
