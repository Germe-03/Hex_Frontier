import { RULES } from "../core/rules.js";
import { hasSavedGame } from "../storage/saveLoad.js";

export function createMenuController({ onNewGame, onLoadGame }) {
  const menu = byId("start-menu");
  const game = byId("game-screen");
  const playerCount = byId("player-count");
  const mapSize = byId("map-size");
  const playerFields = byId("player-fields");
  const loadButton = byId("menu-load-button");

  function renderPlayerFields() {
    playerFields.replaceChildren();
    const count = Number(playerCount.value);
    for (let index = 0; index < count; index += 1) {
      const row = document.createElement("div");
      row.className = "player-row";
      row.innerHTML = `
        <label>
          Name
          <input type="text" data-player-name="${index}" value="${index === 0 ? "Player 1" : `Computer ${index + 1}`}" maxlength="18">
        </label>
        <label>
          Type
          <select data-player-type="${index}">
            <option value="human"${index === 0 ? " selected" : ""}>Human</option>
            <option value="computer"${index > 0 ? " selected" : ""}>Computer</option>
          </select>
        </label>
        <label>
          Color
          <input type="color" data-player-color="${index}" value="${RULES.playerColors[index]}">
        </label>
      `;
      playerFields.append(row);
    }
  }

  function readConfig() {
    const count = Number(playerCount.value);
    const names = [];
    const colors = [];
    const types = [];
    for (let index = 0; index < count; index += 1) {
      names.push(document.querySelector(`[data-player-name="${index}"]`).value);
      colors.push(document.querySelector(`[data-player-color="${index}"]`).value);
      types.push(document.querySelector(`[data-player-type="${index}"]`).value);
    }
    return {
      size: mapSize.value,
      playerCount: count,
      playerNames: names,
      playerColors: colors,
      playerTypes: types
    };
  }

  function show() {
    menu.classList.remove("hidden");
    game.classList.add("hidden");
    loadButton.disabled = !hasSavedGame();
  }

  function hide() {
    menu.classList.add("hidden");
    game.classList.remove("hidden");
  }

  playerCount.addEventListener("change", renderPlayerFields);
  byId("new-game-button").addEventListener("click", () => onNewGame(readConfig()));
  loadButton.addEventListener("click", onLoadGame);

  renderPlayerFields();
  loadButton.disabled = !hasSavedGame();

  return { show, hide };
}

function byId(id) {
  return document.getElementById(id);
}
