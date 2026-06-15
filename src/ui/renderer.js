import { calculateTileDefense } from "../core/combat.js";
import { getCurrentPlayer, getPlayer } from "../core/gameState.js";
import { getMapBounds, getNeighbors, hexCorners, hexId, hexToPixel, pixelToHex } from "../core/hexGrid.js";
import { RULES, getBuildingRule, getUnitRule } from "../core/rules.js";

const BUILDING_IMAGE_LAYOUTS = Object.freeze({
  farm: { heightScale: 1.22, anchorY: 0.62 },
  city: { heightScale: 2.15, anchorY: 0.77 },
  tower: { heightScale: 1.65, anchorY: 0.68 },
  strongTower: { heightScale: 1.95, anchorY: 0.76 }
});

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.state = null;
    this.defaultZoom = 1.35;
    this.zoom = this.defaultZoom;
    this.minZoom = 0.45;
    this.maxZoom = 5;
    this.baseHexSize = 28;
    this.hexSize = 28;
    this.origin = { x: 0, y: 0 };
    this.panOffset = { x: 0, y: 0 };
    this.selectedTileId = null;
    this.moveHighlights = new Set();
    this.captureHighlights = new Set();
    this.hoverTileId = null;
    this.towerShieldAnimation = null;
    this.animationFrameId = null;
    this.unitImages = createUnitImages(() => this.render());
    this.buildingImages = createBuildingImages(() => this.render());
    window.addEventListener("resize", () => this.render());
  }

  setState(state) {
    this.state = state;
    this.resetCamera();
  }

  setHighlights({ selectedTileId = null, moves = [], captures = [] } = {}) {
    this.selectedTileId = selectedTileId;
    this.moveHighlights = new Set(moves);
    this.captureHighlights = new Set(captures);
  }

  setHover(tileId) {
    this.hoverTileId = tileId;
  }

  getTileAtClientPoint(clientX, clientY) {
    if (!this.state) return null;
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const coord = pixelToHex(x, y, this.hexSize, this.origin);
    return this.state.tiles.find((tile) => tile.id === hexId(coord.q, coord.r)) ?? null;
  }

  resetCamera() {
    this.zoom = this.defaultZoom;
    this.panOffset = { x: 0, y: 0 };
  }

  panBy(deltaX, deltaY) {
    if (!this.state) return;
    this.panOffset.x += deltaX;
    this.panOffset.y += deltaY;
    this.render();
  }

  zoomAtClientPoint(clientX, clientY, scale) {
    if (!this.state) return;

    this.resizeCanvas();
    this.calculateLayout();

    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const localPoint = {
      x: (x - this.origin.x) / this.hexSize,
      y: (y - this.origin.y) / this.hexSize
    };
    const nextZoom = clamp(this.zoom * scale, this.minZoom, this.maxZoom);
    if (nextZoom === this.zoom) return;

    this.zoom = nextZoom;
    this.calculateLayout();

    this.panOffset.x += x - (this.origin.x + localPoint.x * this.hexSize);
    this.panOffset.y += y - (this.origin.y + localPoint.y * this.hexSize);
    this.render();
  }

  render(now = performance.now()) {
    if (!this.state) return;
    this.resizeCanvas();
    this.calculateLayout();
    this.drawBackground();

    for (const tile of this.state.tiles) {
      this.drawTile(tile);
    }
    for (const tile of this.state.tiles) {
      if (tile.building) this.drawBuilding(tile);
    }
    for (const tile of this.state.tiles) {
      if (tile.unit) this.drawUnit(tile);
    }
    this.drawTowerShieldAnimation(now);
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(320, Math.floor(rect.width));
    const height = Math.max(320, Math.floor(rect.height));
    if (this.canvas.width !== width * ratio || this.canvas.height !== height * ratio) {
      this.canvas.width = width * ratio;
      this.canvas.height = height * ratio;
    }
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.width = width;
    this.height = height;
  }

  calculateLayout() {
    const unitBounds = getMapBounds(this.state.tiles, 1);
    const padding = 64;
    const fitX = (this.width - padding * 2) / unitBounds.width;
    const fitY = (this.height - padding * 2) / unitBounds.height;
    this.baseHexSize = Math.max(5, Math.min(28, fitX, fitY));
    this.hexSize = this.baseHexSize * this.zoom;

    const bounds = getMapBounds(this.state.tiles, this.hexSize);
    this.origin = {
      x: this.width / 2 - (bounds.minX + bounds.width / 2) + this.panOffset.x,
      y: this.height / 2 - (bounds.minY + bounds.height / 2) + this.panOffset.y
    };
  }

  drawBackground() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#edf2ea";
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawTile(tile) {
    const ctx = this.ctx;
    const center = hexToPixel(tile.q, tile.r, this.hexSize, this.origin);
    const corners = hexCorners(center, this.hexSize - 1);
    const owner = tile.ownerId ? getPlayer(this.state, tile.ownerId) : null;
    const isSelected = tile.id === this.selectedTileId;
    const isMove = this.moveHighlights.has(tile.id);
    const isCapture = this.captureHighlights.has(tile.id);
    const isHover = tile.id === this.hoverTileId;

    ctx.beginPath();
    corners.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.fillStyle = this.getTileFill(tile, owner);
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = tile.terrain === RULES.terrain.blocked ? "#7c8580" : "#b9c6b5";
    ctx.stroke();

    if (isMove || isCapture || isSelected || isHover) {
      ctx.lineWidth = isSelected ? 4 : 3;
      ctx.strokeStyle = isSelected
        ? "#f2c84b"
        : isCapture
          ? "#cf4f3f"
          : isMove
            ? "#2f9560"
            : "rgba(31, 42, 46, 0.35)";
      ctx.stroke();
    }

    if (tile.terrain !== RULES.terrain.blocked && tile.ownerId !== null) {
      const defense = calculateTileDefense(this.state, tile.id);
      if (defense > 0) {
        ctx.fillStyle = "rgba(31, 42, 46, 0.56)";
        ctx.font = `${Math.max(9, this.hexSize * 0.34)}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(defense), center.x + this.hexSize * 0.46, center.y - this.hexSize * 0.42);
      }
    }
  }

  getTileFill(tile, owner) {
    if (tile.terrain === RULES.terrain.blocked) {
      if (tile.blockedKind === "water") {
        return "#c8dfe4";
      }
      return "#8f9893";
    }
    if (!owner) {
      return "#f7f3df";
    }
    return withAlpha(owner.color, 0.72);
  }

  playTowerShieldAnimation(tileId) {
    if (!this.state) return;
    const tile = this.state.tiles.find((candidate) => candidate.id === tileId);
    if (!isTowerBuilding(tile)) return;

    const neighborIds = getNeighbors(tile, this.state.tiles)
      .filter((neighbor) => neighbor.terrain !== RULES.terrain.blocked)
      .map((neighbor) => neighbor.id);
    if (neighborIds.length === 0) return;

    this.towerShieldAnimation = {
      tileId,
      neighborIds,
      start: performance.now(),
      duration: 760
    };
    this.queueAnimationFrame();
  }

  queueAnimationFrame() {
    if (this.animationFrameId !== null) return;
    this.animationFrameId = requestAnimationFrame((now) => {
      this.animationFrameId = null;
      this.render(now);
      if (this.towerShieldAnimation) {
        this.queueAnimationFrame();
      }
    });
  }

  drawBuilding(tile) {
    const ctx = this.ctx;
    const center = hexToPixel(tile.q, tile.r, this.hexSize, this.origin);
    const rule = getBuildingRule(tile.building.type);
    const size = this.hexSize;
    const buildingType = tile.building.type;

    ctx.save();
    ctx.translate(center.x, center.y + size * 0.1);
    const buildingImage = this.buildingImages[buildingType];
    if (isImageReady(buildingImage)) {
      this.drawBuildingImage(buildingImage, size, BUILDING_IMAGE_LAYOUTS[buildingType]);
    } else if (buildingType === "city") {
      this.drawHouse(size, { large: true, tower: true });
    } else if (buildingType === "farm") {
      this.drawHouse(size, { large: false, tower: false });
    } else {
      this.drawTower(size, buildingType === "strongTower");
    }
    ctx.restore();

    if (rule?.income > 0) {
      this.drawCoin(center.x - size * 0.12, center.y + size * 0.5, size * 0.11);
      ctx.fillStyle = "#6c4e12";
      ctx.font = `700 ${Math.max(9, size * 0.3)}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${rule.income}`, center.x, center.y + size * 0.5);
    }
  }

  drawUnit(tile) {
    const ctx = this.ctx;
    const center = hexToPixel(tile.q, tile.r, this.hexSize, this.origin);
    const owner = getPlayer(this.state, tile.unit.ownerId);
    const rule = getUnitRule(tile.unit.level);
    const size = this.hexSize;
    const color = owner?.color ?? "#333";

    ctx.save();
    ctx.translate(center.x, center.y + size * 0.04);
    if (tile.unit.acted) {
      ctx.globalAlpha = 0.58;
    }

    const unitImage = this.unitImages[tile.unit.level];
    if (unitImage?.complete && unitImage.naturalWidth > 0) {
      this.drawUnitImage(unitImage, size);
    } else {
      this.drawUnitFigure(tile.unit.level, color, size);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(31, 42, 46, 0.72)";
    ctx.font = `700 ${Math.max(8, size * 0.23)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`L${tile.unit.level}`, 0, size * 0.48);
    ctx.fillStyle = "rgba(31, 42, 46, 0.64)";
    ctx.font = `${Math.max(7, size * 0.2)}px sans-serif`;
    ctx.fillText(rule?.name.slice(0, 1) ?? "U", 0, -size * 0.52);
    ctx.restore();
  }

  drawUnitImage(image, size) {
    const ctx = this.ctx;
    const height = size * 1.45;
    const width = height * (image.naturalWidth / image.naturalHeight);
    ctx.drawImage(image, -width / 2, -height * 0.56, width, height);
  }

  drawBuildingImage(image, size, layout = BUILDING_IMAGE_LAYOUTS.farm) {
    const ctx = this.ctx;
    const height = size * layout.heightScale;
    const width = height * (image.naturalWidth / image.naturalHeight);
    ctx.drawImage(image, -width / 2, -height * layout.anchorY, width, height);
  }

  drawHouse(size, { large, tower }) {
    const ctx = this.ctx;
    const width = size * (large ? 0.76 : 0.58);
    const height = size * (large ? 0.46 : 0.34);
    const roofY = -height * 0.95;
    const bodyY = -height * 0.32;

    ctx.fillStyle = "#8c5f32";
    ctx.beginPath();
    ctx.moveTo(-width * 0.58, bodyY);
    ctx.lineTo(0, roofY);
    ctx.lineTo(width * 0.58, bodyY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = large ? "#e6d4a0" : "#ead9a5";
    ctx.fillRect(-width * 0.45, bodyY, width * 0.9, height);
    ctx.strokeStyle = "rgba(31, 42, 46, 0.35)";
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.strokeRect(-width * 0.45, bodyY, width * 0.9, height);

    ctx.fillStyle = "#6e4a2b";
    ctx.fillRect(-width * 0.09, bodyY + height * 0.42, width * 0.18, height * 0.58);
    ctx.fillStyle = "#f8f0c0";
    ctx.fillRect(width * 0.18, bodyY + height * 0.22, width * 0.14, height * 0.18);

    if (tower) {
      ctx.fillStyle = "#b8b2a4";
      ctx.fillRect(width * 0.24, -height * 1.36, width * 0.24, height * 1.25);
      ctx.fillStyle = "#7d4f32";
      ctx.fillRect(width * 0.2, -height * 1.48, width * 0.32, height * 0.15);
      ctx.fillStyle = "#f8f0c0";
      ctx.fillRect(width * 0.31, -height * 0.92, width * 0.1, height * 0.18);
    }
  }

  drawTower(size, strong) {
    const ctx = this.ctx;
    const width = size * (strong ? 0.5 : 0.38);
    const height = size * (strong ? 0.95 : 0.72);
    const y = -height * 0.55;

    ctx.fillStyle = strong ? "#4f4b52" : "#69747b";
    ctx.fillRect(-width * 0.5, y, width, height);
    ctx.fillStyle = strong ? "#39363d" : "#4f5960";
    ctx.fillRect(-width * 0.64, y - size * 0.12, width * 1.28, size * 0.14);

    ctx.fillStyle = "#f7f3df";
    ctx.fillRect(-width * 0.12, y + height * 0.34, width * 0.24, height * 0.22);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.beginPath();
    ctx.moveTo(-width * 0.28, y + height * 0.18);
    ctx.lineTo(-width * 0.28, y + height * 0.84);
    ctx.moveTo(width * 0.28, y + height * 0.18);
    ctx.lineTo(width * 0.28, y + height * 0.84);
    ctx.stroke();
  }

  drawUnitFigure(level, color, size) {
    const ctx = this.ctx;
    const skin = "#d7a36a";
    const leather = "#6c4a30";
    const cloth = color;
    const metal = level >= 4 ? "#d8dde0" : "#aeb7b8";

    ctx.fillStyle = "rgba(31, 42, 46, 0.22)";
    ctx.beginPath();
    ctx.ellipse(0, size * 0.29, size * 0.28, size * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = leather;
    ctx.lineWidth = Math.max(1.5, size * 0.06);
    ctx.beginPath();
    ctx.moveTo(-size * 0.08, size * 0.12);
    ctx.lineTo(-size * 0.17, size * 0.28);
    ctx.moveTo(size * 0.08, size * 0.12);
    ctx.lineTo(size * 0.17, size * 0.28);
    ctx.stroke();

    ctx.fillStyle = level >= 3 ? metal : cloth;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.18);
    ctx.lineTo(-size * 0.18, size * 0.15);
    ctx.lineTo(size * 0.18, size * 0.15);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = level >= 3 ? "#6d777b" : "rgba(31, 42, 46, 0.45)";
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.stroke();

    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(0, -size * 0.3, size * 0.12, 0, Math.PI * 2);
    ctx.fill();

    if (level >= 3) {
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.arc(0, -size * 0.32, size * 0.13, Math.PI, 0);
      ctx.lineTo(size * 0.11, -size * 0.29);
      ctx.lineTo(-size * 0.11, -size * 0.29);
      ctx.closePath();
      ctx.fill();
    }

    if (level >= 2) {
      this.drawWeapon(level, size);
    }

    if (level >= 3) {
      this.drawShield(level, color, size);
    }

    if (level >= 4) {
      ctx.strokeStyle = "#eef2f2";
      ctx.lineWidth = Math.max(1, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(-size * 0.08, -size * 0.11);
      ctx.lineTo(size * 0.08, size * 0.1);
      ctx.moveTo(size * 0.08, -size * 0.11);
      ctx.lineTo(-size * 0.08, size * 0.1);
      ctx.stroke();
    }
  }

  drawWeapon(level, size) {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    if (level === 2) {
      ctx.strokeStyle = "#5f4431";
      ctx.lineWidth = Math.max(1.5, size * 0.045);
      ctx.beginPath();
      ctx.moveTo(size * 0.18, size * 0.2);
      ctx.lineTo(size * 0.3, -size * 0.45);
      ctx.stroke();
      ctx.fillStyle = "#cfd5d6";
      ctx.beginPath();
      ctx.moveTo(size * 0.3, -size * 0.55);
      ctx.lineTo(size * 0.23, -size * 0.4);
      ctx.lineTo(size * 0.36, -size * 0.42);
      ctx.closePath();
      ctx.fill();
      return;
    }

    ctx.strokeStyle = "#cfd5d6";
    ctx.lineWidth = Math.max(1.5, size * 0.05);
    ctx.beginPath();
    ctx.moveTo(size * 0.17, size * 0.08);
    ctx.lineTo(size * 0.34, -size * 0.32);
    ctx.stroke();
    ctx.strokeStyle = "#6c4a30";
    ctx.lineWidth = Math.max(1, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(size * 0.11, size * 0.12);
    ctx.lineTo(size * 0.22, size * 0.05);
    ctx.stroke();
  }

  drawShield(level, color, size) {
    const ctx = this.ctx;
    const shieldSize = level >= 4 ? 0.2 : 0.16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-size * 0.24, -size * 0.08);
    ctx.lineTo(-size * (0.24 + shieldSize), size * 0.02);
    ctx.lineTo(-size * 0.32, size * 0.23);
    ctx.lineTo(-size * 0.18, size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#eef2f2";
    ctx.lineWidth = Math.max(1, size * 0.035);
    ctx.stroke();
  }

  drawCoin(x, y, radius) {
    const ctx = this.ctx;
    const coinImage = this.buildingImages.coin;
    ctx.save();
    if (isImageReady(coinImage)) {
      const imageSize = radius * 2.7;
      ctx.drawImage(coinImage, x - imageSize / 2, y - imageSize / 2, imageSize, imageSize);
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#e8b72e";
    ctx.fill();
    ctx.strokeStyle = "#8e6112";
    ctx.lineWidth = Math.max(1, radius * 0.22);
    ctx.stroke();
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.beginPath();
    ctx.arc(x - radius * 0.32, y - radius * 0.32, radius * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawTowerShieldAnimation(now) {
    const animation = this.towerShieldAnimation;
    if (!animation || !this.state) return;

    const elapsed = now - animation.start;
    const progress = Math.min(1, elapsed / animation.duration);
    if (progress >= 1) {
      this.towerShieldAnimation = null;
      return;
    }

    const source = this.state.tiles.find((tile) => tile.id === animation.tileId);
    if (!isTowerBuilding(source)) {
      this.towerShieldAnimation = null;
      return;
    }

    const sourceCenter = hexToPixel(source.q, source.r, this.hexSize, this.origin);
    const eased = easeOutCubic(progress);
    const fade = progress < 0.72 ? 1 : Math.max(0, 1 - (progress - 0.72) / 0.28);
    const pulse = Math.sin(progress * Math.PI);
    const imageSize = this.hexSize * (0.68 + pulse * 0.12);

    for (const neighborId of animation.neighborIds) {
      const target = this.state.tiles.find((tile) => tile.id === neighborId);
      if (!target) continue;

      const targetCenter = hexToPixel(target.q, target.r, this.hexSize, this.origin);
      const x = sourceCenter.x + (targetCenter.x - sourceCenter.x) * eased;
      const y = sourceCenter.y + (targetCenter.y - sourceCenter.y) * eased;
      this.drawShieldAnimationIcon(x, y, imageSize, fade);
    }
  }

  drawShieldAnimationIcon(x, y, size, alpha) {
    const ctx = this.ctx;
    const shieldImage = this.buildingImages.shield;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (isImageReady(shieldImage)) {
      const imageSize = size * 1.35;
      ctx.drawImage(shieldImage, x - imageSize / 2, y - imageSize / 2, imageSize, imageSize);
      ctx.restore();
      return;
    }

    ctx.translate(x, y);
    ctx.fillStyle = "#2f62a8";
    ctx.strokeStyle = "#d8d4c6";
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.52);
    ctx.lineTo(size * 0.42, -size * 0.24);
    ctx.lineTo(size * 0.28, size * 0.34);
    ctx.lineTo(0, size * 0.56);
    ctx.lineTo(-size * 0.28, size * 0.34);
    ctx.lineTo(-size * 0.42, -size * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function withAlpha(hex, alpha) {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isImageReady(image) {
  return image?.complete && image.naturalWidth > 0;
}

function isTowerBuilding(tile) {
  return tile?.building?.type === "tower" || tile?.building?.type === "strongTower";
}

function easeOutCubic(value) {
  return 1 - ((1 - value) ** 3);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createUnitImages(onLoad) {
  if (typeof Image === "undefined") {
    return {};
  }

  const images = {
    1: new Image(),
    2: new Image(),
    3: new Image(),
    4: new Image()
  };
  for (const image of Object.values(images)) {
    image.addEventListener("load", onLoad);
  }
  images[1].src = "./assets/units/bauer_l1.png?v=1";
  images[2].src = "./assets/units/speertraeger_l2.png?v=1";
  images[3].src = "./assets/units/ritter_leicht_l3.png?v=1";
  images[4].src = "./assets/units/ritter_voll_l4.png?v=1";
  return images;
}

function createBuildingImages(onLoad) {
  if (typeof Image === "undefined") {
    return {};
  }

  const images = {
    farm: new Image(),
    city: new Image(),
    tower: new Image(),
    strongTower: new Image(),
    coin: new Image(),
    shield: new Image()
  };
  for (const image of Object.values(images)) {
    image.addEventListener("load", onLoad);
  }
  images.farm.src = "./assets/buildings/farm.png?v=1";
  images.city.src = "./assets/buildings/stadt.png?v=1";
  images.tower.src = "./assets/buildings/turm_klein.png?v=1";
  images.strongTower.src = "./assets/buildings/turm_gross.png?v=1";
  images.coin.src = "./assets/ui/goldmuenze.png?v=1";
  images.shield.src = "./assets/ui/schild.png?v=1";
  return images;
}
