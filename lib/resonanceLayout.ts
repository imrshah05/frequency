export type ResonanceClusterPoint = {
  id: string;
  x: number;
  y: number;
  size: number;
  opacity: number;
};

export type ResonanceCluster = {
  canvasSize: number;
  points: ResonanceClusterPoint[];
};

const GOLDEN_ANGLE = 2.399963229728653; // radians (~137.5077°) — sunflower-seed spacing

const MAX_ORB_SIZE = 64;
const MIN_ORB_SIZE = 22;
const REFERENCE_COUNT = 4; // entry count at which orbs render at MAX_ORB_SIZE
const SPACING_FACTOR = 0.68;
const JITTER_ANGLE_RADIANS = 0.3;
const JITTER_RADIUS_FACTOR = 0.22;
const CANVAS_PADDING = 20;
const MIN_CANVAS_SIZE = 200;

// Dome/perspective grading: applied per-point after the flat spiral is laid
// out, based on how far back (by recency rank) each entry sits. 0 = newest,
// at the front; 1 = oldest, furthest back.
const DEPTH_MIN_SCALE = 0.62; // orb size at maximum depth
const DEPTH_RISE_MULTIPLIER = 1.7; // how far the furthest points rise, in spacing units
const DEPTH_HORIZONTAL_COMPRESS = 0.88; // horizontal narrowing at maximum depth
const DEPTH_MIN_OPACITY = 0.82; // faint dimming with distance (aerial perspective)

function lerp(from: number, to: number, t: number) {
  return from + (to - from) * t;
}

// A cheap, stable pseudo-random pair derived from a string id — same id
// always produces the same jitter, so the cluster doesn't reshuffle on
// re-render.
function seededJitter(seed: string): [number, number] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }

  const a = Math.abs(Math.sin(hash) * 10000) % 1;
  const b = Math.abs(Math.sin(hash * 1.7 + 1) * 10000) % 1;
  return [a, b];
}

// Arranges entries (most-recent-first) into a phyllotaxis / sunflower-seed
// spiral: the newest entry sits at the exact center, and each older entry
// spirals outward at an increasing radius. Orb size shrinks as the entry
// count grows (roughly 1/sqrt(count), the same scaling real circle packing
// follows), which keeps the whole cluster's footprint roughly constant
// regardless of how many entries exist — so it stays legible without
// needing to scroll. If it would still overflow the available width (very
// large counts), everything is scaled down uniformly as a safety net.
export function computeResonanceCluster(
  entryIds: string[],
  availableWidth: number
): ResonanceCluster {
  if (entryIds.length === 0) {
    return { canvasSize: 0, points: [] };
  }

  const count = entryIds.length;
  const orbSize = Math.min(
    MAX_ORB_SIZE,
    Math.max(MIN_ORB_SIZE, MAX_ORB_SIZE * Math.sqrt(REFERENCE_COUNT / count))
  );
  const spacing = orbSize * SPACING_FACTOR;

  const rawPoints = entryIds.map((id, index) => {
    // The most recent entry anchors dead-center, no jitter — everything
    // else spirals outward from it.
    if (index === 0) {
      return { id, x: 0, y: 0, size: orbSize };
    }

    const [jitterA, jitterB] = seededJitter(id);
    const angle = index * GOLDEN_ANGLE + (jitterA - 0.5) * JITTER_ANGLE_RADIANS;
    const radius = Math.max(
      0,
      spacing * Math.sqrt(index) + (jitterB - 0.5) * orbSize * JITTER_RADIUS_FACTOR
    );

    return {
      id,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      size: orbSize,
    };
  });

  // Layer the dome illusion on top of the flat spiral: older entries (higher
  // index) shrink, rise, and narrow horizontally, plus dim slightly — the
  // newest entry (index 0, depth 0) is untouched, staying full-size at
  // dead-center as the anchor.
  const domePoints = rawPoints.map((point, index) => {
    const depthT = count <= 1 ? 0 : index / (count - 1);

    return {
      id: point.id,
      x: point.x * lerp(1, DEPTH_HORIZONTAL_COMPRESS, depthT),
      y: point.y - depthT * spacing * DEPTH_RISE_MULTIPLIER,
      size: point.size * lerp(1, DEPTH_MIN_SCALE, depthT),
      opacity: lerp(1, DEPTH_MIN_OPACITY, depthT),
    };
  });

  // The dome shift makes the cluster asymmetric (points rise but never sink),
  // so fit a square canvas using each point's furthest axis component rather
  // than assuming a symmetric circular bound.
  const maxExtent = domePoints.reduce((max, point) => {
    const half = point.size / 2;
    return Math.max(max, Math.abs(point.x) + half, Math.abs(point.y) + half);
  }, 0);

  const desiredCanvas = Math.max(MIN_CANVAS_SIZE, maxExtent * 2 + CANVAS_PADDING * 2);
  const canvasSize = Math.min(desiredCanvas, availableWidth);
  const scaleFactor = canvasSize / desiredCanvas;

  const points = domePoints.map((point) => ({
    id: point.id,
    x: point.x * scaleFactor,
    y: point.y * scaleFactor,
    size: point.size * scaleFactor,
    opacity: point.opacity,
  }));

  return { canvasSize, points };
}
