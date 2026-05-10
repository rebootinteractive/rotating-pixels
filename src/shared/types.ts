import type { ColorKey } from './colors';

/**
 * Disk model
 * ----------
 * The disk is a stack of concentric layers. Layer 0 is outermost. Each layer
 * has its own spoke count, derived from `outerSpokes` (the spoke count of
 * the outermost layer). Inner layers have fewer slots so spheres of fixed
 * size pack tightly without radial gaps.
 *
 * `disk` is an array of layers; `disk[layer]` is an array of length
 * `spokesPerLayer(outerSpokes, layer)`. `null` = empty cell.
 */
export interface DoorData {
  /** Angle in degrees, 0 = +X axis, CCW positive. */
  angleDeg: number;
  color: ColorKey;
}

export interface RingData {
  doors: DoorData[];
}

export interface ContainerData {
  color: ColorKey;
}

export type DepthBias = 'outer' | 'mixed' | 'inner';

export interface PerColorParams {
  containers: number; // each container holds 3 pixels of this color
  clumpiness: number; // 0..1 — 0 scattered, 1 single-patch
  depthBias: DepthBias;
}

export interface EditorParams {
  seed: number;
  /** Keyed by ColorKey; only colors the designer activated appear here. */
  perColor: Partial<Record<ColorKey, PerColorParams>>;
}

export interface LevelData {
  id: string;
  name: string;

  /** Spoke count of the outermost layer. Inner layers are auto-computed. */
  outerSpokes: number;
  /** Number of layers (radial depth). Layer 0 is outermost. */
  layers: number;
  /** Per-layer cells. disk[layer][spokeIndex]. `null` = empty. */
  disk: (ColorKey | null)[][];

  // Player-controlled rings (index 0 = innermost ring, nearest the disk)
  rings: RingData[];

  // Queue of containers in order; index 0 is the leader
  queue: ContainerData[];

  // Lose threshold — max balls that can rest on the floor before spill
  floorCapacity: number;

  /** Optional — present when the level was authored in the editor. */
  editorParams?: EditorParams;
}

export const LEVEL_SCHEMA_VERSION = 2;

/** Each container holds exactly this many balls before being destroyed. */
export const CONTAINER_SLOTS = 3;
