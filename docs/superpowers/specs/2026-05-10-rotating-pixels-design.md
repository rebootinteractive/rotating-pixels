# RotatingPixels — v1 Design

*Approved 2026-05-10.*

## The 30-second version
A puzzle game where the player spins colored rings around a pixel-mosaic disk. Each ring has colored doors. Sweep a door across same-color pixels and they peel off **layer by layer**, fall as balls to a floor zone, and are pulled into a queue of containers — one container at a time. Clear the disk, clear the queue, win. Let the floor overflow, lose.

## Core mechanic

### The disk
A circular mosaic of colored sphere "pixels" packed into a disk shape. Each pixel has a color. Arrangement is hand-designed (or auto-distributed by the editor with designer parameters).

### The rings
Concentric rings rotate around the disk. A level can have any number of rings (1, 2, 3+), each with any number of colored **doors** attached.

### Input
Hold a ring with a finger, swipe to rotate. The direction of rotation is computed from the **cross product** of the grab-vector (finger position relative to disk center) and the swipe-vector. This means:
- Swipe left from below the center → CW
- Swipe left from above the center → CCW
- Swipe up from right of center → CCW
- Swipe up from left of center → CW

Rotation is **continuous, not snapped**. One ring at a time (no multi-touch).

### Door extraction
When a door's "beam" — a radial cone the width of one pixel — sweeps over a column of pixels, it begins extracting **outermost layer first**, with a small fixed delay (~150–200ms target) between successive pulls.

- The door must remain over the column long enough for each tick to fire.
- Fast rotation = only outer layer extracted (skill-flick).
- Slow rotation = whole matching column drained.
- A **non-matching color** in the column is a **lid**: the door stops there until something removes the lid.

### Pixel → ball physics
A pulled pixel becomes a physics-enabled sphere (gravity-bound) and falls toward the bottom of the screen. The visual is identical to the disk pixel — same sphere, same color — so there's no visible "transformation" moment.

## Bottom half — the closed economy

### The floor
A rectangular zone at the bottom of the screen where falling balls collect and rest. Balls in this zone are "available" for the leader container to pull.

### The container queue
A horizontal row of colored containers. Only the **leader** (front of queue) is active and pulls matching-color balls from the floor. Player sees the **leader + next 2–3** containers (preview).

- Each container holds exactly **3 balls** of its color.
- When a container fills, it's destroyed. The queue advances. The next container becomes the new leader.

### Win
- Every pixel extracted from the disk.
- Every container in the queue filled and cleared.
- Floor empty.

### Lose
- Floor reaches its **capacity** (designer-tunable ball count per level). Spill = fail.

### Zero-sum (exact)
Total pixels of color C in the disk = (containers of color C in queue) × 3. No leftovers. The editor enforces this automatically — the designer never sees a leftover ball.

## Visual

- Subtle 3D tilt (~10–15° from straight overhead).
- Disk and rings sit on a flat plane.
- Pulled balls have visible gravity arcs as they fall.
- 8-color palette: red, orange, yellow, green, cyan, blue, purple, pink.

## Level Editor (v1 scope)

- **Pick palette:** select which of the 8 colors are active for this level.
- **Per active color:**
  - Container count (each = 3 pixels worth of that color, automatically computed).
  - Clumpiness slider (0 = scattered lone wolves, 1 = single big patch).
  - Depth bias (outer / mixed / inner — controls radial position tendency).
- **Regenerate / lock seed:** randomized layout from current parameters; pin a seed when satisfied.
- **Manual swap:** click any pixel to recolor it; the editor swaps it with another pixel elsewhere of the target color, preserving zero-sum.
- **Rings & doors:** add/remove rings; place doors at chosen angles with chosen colors. Any count of either.
- **Queue order:** designer-defined sequence of containers the player will face.
- **Floor capacity:** designer-tunable per level.
- **Test play / Save / Download JSON / Copy JSON.**

## Starter levels

1. **Tutorial-trivial:** 1 ring, 1 door, 1 color. Player learns to spin and extract.
2. **Two-door coordination:** 1 ring, 2 doors of different colors. Player learns that aligning one door affects where the other lands.
3. **Lid + timing flicks:** layout requires both bypassing a lid and using fast rotation to skip non-intent extractions.

## Out of scope for v1

- Multi-touch (two rings rotated simultaneously).
- Audio.
- Conveyor between floor and queue (deliberately stripped from MarbleSort reference).
- Pre-set queue randomization (all queues are designer-authored sequences).
- Snap-to-angle rotation.
