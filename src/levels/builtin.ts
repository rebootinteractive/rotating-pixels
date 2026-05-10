import type { LevelData } from '../shared/types';

// Level 1 — tutorial-trivial. One ring, one red door, single layer of reds.
// Player learns: spin the ring, the door peels reds, balls fall, queue collects.
const level1: LevelData = {
  id: 'l1-first-spin',
  name: 'First Spin',
  spokes: 12,
  layers: 1,
  disk: [
    'red', 'red', 'red', 'red', 'red', 'red',
    'red', 'red', 'red', 'red', 'red', 'red',
  ],
  rings: [
    { doors: [{ angleDeg: 0, color: 'red' }] },
  ],
  queue: [
    { color: 'red' }, { color: 'red' }, { color: 'red' }, { color: 'red' },
  ],
  floorCapacity: 8,
};

// Level 2 — two doors on one ring, two layers (outer red, inner blue).
// Player learns: doors on the same ring rotate together; each door peels its
// own color, and lower layers are revealed only after outer matches are gone.
const level2: LevelData = {
  id: 'l2-two-doors',
  name: 'Two Doors',
  spokes: 12,
  layers: 2,
  disk: [
    // Layer 0 (outer): all red
    'red', 'red', 'red', 'red', 'red', 'red',
    'red', 'red', 'red', 'red', 'red', 'red',
    // Layer 1 (inner): all blue
    'blue', 'blue', 'blue', 'blue', 'blue', 'blue',
    'blue', 'blue', 'blue', 'blue', 'blue', 'blue',
  ],
  rings: [
    {
      doors: [
        { angleDeg: 0, color: 'red' },
        { angleDeg: 180, color: 'blue' },
      ],
    },
  ],
  queue: [
    { color: 'red' }, { color: 'red' }, { color: 'blue' }, { color: 'blue' },
    { color: 'red' }, { color: 'red' }, { color: 'blue' }, { color: 'blue' },
  ],
  floorCapacity: 10,
};

// Level 3 — Lid Trap. 9 spokes × 3 layers. Most columns are clean
// (outer=red, mid=blue, inner=green) but three columns have a green LID
// blocking the red beneath. Player must use the green door first to peel
// those lids, then red, then blue exposes itself, then green draws inner.
// Two rings + three doors total — coordination puzzle.
const level3: LevelData = {
  id: 'l3-lid-trap',
  name: 'Lid Trap',
  spokes: 9,
  layers: 3,
  disk: [
    // Layer 0 (outer): 6 reds, 3 greens (greens are the lids)
    'red', 'red', 'red', 'red', 'red', 'red', 'green', 'green', 'green',
    // Layer 1 (mid): 6 blues, 3 reds (reds hide behind the lids)
    'blue', 'blue', 'blue', 'blue', 'blue', 'blue', 'red', 'red', 'red',
    // Layer 2 (inner): 6 greens, 3 blues
    'green', 'green', 'green', 'green', 'green', 'green', 'blue', 'blue', 'blue',
  ],
  rings: [
    // Inner ring carries the red and green doors.
    {
      doors: [
        { angleDeg: 0, color: 'red' },
        { angleDeg: 200, color: 'green' },
      ],
    },
    // Outer ring carries blue alone.
    {
      doors: [{ angleDeg: 90, color: 'blue' }],
    },
  ],
  queue: [
    { color: 'red' }, { color: 'green' }, { color: 'red' },
    { color: 'blue' }, { color: 'red' }, { color: 'green' },
    { color: 'blue' }, { color: 'green' }, { color: 'blue' },
  ],
  floorCapacity: 12,
};

export const BUILTIN_LEVELS: LevelData[] = [level1, level2, level3];
