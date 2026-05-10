import type { ColorKey } from './colors';
import type { DepthBias, EditorParams, PerColorParams } from './types';
import { CONTAINER_SLOTS } from './types';

/** Mulberry32 — small deterministic PRNG. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function totalPixelsFromParams(params: EditorParams): number {
  let n = 0;
  for (const k of Object.keys(params.perColor)) {
    const p = params.perColor[k as ColorKey];
    if (p) n += p.containers * CONTAINER_SLOTS;
  }
  return n;
}

/** Recommend a layer count for given spokes + total pixels. */
export function recommendedLayers(spokes: number, totalPixels: number): number {
  return Math.max(1, Math.ceil(totalPixels / spokes));
}

interface Cell {
  layer: number;
  spoke: number;
  depth: number; // 0 = outermost layer, 1 = innermost
}

function depthQualifies(depth: number, bias: DepthBias): number {
  // Returns a weight 0..1 — high if cell matches bias preference.
  if (bias === 'outer') {
    if (depth <= 0.4) return 1;
    if (depth <= 0.7) return 0.3;
    return 0.05;
  }
  if (bias === 'inner') {
    if (depth >= 0.6) return 1;
    if (depth >= 0.3) return 0.3;
    return 0.05;
  }
  return 1; // mixed
}

function neighborIndices(layer: number, spoke: number, layers: number, spokes: number): number[] {
  const out: number[] = [];
  if (layer > 0) out.push((layer - 1) * spokes + spoke);
  if (layer < layers - 1) out.push((layer + 1) * spokes + spoke);
  out.push(layer * spokes + ((spoke - 1 + spokes) % spokes));
  out.push(layer * spokes + ((spoke + 1) % spokes));
  return out;
}

/**
 * Generate a disk[] array (`(ColorKey | null)[]` of length spokes*layers)
 * from per-color parameters. Empty cells (`null`) appear only when
 * total pixel count is less than spokes*layers.
 */
export function generateDisk(
  spokes: number,
  layers: number,
  params: EditorParams
): (ColorKey | null)[] {
  const total = spokes * layers;
  const disk: (ColorKey | null)[] = new Array(total).fill(null);
  const rng = makeRng(params.seed || 1);

  // Build cells with depth metadata.
  const cells: Cell[] = [];
  for (let l = 0; l < layers; l++) {
    const depth = layers <= 1 ? 0 : l / (layers - 1);
    for (let s = 0; s < spokes; s++) {
      cells.push({ layer: l, spoke: s, depth });
    }
  }

  // Stable order to place colors (descending pixel count → big colors first).
  const colorOrder: { color: ColorKey; params: PerColorParams; count: number }[] = [];
  for (const k of Object.keys(params.perColor) as ColorKey[]) {
    const p = params.perColor[k];
    if (!p || p.containers <= 0) continue;
    colorOrder.push({ color: k, params: p, count: p.containers * CONTAINER_SLOTS });
  }
  colorOrder.sort((a, b) => b.count - a.count);

  // For each color: place into N patches (N depends on clumpiness) that grow
  // BFS-style across (layer ±1, spoke ±1) neighbors, biased to preferred depth.
  for (const { color, params: p, count } of colorOrder) {
    if (count <= 0) continue;
    const clump = Math.max(0, Math.min(1, p.clumpiness));
    // Patch count: 1 (clump=1) … count (clump=0)
    const patches = Math.max(1, Math.round(1 + (1 - clump) * (count - 1)));
    const patchCount = Math.min(patches, count);
    // Per-patch budgets (distribute remainder)
    const base = Math.floor(count / patchCount);
    const rem = count - base * patchCount;
    const budgets: number[] = [];
    for (let i = 0; i < patchCount; i++) budgets.push(base + (i < rem ? 1 : 0));

    for (const budget of budgets) {
      let placed = 0;
      // Pick a seed cell biased by depth preference.
      const candidates: { idx: number; w: number }[] = [];
      for (let i = 0; i < total; i++) {
        if (disk[i] !== null) continue;
        const w = depthQualifies(cells[i].depth, p.depthBias);
        candidates.push({ idx: i, w });
      }
      if (candidates.length === 0) break;
      const seedIdx = weightedPick(candidates, rng);
      if (seedIdx === -1) break;

      disk[seedIdx] = color;
      placed++;

      if (placed >= budget) continue;

      // BFS expansion from the seed.
      const frontier: number[] = neighborIndices(
        cells[seedIdx].layer,
        cells[seedIdx].spoke,
        layers,
        spokes
      ).filter((i) => disk[i] === null);
      shuffleInPlace(frontier, rng);

      while (placed < budget && frontier.length > 0) {
        const next = frontier.shift()!;
        if (disk[next] !== null) continue;
        disk[next] = color;
        placed++;
        // Append new neighbors of `next` to frontier
        const nb = neighborIndices(cells[next].layer, cells[next].spoke, layers, spokes);
        shuffleInPlace(nb, rng);
        for (const n of nb) {
          if (disk[n] === null && !frontier.includes(n)) frontier.push(n);
        }
      }

      // If patch ran out of contiguous neighbors, drop remainder into next iteration's
      // candidates pool (handled by the outer for-loop picking a fresh seed).
      if (placed < budget) {
        // Spawn a "ghost" sub-patch with leftover budget — push into queue
        budgets.push(budget - placed);
      }
    }
  }

  return disk;
}

function weightedPick(items: { idx: number; w: number }[], rng: () => number): number {
  let sum = 0;
  for (const it of items) sum += it.w;
  if (sum <= 0) {
    // All weights zero — pick uniformly
    return items[Math.floor(rng() * items.length)].idx;
  }
  let r = rng() * sum;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it.idx;
  }
  return items[items.length - 1].idx;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
