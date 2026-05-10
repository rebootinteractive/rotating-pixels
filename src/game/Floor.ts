import * as THREE from 'three';
import type { ColorKey } from '../shared/colors';
import { COLOR_HEX } from '../shared/colors';

type BallState = 'falling' | 'settled' | 'pulled';

export interface Ball {
  color: ColorKey;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
  state: BallState;
  /** Set when state === 'pulled'. */
  pullTarget?: THREE.Vector3;
  pullDuration?: number;
  pullElapsed?: number;
}

/**
 * Manages every ball that has been pulled out of the disk.
 * Balls fall under gravity, collect in the floor strip, and can be
 * "pulled" by the queue's leader container.
 */
export class FloorSystem {
  readonly group = new THREE.Group();
  readonly minX: number;
  readonly maxX: number;
  /** Balls rest on this y-line (their center y when sitting on the ground). */
  readonly groundY: number;
  /** Top edge of the floor zone — for visual rendering only. */
  readonly topY: number;
  readonly ballRadius: number;
  readonly capacity: number;

  private balls: Ball[] = [];
  private gravity = new THREE.Vector3(0, -22, 0);
  private floorMesh: THREE.Mesh;
  private floorGeometry: THREE.PlaneGeometry;
  private floorMaterial: THREE.MeshStandardMaterial;
  private wallMeshes: THREE.Mesh[] = [];

  constructor(opts: {
    minX: number;
    maxX: number;
    groundY: number;
    topY: number;
    ballRadius: number;
    capacity: number;
  }) {
    this.minX = opts.minX;
    this.maxX = opts.maxX;
    this.groundY = opts.groundY;
    this.topY = opts.topY;
    this.ballRadius = opts.ballRadius;
    this.capacity = opts.capacity;

    // Visual floor — a soft tray.
    const w = this.maxX - this.minX;
    const h = this.topY - (this.groundY - this.ballRadius);
    this.floorGeometry = new THREE.PlaneGeometry(w, h);
    this.floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a1d28,
      roughness: 0.85,
      metalness: 0,
    });
    this.floorMesh = new THREE.Mesh(this.floorGeometry, this.floorMaterial);
    this.floorMesh.position.set((this.minX + this.maxX) / 2, (this.groundY - this.ballRadius + this.topY) / 2, -0.4);
    this.group.add(this.floorMesh);

    // Side walls so the tray reads as a tray (slim vertical bars).
    for (const x of [this.minX, this.maxX]) {
      const wallGeo = new THREE.BoxGeometry(0.12, h, 0.6);
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0x2c3245,
        roughness: 0.6,
      });
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(x, this.floorMesh.position.y, 0);
      this.group.add(wall);
      this.wallMeshes.push(wall);
    }
  }

  /**
   * Add a fresh ball to the world. Initial position + outward velocity
   * make it pop out of the door before gravity takes over.
   */
  spawnBall(opts: {
    color: ColorKey;
    mesh: THREE.Mesh;
    worldPos: THREE.Vector3;
    ejectDir: THREE.Vector3;
  }): void {
    const ejectSpeed = 4.5;
    const v = opts.ejectDir.clone().multiplyScalar(ejectSpeed);
    // Add a tiny upward kick so the arc looks lively.
    v.y += 1.5;
    const ball: Ball = {
      color: opts.color,
      position: opts.worldPos.clone(),
      velocity: v,
      mesh: opts.mesh,
      state: 'falling',
    };
    // The mesh comes from the disk — re-parent it under the floor group so
    // its world transform persists but it now lives in this system.
    opts.mesh.position.copy(opts.worldPos);
    this.group.add(opts.mesh);
    this.balls.push(ball);
  }

  /** Total balls counting toward the capacity (falling + settled, not pulled). */
  ballsInPlay(): number {
    let n = 0;
    for (const b of this.balls) if (b.state !== 'pulled') n++;
    return n;
  }

  /** All settled balls of a given color (in arrival order). */
  settledOfColor(color: ColorKey): Ball[] {
    return this.balls.filter((b) => b.state === 'settled' && b.color === color);
  }

  /** Mark a settled ball as being pulled toward a target. */
  startPull(ball: Ball, target: THREE.Vector3, durationSec: number): void {
    ball.state = 'pulled';
    ball.pullTarget = target.clone();
    ball.pullDuration = durationSec;
    ball.pullElapsed = 0;
  }

  /** Returns balls that completed their pull this frame. They are removed from the floor. */
  consumeCompletedPulls(): Ball[] {
    const done = this.balls.filter((b) => b.state === 'pulled' && (b.pullElapsed ?? 0) >= (b.pullDuration ?? 0));
    if (done.length > 0) {
      this.balls = this.balls.filter((b) => !done.includes(b));
      for (const b of done) {
        this.group.remove(b.mesh);
        // Geometry is shared (Disk.sharedGeometry) — leave it. Dispose the per-ball material.
        (b.mesh.material as THREE.Material).dispose();
      }
    }
    return done;
  }

  update(dt: number): void {
    // Phase 1: integrate non-pulled balls.
    for (const b of this.balls) {
      if (b.state === 'pulled') {
        b.pullElapsed = (b.pullElapsed ?? 0) + dt;
        const t = Math.min(1, (b.pullElapsed ?? 0) / Math.max(0.001, b.pullDuration ?? 0.4));
        // Ease-in toward target.
        const easeT = t * t * (3 - 2 * t);
        const target = b.pullTarget!;
        b.mesh.position.lerpVectors(b.position, target, easeT);
        if (t >= 1) {
          b.position.copy(target);
        }
        continue;
      }
      // Gravity
      b.velocity.addScaledVector(this.gravity, dt);
      // Position
      b.position.addScaledVector(b.velocity, dt);
    }

    // Phase 2: collision iterations.
    const iters = 4;
    for (let it = 0; it < iters; it++) this.resolveCollisions();

    // Phase 3: settle test (low velocity + on ground).
    for (const b of this.balls) {
      if (b.state === 'falling') {
        const onGround = b.position.y <= this.groundY + this.ballRadius + 0.001;
        const slow = Math.abs(b.velocity.y) < 1.2;
        if (onGround && slow) b.state = 'settled';
      }
      // Light damping for settled balls so the pile doesn't jiggle forever
      if (b.state === 'settled') {
        b.velocity.x *= 0.7;
        b.velocity.y *= 0.5;
      }
    }

    // Phase 4: sync mesh positions for non-pulled balls.
    for (const b of this.balls) {
      if (b.state !== 'pulled') b.mesh.position.copy(b.position);
    }
  }

  private resolveCollisions(): void {
    const r = this.ballRadius;
    const minD = r * 2;
    const minD2 = minD * minD;

    // Ball-ball
    for (let i = 0; i < this.balls.length; i++) {
      const a = this.balls[i];
      if (a.state === 'pulled') continue;
      for (let j = i + 1; j < this.balls.length; j++) {
        const b = this.balls[j];
        if (b.state === 'pulled') continue;
        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD2 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const overlap = (minD - d) * 0.5;
          const nx = dx / d;
          const ny = dy / d;
          a.position.x -= nx * overlap;
          a.position.y -= ny * overlap;
          b.position.x += nx * overlap;
          b.position.y += ny * overlap;
          // Velocity damping along normal — no full bounce, so the pile feels heavy.
          const av = a.velocity.x * nx + a.velocity.y * ny;
          const bv = b.velocity.x * nx + b.velocity.y * ny;
          const rel = av - bv;
          if (rel > 0) {
            const restitution = 0.05;
            const impulse = (1 + restitution) * rel * 0.5;
            a.velocity.x -= nx * impulse;
            a.velocity.y -= ny * impulse;
            b.velocity.x += nx * impulse;
            b.velocity.y += ny * impulse;
          }
        }
      }
    }

    // Ground + walls
    for (const b of this.balls) {
      if (b.state === 'pulled') continue;
      if (b.position.y < this.groundY + r) {
        b.position.y = this.groundY + r;
        if (b.velocity.y < 0) b.velocity.y = -b.velocity.y * 0.18;
      }
      if (b.position.x < this.minX + r) {
        b.position.x = this.minX + r;
        if (b.velocity.x < 0) b.velocity.x = -b.velocity.x * 0.4;
      }
      if (b.position.x > this.maxX - r) {
        b.position.x = this.maxX - r;
        if (b.velocity.x > 0) b.velocity.x = -b.velocity.x * 0.4;
      }
    }
  }

  dispose(): void {
    for (const b of this.balls) {
      (b.mesh.material as THREE.Material).dispose();
    }
    this.balls = [];
    this.floorGeometry.dispose();
    this.floorMaterial.dispose();
    for (const w of this.wallMeshes) {
      w.geometry.dispose();
      (w.material as THREE.Material).dispose();
    }
    this.wallMeshes = [];
    this.group.parent?.remove(this.group);
  }
}
