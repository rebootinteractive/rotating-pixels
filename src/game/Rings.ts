import * as THREE from 'three';
import type { ColorKey } from '../shared/colors';
import { COLOR_HEX } from '../shared/colors';
import type { Disk } from './Disk';
import type { RingData } from '../shared/types';

interface Door {
  /** Static angular offset on the ring, radians. */
  offsetAngle: number;
  color: ColorKey;
  marker: THREE.Mesh;
  // Per-spoke timing state — re-keyed when door enters a new spoke
  currentSpoke: number;
  timeInSpoke: number;
  ticksFired: number;
  lidded: boolean;
}

export interface PullEvent {
  color: ColorKey;
  layer: number;
  spoke: number;
  worldPos: THREE.Vector3;
  mesh: THREE.Mesh;
  /** World direction the pulled ball should move in (door's outward direction). */
  ejectDir: THREE.Vector3;
}

export class Ring {
  readonly group = new THREE.Group();
  readonly index: number;
  readonly radius: number;
  readonly thickness: number;
  /** Continuous accumulated rotation, radians. CCW positive. */
  angle: number = 0;

  private doors: Door[];
  private torusMesh: THREE.Mesh;
  private torusGeometry: THREE.TorusGeometry;
  private torusMaterial: THREE.MeshStandardMaterial;
  private doorGeometry: THREE.SphereGeometry;

  constructor(index: number, radius: number, doorData: RingData['doors']) {
    this.index = index;
    this.radius = radius;
    this.thickness = 0.18;

    this.torusGeometry = new THREE.TorusGeometry(radius, this.thickness, 10, 64);
    this.torusMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a4f63,
      roughness: 0.4,
      metalness: 0.25,
    });
    this.torusMesh = new THREE.Mesh(this.torusGeometry, this.torusMaterial);
    // TorusGeometry default lies in XY plane already, perfect.
    this.group.add(this.torusMesh);

    // Doors as colored beads sitting on the ring, slightly outside.
    this.doorGeometry = new THREE.SphereGeometry(this.thickness * 1.65, 14, 10);
    this.doors = doorData.map((d) => {
      const offset = THREE.MathUtils.degToRad(d.angleDeg);
      const mat = new THREE.MeshStandardMaterial({
        color: COLOR_HEX[d.color],
        roughness: 0.4,
        metalness: 0.1,
        emissive: COLOR_HEX[d.color],
        emissiveIntensity: 0.25,
      });
      const mesh = new THREE.Mesh(this.doorGeometry, mat);
      mesh.position.set(Math.cos(offset) * radius, Math.sin(offset) * radius, 0);
      this.group.add(mesh);
      return {
        offsetAngle: offset,
        color: d.color,
        marker: mesh,
        currentSpoke: -1,
        timeInSpoke: 0,
        ticksFired: 0,
        lidded: false,
      };
    });
  }

  /** Apply the ring's accumulated angle to its group transform. */
  applyTransform(): void {
    this.group.rotation.z = this.angle;
  }

  /**
   * Update door extraction logic for `dt` seconds. Emits pull events
   * for any extractions that occurred this frame.
   */
  update(
    dt: number,
    disk: Disk,
    firstTickDelay: number,
    tickInterval: number,
    out: PullEvent[]
  ): void {
    const tau = Math.PI * 2;
    for (const door of this.doors) {
      // World angle of the door = ring.angle + door.offsetAngle
      const worldAngle = this.angle + door.offsetAngle;
      const spoke = disk.spokeAt(worldAngle);

      if (spoke !== door.currentSpoke) {
        door.currentSpoke = spoke;
        door.timeInSpoke = 0;
        door.ticksFired = 0;
        door.lidded = false;
        continue;
      }

      door.timeInSpoke += dt;

      // Fire as many ticks as fit into the elapsed time window.
      while (!door.lidded) {
        const nextTickAt = firstTickDelay + door.ticksFired * tickInterval;
        if (door.timeInSpoke < nextTickAt) break;

        const layer = disk.outermostInSpoke(spoke);
        if (layer === -1) {
          // Column drained — stop ticking.
          door.lidded = true;
          break;
        }

        const cellColor = disk.colorAt(layer, spoke);
        if (cellColor === door.color) {
          const result = disk.extract(layer, spoke);
          if (result) {
            // Eject direction: radially outward from disk center, through the door.
            const ejectAngle = worldAngle;
            const ejectDir = new THREE.Vector3(Math.cos(ejectAngle), Math.sin(ejectAngle), 0);
            out.push({
              color: result.color,
              layer,
              spoke,
              worldPos: result.worldPos,
              mesh: result.mesh,
              ejectDir,
            });
          }
          door.ticksFired++;
        } else {
          // Lid! Different-color pixel blocks further pulls in this dwell.
          door.lidded = true;
          break;
        }
      }

      // Keep door world angle within [0, 2π) is unnecessary — math wraps fine.
      void tau;
    }
  }

  dispose(): void {
    this.torusGeometry.dispose();
    this.torusMaterial.dispose();
    this.doorGeometry.dispose();
    for (const d of this.doors) {
      (d.marker.material as THREE.Material).dispose();
    }
    this.group.parent?.remove(this.group);
  }
}

/**
 * Manages all rings for a level + the input mapping for picking and rotating
 * a ring. Pointer geometry is in disk-local XY plane (z=0 worldspace).
 */
export class RingsManager {
  readonly group = new THREE.Group();
  private rings: Ring[];

  constructor(ringData: RingData[], diskHullRadius: number) {
    const ringSpacing = 0.75;
    const firstRingRadius = diskHullRadius + 0.5;
    this.rings = ringData.map((r, i) =>
      new Ring(i, firstRingRadius + i * ringSpacing, r.doors)
    );
    for (const r of this.rings) this.group.add(r.group);
  }

  /** Pick a ring by world-plane radius. Returns null if no ring within tolerance. */
  pickByRadius(radius: number): Ring | null {
    const tolerance = 0.6;
    let best: Ring | null = null;
    let bestDist = tolerance;
    for (const r of this.rings) {
      const d = Math.abs(radius - r.radius);
      if (d < bestDist) {
        best = r;
        bestDist = d;
      }
    }
    return best;
  }

  applyAllTransforms(): void {
    for (const r of this.rings) r.applyTransform();
  }

  update(
    dt: number,
    disk: Disk,
    firstTickDelay: number,
    tickInterval: number,
    out: PullEvent[]
  ): void {
    for (const r of this.rings) r.update(dt, disk, firstTickDelay, tickInterval, out);
  }

  dispose(): void {
    for (const r of this.rings) r.dispose();
    this.rings = [];
    this.group.parent?.remove(this.group);
  }
}
