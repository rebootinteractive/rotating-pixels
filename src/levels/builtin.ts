import type { ColorKey } from '../shared/colors';
import type { LevelData } from '../shared/types';

const fill = <T>(n: number, v: T): T[] => new Array(n).fill(v);

// ---------- Level 1 — First Spin ----------
// Single layer of reds, one ring, one red door. Just teach the rotation feel.
const level1: LevelData = {
  id: 'l1-first-spin',
  name: 'First Spin',
  outerSpokes: 12,
  layers: 1,
  disk: [fill<ColorKey | null>(12, 'red')],
  rings: [{ doors: [{ angleDeg: 0, color: 'red' }] }],
  queue: [
    { color: 'red' }, { color: 'red' }, { color: 'red' }, { color: 'red' },
  ],
  floorCapacity: 8,
};

// ---------- Level 2 — Two Doors ----------
// Outer ring of reds (18) + inner ring of blues (12). One ring with two
// doors of different colors. Teaches multi-color extraction on a single
// rotating ring + how the inner layer is only reachable once outer is gone.
const level2_outer: (ColorKey | null)[] = fill(18, 'red');
const level2_inner: (ColorKey | null)[] = fill(12, 'blue');
const level2: LevelData = {
  id: 'l2-two-doors',
  name: 'Two Doors',
  outerSpokes: 18,
  layers: 2,
  disk: [level2_outer, level2_inner],
  rings: [
    {
      doors: [
        { angleDeg: 0, color: 'red' },
        { angleDeg: 180, color: 'blue' },
      ],
    },
  ],
  queue: [
    { color: 'red' }, { color: 'red' }, { color: 'blue' }, { color: 'red' },
    { color: 'blue' }, { color: 'red' }, { color: 'red' }, { color: 'blue' },
    { color: 'blue' }, { color: 'red' },
  ],
  floorCapacity: 12,
};

// ---------- Level 3 — Lid Trap ----------
// outerSpokes=21 → outer=21 cells, inner=15 cells (36 total).
// Six green pixels sit on the outer layer at carefully-chosen spokes,
// blocking access to the red pixels directly behind them. The inner
// row alternates blue (default) with red (under the lids) at the
// closest-aligned indices.
//
//   Greens at outer spokes:           0, 3, 7, 10, 14, 17
//   Reds-beneath at inner spokes:     0, 2, 5,  7, 10, 12
//
// (Inner indices are the closest-by-angle to each outer green's angle.)
const greenSpokes = new Set([0, 3, 7, 10, 14, 17]);
const innerRedsSpokes = new Set([0, 2, 5, 7, 10, 12]);

const level3_outer: (ColorKey | null)[] = [];
for (let i = 0; i < 21; i++) {
  level3_outer.push(greenSpokes.has(i) ? 'green' : 'red');
}
const level3_inner: (ColorKey | null)[] = [];
for (let i = 0; i < 15; i++) {
  level3_inner.push(innerRedsSpokes.has(i) ? 'red' : 'blue');
}

const level3: LevelData = {
  id: 'l3-lid-trap',
  name: 'Lid Trap',
  outerSpokes: 21,
  layers: 2,
  disk: [level3_outer, level3_inner],
  rings: [
    // Inner ring carries red and green doors (must coordinate within one rotation).
    {
      doors: [
        { angleDeg: 0, color: 'red' },
        { angleDeg: 90, color: 'green' },
      ],
    },
    // Outer ring carries blue alone, on its own rotation.
    {
      doors: [{ angleDeg: 45, color: 'blue' }],
    },
  ],
  // Counts: red=21 (15 outer + 6 inner) → 7 containers
  //         blue=9 (inner)              → 3 containers
  //         green=6 (outer lids)        → 2 containers
  queue: [
    { color: 'red' }, { color: 'red' }, { color: 'blue' },
    { color: 'red' }, { color: 'green' }, { color: 'red' },
    { color: 'blue' }, { color: 'red' }, { color: 'green' },
    { color: 'red' }, { color: 'blue' }, { color: 'red' },
  ],
  floorCapacity: 12,
};

export const BUILTIN_LEVELS: LevelData[] = [level1, level2, level3];
