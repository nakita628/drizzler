// What the router, the track spreader and the caption placer all ask of a box: whether another
// meets it, what holds a few of them, and how much of a wire runs hidden inside them.
import type { Box, Point, Route } from "../types/index.js";

/** The smallest box holding them all, grown by a margin. */
export function around(boxes: readonly Box[], margin: number): Box {
  const x = Math.min(...boxes.map((box) => box.x)) - margin;
  const y = Math.min(...boxes.map((box) => box.y)) - margin;
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) + margin - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) + margin - y,
  };
}

/** The box two points span: a line's worth of box between two ends, or a point's for one. */
export function spanning(a: Point, b: Point = a): Box {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

/** The box grown by `by` on every side, or shrunk by it where `by` is below zero. */
export function grow(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, width: box.width + by * 2, height: box.height + by * 2 };
}

/** Whether two boxes overlap; boxes that only touch do not meet. */
export function meets(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** How long a stretch of an axis-aligned segment runs inside a box. */
function insideBox(a: Point, b: Point, box: Box) {
  // The segment is flat, so it is hidden only where the coordinate it does not travel along
  // falls within the box; along the one it does, the two spans simply overlap.
  if (a.y === b.y) {
    if (a.y <= box.y || a.y >= box.y + box.height) return 0;
    return Math.max(
      0,
      Math.min(Math.max(a.x, b.x), box.x + box.width) - Math.max(Math.min(a.x, b.x), box.x),
    );
  }
  if (a.x <= box.x || a.x >= box.x + box.width) return 0;
  return Math.max(
    0,
    Math.min(Math.max(a.y, b.y), box.y + box.height) - Math.max(Math.min(a.y, b.y), box.y),
  );
}

/** How much of a route disappears behind the cards, and how long the route is. */
export function routeCost(points: Route, obstacles: readonly Box[]) {
  return boundedRouteCost(points, obstacles, Infinity);
}

/**
 * {@link routeCost}, given up once more than `limit` of the route is hidden: the hidden length only
 * grows segment by segment, so such a route can never beat one hiding `limit`. A route given up on
 * reports `hidden: Infinity`; any other sums exactly as {@link routeCost} does.
 */
export function boundedRouteCost(points: Route, obstacles: readonly Box[], limit: number) {
  return points.slice(0, -1).reduce(
    (cost, a, index) => {
      if (cost.hidden > limit) return { hidden: Infinity, length: cost.length };
      const b = points[index + 1] ?? a;
      const hidden = cost.hidden + obstacles.reduce((sum, box) => sum + insideBox(a, b, box), 0);
      return {
        hidden: hidden > limit ? Infinity : hidden,
        length: cost.length + Math.hypot(b.x - a.x, b.y - a.y),
      };
    },
    { hidden: 0, length: 0 },
  );
}
