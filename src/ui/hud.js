import { canBuild, getBuildingCost } from "../core/buildings.js";
import { calculateNetIncome } from "../core/economy.js";
import { getCurrentPlayer, getPlayer, getTile } from "../core/gameState.js";
import { RULES, getBuildingRule, getUnitRule } from "../core/rules.js";
import { getEndGameEconomyStats } from "../core/statistics.js";
import { canBuyUnit, canUpgradeUnit, getUpgradeCost } from "../core/units.js";
import { calculateTileDefense } from "../core/combat.js";

export function bindHudActions(callbacks) {
  byId("buy-unit-button").addEventListener("click", callbacks.onBuyUnit);
  byId("upgrade-unit-button").addEventListener("click", callbacks.onUpgradeUnit);
  byId("build-farm-button").addEventListener("click", () => callbacks.onBuild("farm"));
  byId("build-city-button").addEventListener("click", () => callbacks.onBuild("city"));
  byId("build-tower-button").addEventListener("click", () => callbacks.onBuild("tower"));
  byId("build-strong-tower-button").addEventListener("click", () => callbacks.onBuild("strongTower"));
  byId("end-turn-button").addEventListener("click", callbacks.onEndTurn);
  byId("save-game-button").addEventListener("click", callbacks.onSaveGame);
  byId("hud-load-button").addEventListener("click", callbacks.onLoadGame);
  byId("hud-new-game-button").addEventListener("click", callbacks.onNewGame);
}

export function updateHud(state) {
  const currentPlayer = getCurrentPlayer(state);
  const selectedTile = state.selectedTileId ? getTile(state, state.selectedTileId) : null;
  const net = currentPlayer ? calculateNetIncome(state, currentPlayer.id) : 0;

  byId("current-player").textContent = currentPlayer ? `${currentPlayer.name}${currentPlayer.isHuman ? "" : " (Computer)"}` : "-";
  byId("current-player-dot").style.background = currentPlayer?.color ?? "#999";
  byId("money-stat").textContent = currentPlayer?.money ?? 0;
  byId("income-stat").textContent = currentPlayer?.income ?? 0;
  byId("upkeep-stat").textContent = currentPlayer?.upkeep ?? 0;
  byId("net-stat").textContent = net;
  byId("round-stat").textContent = state.roundNumber;
  byId("status-message").textContent = state.lastMessage ?? "";

  renderSelectedInfo(state, selectedTile);
  updateButtons(state, selectedTile);
  renderEndStatistics(state);
}

function renderSelectedInfo(state, tile) {
  const container = byId("selected-info");
  container.replaceChildren();
  if (!tile) {
    container.append(infoRow("Tile", "None"));
    return;
  }

  const owner = tile.ownerId ? getPlayer(state, tile.ownerId) : null;
  const building = tile.building ? getBuildingRule(tile.building.type) : null;
  const unit = tile.unit ? getUnitRule(tile.unit.level) : null;
  const rows = [
    ["Coords", `${tile.q}, ${tile.r}`],
    ["Terrain", tile.terrain],
    ["Owner", owner?.name ?? "Neutral"],
    ["Defense", tile.terrain === RULES.terrain.blocked ? "-" : calculateTileDefense(state, tile.id)],
    ["Unit", unit ? `${unit.name} L${tile.unit.level}${tile.unit.acted ? " (acted)" : ""}` : "None"],
    ["Building", building?.name ?? "None"]
  ];

  for (const [label, value] of rows) {
    container.append(infoRow(label, value));
  }
}

function updateButtons(state, selectedTile) {
  const currentPlayer = getCurrentPlayer(state);
  const canAct = state.phase !== "finished" && currentPlayer?.isHuman;

  byId("buy-unit-button").disabled = !canAct || !selectedTile || !canBuyUnit(state, selectedTile.id, 1);
  byId("upgrade-unit-button").disabled = !canAct || !selectedTile || !canUpgradeUnit(state, selectedTile.id);
  byId("build-farm-button").disabled = !canAct || !selectedTile || !canBuild(state, selectedTile.id, "farm");
  byId("build-city-button").disabled = !canAct || !selectedTile || !canBuild(state, selectedTile.id, "city");
  byId("build-tower-button").disabled = !canAct || !selectedTile || !canBuild(state, selectedTile.id, "tower");
  byId("build-strong-tower-button").disabled = !canAct || !selectedTile || !canBuild(state, selectedTile.id, "strongTower");
  byId("end-turn-button").disabled = !canAct;

  const unitCost = getUnitRule(1).cost;
  const farm = getBuildingRule("farm");
  const cityCost = currentPlayer ? getBuildingCost(state, currentPlayer.id, "city") : getBuildingRule("city").cost;
  const towerCost = currentPlayer ? getBuildingCost(state, currentPlayer.id, "tower") : getBuildingRule("tower").cost;
  const strongTowerCost = currentPlayer
    ? getBuildingCost(state, currentPlayer.id, "strongTower")
    : getBuildingRule("strongTower").cost;
  byId("buy-unit-button").textContent = `Buy Level 1 Unit (${unitCost})`;
  byId("build-farm-button").textContent = `Build Farm (${farm.cost})`;
  byId("build-city-button").textContent = `Build Town (${cityCost})`;
  byId("build-tower-button").textContent = `Build Tower (${towerCost})`;
  byId("build-strong-tower-button").textContent = `Build Strong Tower (${strongTowerCost})`;

  if (selectedTile?.unit) {
    const cost = getUpgradeCost(selectedTile.unit.level);
    byId("upgrade-unit-button").textContent = cost === null ? "Upgrade Unit" : `Upgrade Unit (${cost})`;
  } else {
    byId("upgrade-unit-button").textContent = "Upgrade Unit";
  }
}

function renderEndStatistics(state) {
  const section = byId("end-statistics-section");
  const container = byId("end-statistics");
  if (!section || !container) return;

  container.replaceChildren();
  if (state.phase !== "finished") {
    section.classList.add("hidden");
    return;
  }

  section.classList.remove("hidden");
  const stats = getEndGameEconomyStats(state);
  const rows = [
    ["Most Income", stats.income],
    ["Highest Costs", stats.costs],
    ["Most Profit", stats.profit]
  ];

  for (const [label, record] of rows) {
    container.append(endStatisticRow(label, record));
  }
}

function endStatisticRow(label, record) {
  const row = document.createElement("div");
  row.className = "end-stat-row";

  const labelEl = document.createElement("span");
  labelEl.textContent = label;

  const valueEl = document.createElement("strong");
  valueEl.textContent = record ? `${record.value} Gold` : "-";

  const detailEl = document.createElement("small");
  detailEl.textContent = record
    ? `${record.playerName}, round ${record.roundNumber}, turn ${record.turnNumber}`
    : "No turn data";

  row.append(labelEl, valueEl, detailEl);
  return row;
}

function infoRow(label, value) {
  const row = document.createElement("div");
  row.className = "info-row";
  const labelEl = document.createElement("span");
  labelEl.textContent = label;
  const valueEl = document.createElement("strong");
  valueEl.textContent = String(value);
  row.append(labelEl, valueEl);
  return row;
}

function byId(id) {
  return document.getElementById(id);
}
