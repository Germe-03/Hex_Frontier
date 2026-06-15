# Hex Frontier

Hex Frontier is a local browser-based hex strategy MVP built with plain HTML, CSS, and vanilla JavaScript ES modules. It is inspired by general turn-based territory strategy mechanics: connected hex territories, money, farms, towns, towers, unit upkeep, starvation, deterministic captures, and player elimination.

All code, visuals, names, UI text, and map generation are original for this project.

## Run the Game

Start a static server from this folder:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

No build step is required.

## Run Tests

Use Node's built-in test runner:

```bash
npm test
```

The tests cover hex neighbors, map generation, starting regions, income, upkeep, starvation, capture rules, turn switching, and save/load serialization.

## Project Structure

```text
index.html
styles/main.css
src/main.js
src/core/gameState.js
src/core/rules.js
src/core/hexGrid.js
src/core/mapGenerator.js
src/core/economy.js
src/core/units.js
src/core/buildings.js
src/core/combat.js
src/core/turnSystem.js
src/core/actions.js
src/ui/renderer.js
src/ui/input.js
src/ui/hud.js
src/ui/menu.js
src/storage/saveLoad.js
tests/game.test.js
README.md
```

## Core Mechanics

Two to eight factions can play. Each faction can be set to Human for local hotseat play or Computer for a simple deterministic AI turn. This supports a single human against up to seven computer opponents, up to eight humans on the same device, or fully computer-only games.

Players take turns in order. On each turn the active player earns money from owned land, towns, and farms, pays unit upkeep, then can buy units, upgrade units, build, move, capture, save, or end the turn.

Maps are generated as one connected playable landmass instead of a perfect filled hex circle. The generator protects each starting area, connects all starts through land paths, grows an uneven coast, and adds small peninsula-like extensions. Blocked outer tiles are drawn as water, while occasional safe interior blockers can appear as mountains without splitting the playable land.

Each owned land tile gives base income. A starting town gives income and defense. Farms add extra income. Units have four levels with increasing strength, cost, and upkeep: peasant, spearman, light knight, and armored knight.

Each connected owned region with at least two tiles should have exactly one town. If a region is split and a new connected part has no town, a town appears there automatically. If regions reconnect and now contain multiple towns, the extra towns disappear. A region with fewer than two tiles cannot support a town, so its town is destroyed.

Units protect their own tile and adjacent owned tiles. To capture a protected tile, the attacker must have a higher unit level than the strongest protecting unit. The only exception is max level: a level 4 armored knight may enter territory protected by another level 4 unit.

Towers have level gates. A normal tower requires at least a level 3 unit to enter and destroy it. A strong tower requires a level 4 unit. Towers still add defense to their own tile and adjacent owned tiles.

Units can move up to five tiles through connected owned territory. Capturing still happens into a neighboring neutral or enemy tile. Units can merge with a same-level friendly unit to form the next level. A unit can act once per turn.

Starvation rule: if a player goes negative after income and upkeep are applied, the game repeatedly downgrades the strongest unit or removes level 1 units. Each downgrade/removal forgives that unit level's unpaid upkeep. If no units remain, money is set to zero.

A player is eliminated when they own no land tiles. The game ends when only one player remains alive.

## Modify Rules

Tune the game in:

```text
src/core/rules.js
```

This file contains map sizes, terrain names, starting money, tile income, unit cost/strength/upkeep, building costs, farm income, tower defense, and player colors.

## Known MVP Limitations

- No AI yet.
- No fog of war.
- No online multiplayer.
- No campaign or hand-authored levels.
- No pan/zoom controls.
- Computer turns use a basic deterministic heuristic, not a deep strategy search.
- Combat is deterministic and intentionally simple.
- Captured buildings are destroyed to keep ownership rules clear.

## Suggested Next Improvements

- Add AI players using the existing core action functions.
- Add a map editor that serializes custom tile layouts.
- Add pan and zoom for very large maps.
- Add terrain types with movement or income effects.
- Add campaign scenarios with fixed starts.
- Add fog of war and diplomacy options.
