export function setupInput(canvas, renderer, { onTileClick }) {
  let lastTouchGesture = null;

  canvas.addEventListener("click", (event) => {
    const tile = renderer.getTileAtClientPoint(event.clientX, event.clientY);
    if (tile) {
      onTileClick(tile.id);
    }
  });

  canvas.addEventListener("mousemove", (event) => {
    const tile = renderer.getTileAtClientPoint(event.clientX, event.clientY);
    renderer.setHover(tile?.id ?? null);
    renderer.render();
  });

  canvas.addEventListener("mouseleave", () => {
    renderer.setHover(null);
    renderer.render();
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();

    if (event.ctrlKey) {
      const scale = Math.exp(-event.deltaY * 0.01);
      renderer.zoomAtClientPoint(event.clientX, event.clientY, scale);
      return;
    }

    renderer.panBy(-event.deltaX, -event.deltaY);
  }, { passive: false });

  canvas.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    lastTouchGesture = readTouchGesture(event.touches);
  }, { passive: false });

  canvas.addEventListener("touchmove", (event) => {
    if (event.touches.length !== 2 || !lastTouchGesture) return;
    event.preventDefault();

    const nextGesture = readTouchGesture(event.touches);
    renderer.panBy(
      nextGesture.center.x - lastTouchGesture.center.x,
      nextGesture.center.y - lastTouchGesture.center.y
    );
    renderer.zoomAtClientPoint(
      nextGesture.center.x,
      nextGesture.center.y,
      nextGesture.distance / Math.max(1, lastTouchGesture.distance)
    );
    lastTouchGesture = nextGesture;
  }, { passive: false });

  canvas.addEventListener("touchend", () => {
    lastTouchGesture = null;
  });
  canvas.addEventListener("touchcancel", () => {
    lastTouchGesture = null;
  });
}

function readTouchGesture(touches) {
  const first = touches[0];
  const second = touches[1];
  const dx = second.clientX - first.clientX;
  const dy = second.clientY - first.clientY;
  return {
    center: {
      x: (first.clientX + second.clientX) / 2,
      y: (first.clientY + second.clientY) / 2
    },
    distance: Math.hypot(dx, dy)
  };
}
