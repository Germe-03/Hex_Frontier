import { applyStartOfTurnEconomy, updatePlayerEconomyPreview } from "./economy.js";
import { getAlivePlayers, getCurrentPlayer, getPlayer, getOwnedTiles, setMessage } from "./gameState.js";
import { recordEconomyStats } from "./statistics.js";
import { cleanupUnsupportedSingleTileOccupants } from "./territory.js";
import { resetUnitsForPlayer } from "./units.js";

export function startTurn(state, playerId = state.currentPlayerId) {
  const player = getPlayer(state, playerId);
  if (!player || !player.isAlive || state.phase === "finished") {
    return { ok: false, message: "No active player to start." };
  }

  state.currentPlayerId = player.id;
  state.selectedTileId = null;
  state.actionMode = "select";
  cleanupUnsupportedSingleTileOccupants(state, [player.id]);
  resetUnitsForPlayer(state, player.id);
  const economy = applyStartOfTurnEconomy(state, player.id);
  recordEconomyStats(state, player.id, economy);
  updateEliminations(state);
  const winner = getWinner(state);
  if (winner) {
    state.winnerId = winner.id;
    state.phase = "finished";
    setMessage(state, `${winner.name} wins.`);
  } else if (economy.starvation.length > 0) {
    setMessage(state, `${player.name} lost units to unpaid upkeep.`);
  } else {
    setMessage(state, `${player.name}'s turn started.`);
  }
  return { ok: true, economy };
}

export function endTurn(state) {
  updateEliminations(state);
  const winner = getWinner(state);
  if (winner) {
    state.winnerId = winner.id;
    state.phase = "finished";
    setMessage(state, `${winner.name} wins.`);
    return { ok: true, winner };
  }

  const currentIndex = state.players.findIndex((player) => player.id === state.currentPlayerId);
  for (let offset = 1; offset <= state.players.length; offset += 1) {
    const nextIndex = (currentIndex + offset) % state.players.length;
    const nextPlayer = state.players[nextIndex];
    if (nextPlayer.isAlive) {
      state.turnNumber += 1;
      if (nextIndex <= currentIndex) {
        state.roundNumber += 1;
      }
      return startTurn(state, nextPlayer.id);
    }
  }

  return { ok: false, message: "No living players remain." };
}

export function updateEliminations(state) {
  cleanupUnsupportedSingleTileOccupants(state);
  for (const player of state.players) {
    const ownedLand = getOwnedTiles(state, player.id);
    player.isAlive = ownedLand.length > 0;
    updatePlayerEconomyPreview(state, player.id);
  }
}

export function getWinner(state) {
  const alive = getAlivePlayers(state);
  return alive.length === 1 ? alive[0] : null;
}

export function getTurnSummary(state) {
  const player = getCurrentPlayer(state);
  return {
    player,
    alivePlayers: getAlivePlayers(state),
    winner: getWinner(state)
  };
}
