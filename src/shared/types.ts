import type { ColorKey } from './colors';

/**
 * Disk model
 * ----------
 * The disk is a polar grid: `layers` radial layers × `spokes` angular slots.
 * Layer 0 is the outermost layer; layer `layers-1` is the innermost.
 * Disk content is a flat array of length `layers * spokes`, indexed
 * `i = layer * spokes + spoke`. `null` means the slot is empty (pixel pulled
 * or never placed).
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

  // Disk geometry
  spokes: number;
  layers: number;
  /** Length = spokes * layers. `null` = empty cell. */
  disk: (ColorKey | null)[];

  // Player-controlled rings (index 0 = innermost ring, nearest the disk)
  rings: RingData[];

  // Queue of containers in order; index 0 is the leader
  queue: ContainerData[];

  // Lose threshold — max balls that can rest on the floor before spill
  floorCapacity: number;

  /** Optional — present when the level was authored in the editor. */
  editorParams?: EditorParams;
}

export const LEVEL_SCHEMA_VERSION = 1;

/** Each container holds exactly this many balls before being destroyed. */
export const CONTAINER_SLOTS = 3;
