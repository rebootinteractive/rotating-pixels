import * as THREE from 'three';
import type { ContainerData } from '../shared/types';
import { CONTAINER_SLOTS } from '../shared/types';
import { COLOR_HEX } from '../shared/colors';
import type { FloorSystem, Ball } from './Floor';

interface ContainerVisual {
  data: ContainerData;
  fill: number;
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  pips: THREE.Mesh[];
  pipMats: THREE.MeshStandardMaterial[];
  basePos: THREE.Vector3;
  popping: boolean;
  popElapsed: number;
}

export class Queue {
  readonly group = new THREE.Group();
  /** Containers currently visible (leader + next N). */
  readonly visibleCount: number;
  private containers: ContainerData[];
  private visuals: ContainerVisual[] = [];
  private slotWidth: number;
  private slotHeight: number;
  private leftAnchor: number;
  private y: number;
  private bodyGeometry: THREE.BoxGeometry;
  private pipGeometry: THREE.SphereGeometry;
  private activePull: Ball | null = null;

  constructor(opts: {
    containers: ContainerData[];
    visibleCount: number;
    slotWidth: number;
    slotHeight: number;
    leftAnchor: number;
    y: number;
  }) {
    this.containers = opts.containers.slice();
    this.visibleCount = opts.visibleCount;
    this.slotWidth = opts.slotWidth;
    this.slotHeight = opts.slotHeight;
    this.leftAnchor = opts.leftAnchor;
    this.y = opts.y;

    this.bodyGeometry = new THREE.BoxGeometry(this.slotWidth * 0.85, this.slotHeight * 0.7, 0.6);
    this.pipGeometry = new THREE.SphereGeometry(0.2, 12, 8);

    this.rebuildVisuals();
  }

  /** True when every container has been filled and removed. */
  isCleared(): boolean {
    return this.containers.length === 0 && this.visuals.length === 0;
  }

  /** Active leader, or null if queue empty. */
  leader(): ContainerData | null {
    return this.containers[0] ?? null;
  }

  /** World-space pull point for the current leader (the floor of the cup). */
  leaderPullTarget(target: THREE.Vector3): THREE.Vector3 | null {
    if (this.visuals.length === 0) return null;
    const v = this.visuals[0];
    return target.set(v.basePos.x, v.basePos.y, v.basePos.z);
  }

  update(dt: number, floor: FloorSystem): void {
    // Tick pop animations
    for (const v of this.visuals) {
      if (v.popping) {
        v.popElapsed += dt;
        const t = Math.min(1, v.popElapsed / 0.32);
        const scale = 1 + t * 0.5;
        v.group.scale.set(scale, scale, scale);
        v.bodyMat.opacity = 1 - t;
        v.bodyMat.transparent = true;
        for (const m of v.pipMats) {
          m.opacity = 1 - t;
          m.transparent = true;
        }
      }
    }
    // Remove finished pops.
    let popped = false;
    for (let i = this.visuals.length - 1; i >= 0; i--) {
      const v = this.visuals[i];
      if (v.popping && v.popElapsed >= 0.32) {
        this.disposeVisual(v);
        this.visuals.splice(i, 1);
        popped = true;
      }
    }
    if (popped) this.shiftVisualsLeft();

    // Active pull tracking — release the slot when the ball is consumed.
    if (this.activePull) {
      const stillThere = (this.activePull.pullElapsed ?? 0) < (this.activePull.pullDuration ?? 1);
      if (!stillThere) this.activePull = null;
    }

    // Consume completed pulls — the floor returns balls whose pullElapsed >= pullDuration
    const completed = floor.consumeCompletedPulls();
    for (const _ of completed) {
      if (this.containers.length === 0 || this.visuals.length === 0) break;
      const v = this.visuals[0];
      if (v.popping) continue;
      v.fill++;
      // Light up next pip
      const idx = v.fill - 1;
      if (idx >= 0 && idx < v.pipMats.length) {
        v.pipMats[idx].emissiveIntensity = 0.9;
        v.pipMats[idx].color.set(0xffffff);
      }
      if (v.fill >= CONTAINER_SLOTS) {
        // Pop the leader.
        v.popping = true;
        v.popElapsed = 0;
        this.containers.shift();
      }
    }

    // Start a new pull if leader is alive and idle and a matching ball is on the floor.
    if (
      !this.activePull &&
      this.visuals.length > 0 &&
      !this.visuals[0].popping &&
      this.containers.length > 0
    ) {
      const leaderColor = this.containers[0].color;
      const candidates = floor.settledOfColor(leaderColor);
      if (candidates.length > 0) {
        const target = new THREE.Vector3();
        this.leaderPullTarget(target);
        const ball = candidates[0];
        floor.startPull(ball, target, 0.32);
        this.activePull = ball;
      }
    }
  }

  private shiftVisualsLeft(): void {
    // Animate remaining visuals to slide left to the next slot.
    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i];
      const targetX = this.leftAnchor + i * this.slotWidth;
      v.basePos.x = targetX;
      v.group.position.x = targetX;
    }
    // Bring in a new visual on the right if there are more containers behind the visible window.
    while (this.visuals.length < this.visibleCount && this.containers.length > this.visuals.length) {
      const data = this.containers[this.visuals.length];
      const idx = this.visuals.length;
      const visual = this.makeVisual(data, idx);
      visual.body.scale.setScalar(0.01);
      this.visuals.push(visual);
      this.group.add(visual.group);
      // simple "pop in" — ramp scale to 1 over a few frames
      const start = performance.now();
      const animate = () => {
        const t = Math.min(1, (performance.now() - start) / 200);
        const ease = t * (2 - t);
        visual.group.scale.setScalar(0.01 + 0.99 * ease);
        if (t < 1) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }
  }

  private rebuildVisuals(): void {
    for (const v of this.visuals) this.disposeVisual(v);
    this.visuals = [];
    const slotsToShow = Math.min(this.visibleCount, this.containers.length);
    for (let i = 0; i < slotsToShow; i++) {
      const v = this.makeVisual(this.containers[i], i);
      this.visuals.push(v);
      this.group.add(v.group);
    }
  }

  private makeVisual(data: ContainerData, slotIdx: number): ContainerVisual {
    const g = new THREE.Group();
    const x = this.leftAnchor + slotIdx * this.slotWidth;
    g.position.set(x, this.y, 0);

    const isLeader = slotIdx === 0;
    const baseColor = COLOR_HEX[data.color];
    const bodyMat = new THREE.MeshStandardMaterial({
      color: baseColor,
      roughness: 0.45,
      metalness: 0.1,
      emissive: isLeader ? baseColor : 0x000000,
      emissiveIntensity: isLeader ? 0.18 : 0,
    });
    const body = new THREE.Mesh(this.bodyGeometry, bodyMat);
    body.position.y = -0.1;
    g.add(body);

    // Three pip dots above the body, dim until filled.
    const pips: THREE.Mesh[] = [];
    const pipMats: THREE.MeshStandardMaterial[] = [];
    const pipSpacing = this.slotWidth * 0.21;
    const pipsBaseX = -pipSpacing;
    const pipY = this.slotHeight * 0.42;
    for (let i = 0; i < CONTAINER_SLOTS; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x363b4d,
        roughness: 0.6,
        emissive: 0x000000,
        emissiveIntensity: 0,
      });
      const pip = new THREE.Mesh(this.pipGeometry, mat);
      pip.position.set(pipsBaseX + i * pipSpacing, pipY, 0.4);
      g.add(pip);
      pips.push(pip);
      pipMats.push(mat);
    }

    return {
      data,
      fill: 0,
      group: g,
      body,
      bodyMat,
      pips,
      pipMats,
      basePos: g.position.clone(),
      popping: false,
      popElapsed: 0,
    };
  }

  private disposeVisual(v: ContainerVisual): void {
    v.bodyMat.dispose();
    for (const m of v.pipMats) m.dispose();
    this.group.remove(v.group);
  }

  dispose(): void {
    for (const v of this.visuals) this.disposeVisual(v);
    this.visuals = [];
    this.bodyGeometry.dispose();
    this.pipGeometry.dispose();
    this.group.parent?.remove(this.group);
  }
}
