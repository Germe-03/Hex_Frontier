import { RULES } from "./rules.js";
import { generateMap } from "./mapGenerator.js";
import { createStatisticsState } from "./statistics.js";

export function createNewGame(config = {}) {
  const map = generateMap(config);
  return {
    version: RULES.version,
    mapSize: map.size,
    radius: map.radius,
    players: map.players,
    tiles: map.tiles,
    currentPlayerId: map.players[0]?.id ?? null,
    turnNumber: 1,
    roundNumber: 1,
    winnerId: null,
    phase: "playing",
    selectedTileId: null,
    actionMode: "select",
    lastMessage: "Select one of your tiles to begin.",
    statistics: createStatisticsState(),
    log: []
  };
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export function getTile(state, tileId) {
  return state.tiles.find((tile) => tile.id === tileId) ?? null;
}

export function getPlayer(state, playerId) {
  return state.players.find((player) => player.id === playerId) ?? null;
}

export function getCurrentPlayer(state) {
  return getPlayer(state, state.currentPlayerId);
}

export function getAlivePlayers(state) {
  return state.players.filter((player) => player.isAlive);
}

export function getOwnedTiles(state, playerId) {
  return state.tiles.filter((tile) => tile.ownerId === playerId && tile.terrain !== RULES.terrain.blocked);
}

export function setMessage(state, message) {
  state.lastMessage = message;
  state.log.push({
    turnNumber: state.turnNumber,
    playerId: state.currentPlayerId,
    message
  });
  if (state.log.length > 80) {
    state.log.shift();
  }
}

export function clearSelection(state) {
  state.selectedTileId = null;
  state.actionMode = "select";
}
