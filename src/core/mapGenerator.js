import { RULES } from "./rules.js";
import { DIRECTIONS, getNeighbors, hexDistance, hexId, hexToPixel, isInsideHexRadius, listHexes } from "./hexGrid.js";
import { createUnit } from "./units.js";

export function createPlayers(count, names = [], colors = [], types = []) {
  const safeCount = clamp(count, RULES.minPlayers, RULES.maxPlayers);
  const safeTypes = normalizePlayerTypes(types, safeCount);
  return Array.from({ length: safeCount }, (_, index) => ({
    id: index + 1,
    name: names[index]?.trim() || (safeTypes[index] === "computer" ? `Computer ${index + 1}` : `Player ${index + 1}`),
    color: colors[index] || RULES.playerColors[index],
    money: RULES.economy.startingMoney,
    income: 0,
    upkeep: 0,
    isAlive: true,
    isHuman: safeTypes[index] !== "computer"
  }));
}

export function generateMap({ size = "medium", playerCount = 2, playerNames = [], playerColors = [], playerTypes = [] } = {}) {
  const mapConfig = RULES.mapSizes[size] ?? RULES.mapSizes.medium;
  const radius = mapConfig.radius;
  const players = createPlayers(playerCount, playerNames, playerColors, playerTypes);
  const startCenters = getStartCenters(radius, players.length);
  const protectionRange = getStartProtectionRange(radius, players.length);
  const protectedTiles = new Set();
  const ownedStartTiles = new Map();

  for (const [index, center] of startCenters.entries()) {
    for (const coord of listHexesWithin(center, protectionRange, radius)) {
      protectedTiles.add(hexId(coord.q, coord.r));
      if (hexDistance(coord, center) <= 1) {
        ownedStartTiles.set(hexId(coord.q, coord.r), players[index].id);
      }
    }
  }

  const { landIds } = createOrganicLandMask(radius, startCenters, protectedTiles, mapConfig);
  const tiles = listHexes(radius)
    .filter((coord) => landIds.has(hexId(coord.q, coord.r)))
    .map((coord) => {
      const id = hexId(coord.q, coord.r);
      return {
      id,
      q: coord.q,
      r: coord.r,
      terrain: RULES.terrain.land,
      blockedKind: null,
      ownerId: ownedStartTiles.get(id) ?? null,
      unit: null,
      building: null
      };
    });

  const tileMap = new Map(tiles.map((tile) => [tile.id, tile]));
  for (const [index, center] of startCenters.entries()) {
    const centerTile = tileMap.get(hexId(center.q, center.r));
    centerTile.building = { type: "city" };
    const unitTile = chooseStartingUnitTile(centerTile, tileMap, players[index].id);
    if (unitTile) {
      unitTile.unit = createUnit(players[index].id, 1);
    }
  }

  return {
    size,
    radius,
    players,
    tiles
  };
}

function chooseStartingUnitTile(centerTile, tileMap, playerId) {
  return getNeighbors(centerTile, tileMap)
    .filter((tile) => (
      tile.ownerId === playerId
      && tile.terrain !== RULES.terrain.blocked
      && !tile.unit
      && !tile.building
    ))
    .sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

function getStartCenters(radius, playerCount) {
  const ringRadius = Math.max(3, radius - 1);
  const candidates = listHexes(radius)
    .filter((coord) => hexDistance(coord, { q: 0, r: 0 }) === ringRadius)
    .map((coord) => {
      const pixel = hexToPixel(coord.q, coord.r, 1);
      const angle = Math.atan2(pixel.y, pixel.x);
      return { ...coord, angle: angle < 0 ? angle + Math.PI * 2 : angle };
    })
    .sort((a, b) => a.angle - b.angle);

  const selected = [];
  for (let index = 0; index < playerCount; index += 1) {
    const targetAngle = (index / playerCount) * Math.PI * 2;
    const best = candidates
      .filter((coord) => !selected.some((existing) => existing.q === coord.q && existing.r === coord.r))
      .sort((a, b) => scoreStartCandidate(a, targetAngle, selected) - scoreStartCandidate(b, targetAngle, selected))[0];
    selected.push({ q: best.q, r: best.r });
  }

  return selected;
}

function getStartProtectionRange(radius, playerCount) {
  return radius <= 5 && playerCount >= 7 ? 1 : 2;
}

function createOrganicLandMask(radius, startCenters, protectedTiles, mapConfig) {
  const coords = listHexes(radius);
  const coordMap = new Map(coords.map((coord) => [hexId(coord.q, coord.r), coord]));
  const landIds = new Set(protectedTiles);
  const center = { q: 0, r: 0 };
  landIds.add(hexId(center.q, center.r));

  for (const startCenter of startCenters) {
    const widePathChance = radius <= 5 && startCenters.length >= 7 ? 0.18 : 0.55;
    addWidePath(landIds, startCenter, center, radius, widePathChance);
  }

  const targetCoverage = getTargetCoverage(radius);
  const targetLandCount = Math.max(landIds.size, Math.floor(coords.length * targetCoverage));
  const maxLandCount = Math.max(targetLandCount, Math.floor(coords.length * 0.9));
  growConnectedLand(landIds, coordMap, radius, targetLandCount);
  addPeninsulas(landIds, coordMap, radius, Math.max(8, startCenters.length * 2), maxLandCount);
  carveCoastlineBays(landIds, protectedTiles, coordMap, radius, Math.max(8, startCenters.length * 2));

  addSafeInteriorVoids(landIds, protectedTiles, coordMap, radius, mapConfig.blockedChance);
  return { landIds };
}

function getTargetCoverage(radius) {
  if (radius <= 13) return 0.68;
  if (radius <= 17) return 0.66;
  return 0.64;
}

function growConnectedLand(landIds, coordMap, radius, targetLandCount) {
  let guard = 0;
  while (landIds.size < targetLandCount && guard < targetLandCount * 20) {
    guard += 1;
    const frontier = getFrontierCandidates(landIds, coordMap);
    if (frontier.length === 0) break;

    const narrowCandidates = frontier.filter((coord) => countLandNeighbors(coord, landIds, coordMap) <= 2);
    const candidatePool = narrowCandidates.length > 0 && Math.random() < 0.28
      ? narrowCandidates
      : frontier;
    const selected = candidatePool
      .map((coord) => ({
        coord,
        score: scoreGrowthCandidate(coord, landIds, coordMap, radius)
      }))
      .sort((a, b) => b.score - a.score)[0]?.coord;

    if (selected) {
      landIds.add(hexId(selected.q, selected.r));
    }
  }
}

function addPeninsulas(landIds, coordMap, radius, count, maxLandCount) {
  for (let index = 0; index < count; index += 1) {
    if (landIds.size >= maxLandCount) break;
    const edge = getLandEdgeCandidates(landIds, coordMap, radius)
      .sort((a, b) => scorePeninsulaStart(b, radius) - scorePeninsulaStart(a, radius))[0];
    if (!edge) continue;

    const direction = getOutwardDirection(edge, landIds, coordMap);
    if (!direction) continue;

    let current = { ...edge };
    const length = 3 + Math.floor(Math.random() * 5);
    for (let step = 0; step < length; step += 1) {
      if (landIds.size >= maxLandCount) break;
      const next = {
        q: current.q + direction.q,
        r: current.r + direction.r
      };
      const nextId = hexId(next.q, next.r);
      if (!coordMap.has(nextId) || hexDistance(next, { q: 0, r: 0 }) > radius) break;
      landIds.add(nextId);
      if (Math.random() < 0.35) {
        addRandomSideBulge(landIds, next, direction, coordMap);
      }
      current = next;
    }
  }
}

function carveCoastlineBays(landIds, protectedTiles, coordMap, radius, count) {
  const candidates = [...landIds]
    .filter((id) => !protectedTiles.has(id) && id !== "0,0")
    .map((id) => coordMap.get(id))
    .filter((coord) => coord && hexDistance(coord, { q: 0, r: 0 }) > radius * 0.45)
    .sort(() => Math.random() - 0.5);

  let carved = 0;
  for (const start of candidates) {
    if (carved >= count) break;
    const direction = getOutwardDirection(start, landIds, coordMap);
    if (!direction) continue;

    const bay = [start];
    for (const side of getSideDirections(direction)) {
      const sideCoord = { q: start.q + side.q, r: start.r + side.r };
      if (coordMap.has(hexId(sideCoord.q, sideCoord.r)) && Math.random() < 0.7) {
        bay.push(sideCoord);
      }
    }

    const removed = [];
    for (const coord of bay) {
      const id = hexId(coord.q, coord.r);
      if (!landIds.has(id) || protectedTiles.has(id)) continue;
      landIds.delete(id);
      removed.push(id);
    }

    if (removed.length === 0) continue;
    if (isLandConnected(landIds, coordMap)) {
      carved += 1;
    } else {
      for (const id of removed) {
        landIds.add(id);
      }
    }
  }
}

function addWidePath(landIds, from, to, radius, widePathChance) {
  let current = { ...from };
  let guard = 0;

  while (hexDistance(current, to) > 0 && guard < radius * 4) {
    guard += 1;
    for (const coord of listHexesWithin(current, Math.random() < widePathChance ? 1 : 0, radius)) {
      landIds.add(hexId(coord.q, coord.r));
    }
    current = getStepToward(current, to, radius);
  }

  for (const coord of listHexesWithin(to, 1, radius)) {
    landIds.add(hexId(coord.q, coord.r));
  }
}

function getStepToward(from, to, radius) {
  return DIRECTIONS
    .map((direction) => ({ q: from.q + direction.q, r: from.r + direction.r }))
    .filter((coord) => isInsideHexRadius(coord.q, coord.r, radius))
    .map((coord) => ({
      coord,
      score: hexDistance(coord, to) + Math.random() * 0.2
    }))
    .sort((a, b) => a.score - b.score)[0].coord;
}

function getFrontierCandidates(landIds, coordMap) {
  const frontierIds = new Set();
  for (const id of landIds) {
    const coord = coordMap.get(id);
    if (!coord) continue;
    for (const neighbor of neighborCoords(coord)) {
      const neighborId = hexId(neighbor.q, neighbor.r);
      if (coordMap.has(neighborId) && !landIds.has(neighborId)) {
        frontierIds.add(neighborId);
      }
    }
  }
  return [...frontierIds].map((id) => coordMap.get(id));
}

function getLandEdgeCandidates(landIds, coordMap, radius) {
  return [...landIds]
    .map((id) => coordMap.get(id))
    .filter((coord) => (
      coord
      && hexDistance(coord, { q: 0, r: 0 }) >= radius * 0.42
      && neighborCoords(coord).some((neighbor) => {
        const neighborId = hexId(neighbor.q, neighbor.r);
        return coordMap.has(neighborId) && !landIds.has(neighborId);
      })
    ));
}

function scoreGrowthCandidate(coord, landIds, coordMap, radius) {
  const adjacentLand = countLandNeighbors(coord, landIds, coordMap);
  const distance = hexDistance(coord, { q: 0, r: 0 }) / radius;
  const narrowBonus = adjacentLand <= 2 ? 0.7 : 0;
  return adjacentLand * 1.35 + narrowBonus - distance * 0.3 + Math.random() * 2.4;
}

function scorePeninsulaStart(coord, radius) {
  return hexDistance(coord, { q: 0, r: 0 }) / radius + Math.random() * 0.8;
}

function getOutwardDirection(coord, landIds, coordMap) {
  return DIRECTIONS
    .map((direction) => ({
      direction,
      next: { q: coord.q + direction.q, r: coord.r + direction.r }
    }))
    .filter(({ next }) => {
      const nextId = hexId(next.q, next.r);
      return coordMap.has(nextId) && !landIds.has(nextId);
    })
    .map((entry) => ({
      ...entry,
      score: hexDistance(entry.next, { q: 0, r: 0 }) + Math.random()
    }))
    .sort((a, b) => b.score - a.score)[0]?.direction ?? null;
}

function addRandomSideBulge(landIds, coord, direction, coordMap) {
  const sideDirections = DIRECTIONS.filter((candidate) => candidate !== direction && candidate.q !== -direction.q && candidate.r !== -direction.r);
  const side = sideDirections[Math.floor(Math.random() * sideDirections.length)];
  const bulge = { q: coord.q + side.q, r: coord.r + side.r };
  const bulgeId = hexId(bulge.q, bulge.r);
  if (coordMap.has(bulgeId)) {
    landIds.add(bulgeId);
  }
}

function addSafeInteriorVoids(landIds, protectedTiles, coordMap, radius, chance) {
  const candidates = [...landIds]
    .filter((id) => !protectedTiles.has(id) && id !== "0,0")
    .map((id) => coordMap.get(id))
    .filter((coord) => (
      coord
      && hexDistance(coord, { q: 0, r: 0 }) < radius - 1
      && countLandNeighbors(coord, landIds, coordMap) >= 4
      && Math.random() < chance * 0.8
    ))
    .sort(() => Math.random() - 0.5);

  for (const coord of candidates) {
    const id = hexId(coord.q, coord.r);
    if (landIds.size <= protectedTiles.size + 8) break;
    landIds.delete(id);
    if (!isLandConnected(landIds, coordMap)) {
      landIds.add(id);
    }
  }
}

function isLandConnected(landIds, coordMap) {
  const [startId] = landIds;
  if (!startId) return true;

  const visited = new Set([startId]);
  const queue = [coordMap.get(startId)];

  while (queue.length > 0) {
    const coord = queue.shift();
    for (const neighbor of neighborCoords(coord)) {
      const neighborId = hexId(neighbor.q, neighbor.r);
      if (landIds.has(neighborId) && !visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(coordMap.get(neighborId));
      }
    }
  }

  return visited.size === landIds.size;
}

function countLandNeighbors(coord, landIds, coordMap) {
  return neighborCoords(coord).filter((neighbor) => {
    const neighborId = hexId(neighbor.q, neighbor.r);
    return coordMap.has(neighborId) && landIds.has(neighborId);
  }).length;
}

function neighborCoords(coord) {
  return DIRECTIONS.map((direction) => ({
    q: coord.q + direction.q,
    r: coord.r + direction.r
  }));
}

function getSideDirections(direction) {
  const directionIndex = DIRECTIONS.findIndex((candidate) => candidate === direction);
  if (directionIndex < 0) return [];
  return [
    DIRECTIONS[(directionIndex + DIRECTIONS.length - 1) % DIRECTIONS.length],
    DIRECTIONS[(directionIndex + 1) % DIRECTIONS.length]
  ];
}

function listHexesWithin(center, range, radius) {
  const coords = [];
  for (let dq = -range; dq <= range; dq += 1) {
    for (let dr = -range; dr <= range; dr += 1) {
      const coord = { q: center.q + dq, r: center.r + dr };
      if (isInsideHexRadius(coord.q, coord.r, radius) && hexDistance(center, coord) <= range) {
        coords.push(coord);
      }
    }
  }
  return coords;
}

function scoreStartCandidate(candidate, targetAngle, selected) {
  const angleDistance = Math.min(
    Math.abs(candidate.angle - targetAngle),
    Math.PI * 2 - Math.abs(candidate.angle - targetAngle)
  );
  const closestSelected = selected.length === 0
    ? 99
    : Math.min(...selected.map((coord) => hexDistance(candidate, coord)));
  const crowdingPenalty = closestSelected < 3 ? 20 : closestSelected < 4 ? 6 : 0;
  return angleDistance + crowdingPenalty;
}

function normalizePlayerTypes(types, count) {
  return Array.from({ length: count }, (_, index) => types[index] === "computer" ? "computer" : "human");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}
