/**
 * Disk geometry helpers.
 *
 * The disk is a stack of concentric layers. Layer 0 is the outermost; layer
 * (layers - 1) is the innermost. Each layer has its own spoke count N_L,
 * scaled by its circumference so spheres of fixed size pack tightly along
 * the ring without leaving radial gaps. Inner layers have fewer slots.
 *
 * Per-layer counts are derived from a single `outerSpokes` parameter:
 *   R_outer = outerSpokes * D / (2π)            (D = sphere diameter)
 *   R_L      = R_outer - L * D                  (radial step = sphere diameter)
 *   N_L      = round(2π * R_L / D) = round(outerSpokes - 2π * L)
 *
 * This gives the disk a uniform "mosaic of equal-size spheres" feel rather
 * than the spoked-wheel look that emerges when every layer carries the same
 * spoke count.
 */

export const SPHERE_DIAMETER = 0.83;
export const SPHERE_RADIUS = SPHERE_DIAMETER / 2;

/** Spoke count for layer L given the outer-layer count. May return 0. */
export function spokesPerLayer(outerSpokes: number, layer: number): number {
  return Math.max(0, Math.round(outerSpokes - 2 * Math.PI * layer));
}

/** Radius of layer L's sphere centers. */
export function layerRadius(outerSpokes: number, layer: number): number {
  const rOuter = (outerSpokes * SPHERE_DIAMETER) / (2 * Math.PI);
  return rOuter - layer * SPHERE_DIAMETER;
}

/** Maximum layers where N_L > 0. */
export function maxLayersFor(outerSpokes: number): number {
  for (let L = 0; ; L++) {
    if (spokesPerLayer(outerSpokes, L) <= 0) return L;
  }
}

/** Total cell count for a disk with `outerSpokes` and `layers`. */
export function totalCellsFor(outerSpokes: number, layers: number): number {
  let n = 0;
  for (let L = 0; L < layers; L++) n += spokesPerLayer(outerSpokes, L);
  return n;
}

/** Outer-hull radius (beyond the centers of layer 0's spheres). */
export function diskHullRadius(outerSpokes: number): number {
  return layerRadius(outerSpokes, 0) + SPHERE_RADIUS;
}

/**
 * Round a worldspace angle (radians) to the spoke index within a layer.
 * Returned index is in [0, N_L).
 */
export function angleToSpokeIndex(angleRad: number, N: number): number {
  if (N <= 0) return 0;
  const tau = Math.PI * 2;
  const a = ((angleRad % tau) + tau) % tau;
  return Math.round((a / tau) * N) % N;
}

/**
 * Center angle (radians) for spoke s in a layer with N spokes.
 * All layers share the same angular offset (0) so a door at angle θ
 * lines up consistently across layers — important for clean lid behavior.
 */
export function spokeAngle(_layer: number, s: number, N: number): number {
  if (N <= 0) return 0;
  return (s / N) * Math.PI * 2;
}
