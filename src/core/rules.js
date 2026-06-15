export const RULES = Object.freeze({
  version: 5,
  minPlayers: 2,
  maxPlayers: 8,
  terrain: {
    land: "land",
    blocked: "blocked"
  },
  mapSizes: {
    small: {
      radius: 13,
      blockedChance: 0.08
    },
    medium: {
      radius: 17,
      blockedChance: 0.1
    },
    large: {
      radius: 22,
      blockedChance: 0.12
    }
  },
  economy: {
    startingMoney: 18,
    tileIncome: 1
  },
  combat: {
    neutralDefense: 0,
    ownedBaseDefense: 0,
    unitProtectionRange: 1
  },
  movement: {
    ownedTerritoryRange: 5
  },
  cities: {
    minimumRegionSize: 2
  },
  units: {
    1: {
      name: "Peasant",
      cost: 10,
      strength: 1,
      upkeep: 1
    },
    2: {
      name: "Spearman",
      cost: 20,
      strength: 3,
      upkeep: 2
    },
    3: {
      name: "Light Knight",
      cost: 30,
      strength: 5,
      upkeep: 5
    },
    4: {
      name: "Armored Knight",
      cost: 40,
      strength: 8,
      upkeep: 9
    }
  },
  buildings: {
    city: {
      name: "Town",
      cost: 12,
      costIncrement: 2,
      income: 4,
      defense: 1,
      auraDefense: 0
    },
    farm: {
      name: "Farm",
      cost: 8,
      income: 3,
      defense: 0,
      auraDefense: 0
    },
    tower: {
      name: "Tower",
      cost: 15,
      income: 0,
      upkeep: 3,
      defense: 2,
      auraDefense: 1,
      requiredCaptureLevel: 3
    },
    strongTower: {
      name: "Strong Tower",
      cost: 30,
      income: 0,
      upkeep: 5,
      defense: 4,
      auraDefense: 2,
      requiredCaptureLevel: 4
    }
  },
  playerColors: [
    "#d45f4a",
    "#3f79d8",
    "#4f9d5d",
    "#c99a2e",
    "#8b67c8",
    "#2d9aa6",
    "#d86aa3",
    "#6f7d32"
  ]
});

export function getUnitRule(level) {
  return RULES.units[level] ?? null;
}

export function getBuildingRule(type) {
  return RULES.buildings[type] ?? null;
}

export function getUnitLevels() {
  return Object.keys(RULES.units).map(Number).sort((a, b) => a - b);
}

export function getMaxUnitLevel() {
  return Math.max(...getUnitLevels());
}
