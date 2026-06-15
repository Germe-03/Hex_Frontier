export const DIRECTIONS = Object.freeze([
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
]);

export function hexId(q, r) {
  return `${q},${r}`;
}

export function parseHexId(id) {
  const [q, r] = id.split(",").map(Number);
  return { q, r };
}

export function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function isInsideHexRadius(q, r, radius) {
  return hexDistance({ q, r }, { q: 0, r: 0 }) <= radius;
}

export function listHexes(radius) {
  const coords = [];
  for (let q = -radius; q <= radius; q += 1) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r += 1) {
      coords.push({ q, r });
    }
  }
  return coords;
}

export function buildTileMap(tiles) {
  return new Map(tiles.map((tile) => [tile.id, tile]));
}

export function getNeighborCoords(tile) {
  return DIRECTIONS.map((direction) => ({
    q: tile.q + direction.q,
    r: tile.r + direction.r
  }));
}

export function getNeighbors(tile, tiles) {
  const tileMap = tiles instanceof Map ? tiles : buildTileMap(tiles);
  return getNeighborCoords(tile)
    .map((coord) => tileMap.get(hexId(coord.q, coord.r)))
    .filter(Boolean);
}

export function areNeighbors(a, b) {
  return hexDistance(a, b) === 1;
}

export function hexToPixel(q, r, size, origin = { x: 0, y: 0 }) {
  return {
    x: origin.x + size * Math.sqrt(3) * (q + r / 2),
    y: origin.y + size * 1.5 * r
  };
}

export function pixelToHex(x, y, size, origin = { x: 0, y: 0 }) {
  const localX = (x - origin.x) / size;
  const localY = (y - origin.y) / size;
  const q = (Math.sqrt(3) / 3) * localX - (1 / 3) * localY;
  const r = (2 / 3) * localY;
  return axialRound(q, r);
}

export function axialRound(q, r) {
  let x = q;
  let z = r;
  let y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const xDiff = Math.abs(rx - x);
  const yDiff = Math.abs(ry - y);
  const zDiff = Math.abs(rz - z);

  if (xDiff > yDiff && xDiff > zDiff) {
    rx = -ry - rz;
  } else if (yDiff > zDiff) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  return { q: rx, r: rz };
}

export function hexCorners(center, size) {
  const corners = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (30 + 60 * i);
    corners.push({
      x: center.x + size * Math.cos(angle),
      y: center.y + size * Math.sin(angle)
    });
  }
  return corners;
}

export function getConnectedRegions(tiles, ownerId) {
  const tileMap = buildTileMap(tiles);
  const ownedIds = new Set(
    tiles
      .filter((tile) => tile.ownerId === ownerId && tile.terrain !== "blocked")
      .map((tile) => tile.id)
  );
  const regions = [];

  while (ownedIds.size > 0) {
    const [startId] = ownedIds;
    const queue = [tileMap.get(startId)];
    const region = [];
    ownedIds.delete(startId);

    while (queue.length > 0) {
      const tile = queue.shift();
      region.push(tile);

      for (const neighbor of getNeighbors(tile, tileMap)) {
        if (ownedIds.has(neighbor.id)) {
          ownedIds.delete(neighbor.id);
          queue.push(neighbor);
        }
      }
    }

    regions.push(region);
  }

  return regions;
}

export function calculateBorders(tiles) {
  const tileMap = buildTileMap(tiles);
  const borders = [];
  for (const tile of tiles) {
    if (tile.terrain === "blocked") continue;
    for (const neighbor of getNeighbors(tile, tileMap)) {
      if (neighbor.terrain === "blocked") continue;
      if (tile.id < neighbor.id && tile.ownerId !== neighbor.ownerId) {
        borders.push({ a: tile.id, b: neighbor.id });
      }
    }
  }
  return borders;
}

export function getMapBounds(tiles, size) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const tile of tiles) {
    const center = hexToPixel(tile.q, tile.r, size);
    minX = Math.min(minX, center.x - size);
    minY = Math.min(minY, center.y - size);
    maxX = Math.max(maxX, center.x + size);
    maxY = Math.max(maxY, center.y + size);
  }

  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
