import { buildOnSelected, buyLevelOneOnSelected, getLegalDestinations, moveOrCaptureSelectedTo, selectTile, upgradeSelectedUnit } from "./core/actions.js";
import { runComputerTurn } from "./core/ai.js";
import { getCurrentPlayer, getTile, setMessage } from "./core/gameState.js";
import { createNewGame } from "./core/gameState.js";
import { endTurn, startTurn } from "./core/turnSystem.js";
import { loadGame, saveGame } from "./storage/saveLoad.js";
import { bindHudActions, updateHud } from "./ui/hud.js";
import { setupInput } from "./ui/input.js";
import { createMenuController } from "./ui/menu.js";
import { Renderer } from "./ui/renderer.js";

let state = null;
let renderer = null;
let menu = null;
let computerTurnTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  renderer = new Renderer(document.getElementById("game-canvas"));
  menu = createMenuController({
    onNewGame: handleNewGame,
    onLoadGame: handleLoadGame
  });

  setupInput(document.getElementById("game-canvas"), renderer, {
    onTileClick: handleTileClick
  });

  bindHudActions({
    onBuyUnit: () => runAction(() => buyLevelOneOnSelected(state)),
    onUpgradeUnit: () => runAction(() => upgradeSelectedUnit(state)),
    onBuild: (type) => runAction(() => buildOnSelected(state, type)),
    onEndTurn: handleEndTurn,
    onSaveGame: handleSaveGame,
    onLoadGame: handleLoadGame,
    onNewGame: () => menu.show()
  });

  document.getElementById("continue-turn-button").addEventListener("click", () => {
    document.getElementById("turn-transition").classList.add("hidden");
  });
});

function handleNewGame(config) {
  state = createNewGame(config);
  startTurn(state, state.currentPlayerId);
  renderer.setState(state);
  menu.hide();
  enterCurrentTurn();
}

function handleLoadGame() {
  const result = loadGame();
  if (!result.ok) {
    if (state) {
      setMessage(state, result.message);
      renderAll();
    }
    return;
  }
  state = result.state;
  renderer.setState(state);
  menu.hide();
  enterCurrentTurn(result.message);
}

function handleSaveGame() {
  if (!state) return;
  const result = saveGame(state);
  setMessage(state, result.message);
  renderAll();
}

function handleTileClick(tileId) {
  const currentPlayer = getCurrentPlayer(state);
  if (!state || state.phase === "finished" || !currentPlayer?.isHuman || !document.getElementById("turn-transition").classList.contains("hidden")) {
    return;
  }

  const clicked = getTile(state, tileId);
  const selected = state.selectedTileId ? getTile(state, state.selectedTileId) : null;

  if (selected?.unit?.ownerId === state.currentPlayerId && selected.id !== clicked.id) {
    const result = moveOrCaptureSelectedTo(state, clicked.id);
    if (!result.ok && clicked.ownerId === state.currentPlayerId) {
      selectTile(state, clicked.id);
      setMessage(state, "Tile selected.");
    }
  } else {
    selectTile(state, clicked.id);
    setMessage(state, "Tile selected.");
  }

  const selectedAfterAction = getTile(state, clicked.id);
  if (isTowerBuilding(selectedAfterAction)) {
    renderer.playTowerShieldAnimation(clicked.id);
  }

  renderAll();
}

function handleEndTurn() {
  if (!state) return;
  const player = getCurrentPlayer(state);
  if (!player?.isHuman) return;
  const result = endTurn(state);
  if (result.winner) {
    renderAll(`${result.winner.name} wins.`);
    return;
  }
  enterCurrentTurn();
}

function runAction(callback) {
  const player = getCurrentPlayer(state);
  if (!state || state.phase === "finished" || !player?.isHuman) return;
  callback();
  renderAll();
}

function renderAll(message = null) {
  if (!state) return;
  if (message) {
    setMessage(state, message);
  }

  const legal = state.selectedTileId
    ? getLegalDestinations(state, state.selectedTileId)
    : { moves: [], captures: [] };

  renderer.setHighlights({
    selectedTileId: state.selectedTileId,
    moves: legal.moves,
    captures: legal.captures
  });
  renderer.render();
  updateHud(state);
}

function enterCurrentTurn(message = null) {
  if (!state) return;
  clearTimeout(computerTurnTimer);
  renderAll(message);

  if (state.phase === "finished") {
    document.getElementById("turn-transition").classList.add("hidden");
    return;
  }

  const player = getCurrentPlayer(state);
  if (player?.isHuman && shouldShowHumanTurnTransition(state)) {
    showTransition();
    return;
  }

  document.getElementById("turn-transition").classList.add("hidden");
  if (player?.isHuman) {
    return;
  }

  setMessage(state, `${player.name} is thinking...`);
  renderAll();
  computerTurnTimer = setTimeout(runCurrentComputerTurn, 450);
}

function runCurrentComputerTurn() {
  if (!state || state.phase === "finished") return;
  const player = getCurrentPlayer(state);
  if (!player || player.isHuman) return;

  const report = runComputerTurn(state);
  const result = endTurn(state);
  if (result.winner) {
    renderAll(`${result.winner.name} wins.`);
    return;
  }

  const actionCount = report.actions.length;
  enterCurrentTurn(`${player.name} made ${actionCount} action${actionCount === 1 ? "" : "s"}.`);
}

function showTransition() {
  const player = getCurrentPlayer(state);
  const overlay = document.getElementById("turn-transition");
  document.getElementById("transition-dot").style.background = player?.color ?? "#999";
  document.getElementById("transition-title").textContent = `${player?.name ?? "Player"}'s turn`;
  overlay.classList.remove("hidden");
}

function shouldShowHumanTurnTransition(currentState) {
  return currentState.players.filter((player) => player.isHuman && player.isAlive).length > 1;
}

function isTowerBuilding(tile) {
  return tile?.building?.type === "tower" || tile?.building?.type === "strongTower";
}
