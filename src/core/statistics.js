export function createStatisticsState() {
  return {
    economyBest: {
      income: null,
      costs: null,
      profit: null
    }
  };
}

export function normalizeStatisticsState(state) {
  if (!state.statistics || typeof state.statistics !== "object") {
    state.statistics = createStatisticsState();
  }

  if (!state.statistics.economyBest || typeof state.statistics.economyBest !== "object") {
    state.statistics.economyBest = createStatisticsState().economyBest;
  }

  for (const key of ["income", "costs", "profit"]) {
    if (!Object.hasOwn(state.statistics.economyBest, key)) {
      state.statistics.economyBest[key] = null;
    }
  }

  return state.statistics;
}

export function recordEconomyStats(state, playerId, economy) {
  const statistics = normalizeStatisticsState(state);
  const player = state.players.find((candidate) => candidate.id === playerId);
  const income = Number(economy?.income ?? 0);
  const costs = Number(economy?.upkeep ?? 0);
  const profit = Number(economy?.net ?? income - costs);
  const baseRecord = {
    playerId,
    playerName: player?.name ?? `Player ${playerId}`,
    roundNumber: state.roundNumber ?? 1,
    turnNumber: state.turnNumber ?? 1
  };

  updateBestRecord(statistics.economyBest, "income", {
    ...baseRecord,
    value: income
  });
  updateBestRecord(statistics.economyBest, "costs", {
    ...baseRecord,
    value: costs
  });
  updateBestRecord(statistics.economyBest, "profit", {
    ...baseRecord,
    value: profit
  });

  return statistics.economyBest;
}

export function getEndGameEconomyStats(state) {
  const statistics = normalizeStatisticsState(state);
  return {
    income: statistics.economyBest.income,
    costs: statistics.economyBest.costs,
    profit: statistics.economyBest.profit
  };
}

function updateBestRecord(best, key, record) {
  const current = best[key];
  if (!current || record.value > current.value) {
    best[key] = record;
  }
}
