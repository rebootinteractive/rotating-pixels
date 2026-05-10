import type { ColorKey } from './colors';
import type { DepthBias, EditorParams, PerColorParams } from './types';
import { CONTAINER_SLOTS } from './types';
import { angleToSpokeIndex, spokeAngle, spokesPerLayer } from './diskGeometry';

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

interface CellRef {
  layer: number;
  indexInLayer: number;
  /** 0 = outermost, 1 = innermost. */
  depth: number;
}

function depthQualifies(depth: number, bias: DepthBias): number {
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
  return 1;
}

function neighborsOf(
  layer: number,
  idx: number,
  layerSpokes: number[]
): { layer: number; indexInLayer: number }[] {
  const out: { layer: number; indexInLayer: number }[] = [];
  const N = layerSpokes[layer];
  if (N <= 0) return out;
  // Same-layer wrap-around neighbors
  out.push({ layer, indexInLayer: (idx - 1 + N) % N });
  out.push({ layer, indexInLayer: (idx + 1) % N });
  // Layer above (outer)
  if (layer > 0) {
    const N2 = layerSpokes[layer - 1];
    if (N2 > 0) {
      const angle = spokeAngle(layer, idx, N);
      const i = angleToSpokeIndex(angle - spokeAngle(layer - 1, 0, N2), N2);
      out.push({ layer: layer - 1, indexInLayer: i });
    }
  }
  // Layer below (inner)
  if (layer < layerSpokes.length - 1) {
    const N2 = layerSpokes[layer + 1];
    if (N2 > 0) {
      const angle = spokeAngle(layer, idx, N);
      const i = angleToSpokeIndex(angle - spokeAngle(layer + 1, 0, N2), N2);
      out.push({ layer: layer + 1, indexInLayer: i });
    }
  }
  return out;
}

/**
 * Generate per-layer cell colors from designer parameters.
 * Returns disk[layer][indexInLayer] — same shape used by LevelData.
 */
export function generateDisk(
  outerSpokes: number,
  layers: number,
  params: EditorParams
): (ColorKey | null)[][] {
  const layerSpokes: number[] = [];
  for (let L = 0; L < layers; L++) layerSpokes.push(spokesPerLayer(outerSpokes, L));

  // Allocate result array
  const result: (ColorKey | null)[][] = layerSpokes.map((N) => new Array<ColorKey | null>(N).fill(null));

  // Flat list of cell refs with depth info
  const allCells: CellRef[] = [];
  for (let L = 0; L < layers; L++) {
    const N = layerSpokes[L];
    const depth = layers <= 1 ? 0 : L / (layers - 1);
    for (let i = 0; i < N; i++) {
      allCells.push({ layer: L, indexInLayer: i, depth });
    }
  }

  const rng = makeRng(params.seed || 1);

  // Sort colors descending by pixel count (place big colors first).
  const colorOrder: { color: ColorKey; params: PerColorParams; count: number }[] = [];
  for (const k of Object.keys(params.perColor) as ColorKey[]) {
    const p = params.perColor[k];
    if (!p || p.containers <= 0) continue;
    colorOrder.push({ color: k, params: p, count: p.containers * CONTAINER_SLOTS });
  }
  colorOrder.sort((a, b) => b.count - a.count);

  const isOccupied = (l: number, i: number) => result[l][i] !== null;

  for (const { color, params: p, count } of colorOrder) {
    if (count <= 0) continue;
    const clump = Math.max(0, Math.min(1, p.clumpiness));
    const patches = Math.max(1, Math.round(1 + (1 - clump) * (count - 1)));
    const patchCount = Math.min(patches, count);
    const base = Math.floor(count / patchCount);
    const rem = count - base * patchCount;
    const budgets: number[] = [];
    for (let i = 0; i < patchCount; i++) budgets.push(base + (i < rem ? 1 : 0));

    for (let bi = 0; bi < budgets.length; bi++) {
      const budget = budgets[bi];
      let placed = 0;

      // Pick a seed cell biased by depth preference.
      const candidates: { ref: CellRef; w: number }[] = [];
      for (const c of allCells) {
        if (isOccupied(c.layer, c.indexInLayer)) continue;
        const w = depthQualifies(c.depth, p.depthBias);
        candidates.push({ ref: c, w });
      }
      if (candidates.length === 0) break;
      const seed = weightedPick(candidates, rng);
      if (!seed) break;

      result[seed.layer][seed.indexInLayer] = color;
      placed++;

      if (placed >= budget) continue;

      // BFS expansion
      const frontier = neighborsOf(seed.layer, seed.indexInLayer, layerSpokes).filter(
        (n) => !isOccupied(n.layer, n.indexInLayer)
      );
      shuffleInPlace(frontier, rng);

      while (placed < budget && frontier.length > 0) {
        const next = frontier.shift()!;
        if (isOccupied(next.layer, next.indexInLayer)) continue;
        result[next.layer][next.indexInLayer] = color;
        placed++;
        const nb = neighborsOf(next.layer, next.indexInLayer, layerSpokes);
        shuffleInPlace(nb, rng);
        for (const n of nb) {
          if (
            !isOccupied(n.layer, n.indexInLayer) &&
            !frontier.some((f) => f.layer === n.layer && f.indexInLayer === n.indexInLayer)
          ) {
            frontier.push(n);
          }
        }
      }

      if (placed < budget) {
        // Couldn't fit the patch — push the leftover into a new sub-budget.
        budgets.push(budget - placed);
      }
    }
  }

  return result;
}

function weightedPick<T extends { ref: CellRef; w: number }>(
  items: T[],
  rng: () => number
): CellRef | null {
  let sum = 0;
  for (const it of items) sum += it.w;
  if (sum <= 0) return items[Math.floor(rng() * items.length)].ref;
  let r = rng() * sum;
  for (const it of items) {
    r -= it.w;
    if (r <= 0) return it.ref;
  }
  return items[items.length - 1].ref;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
