import * as THREE from 'three';
import type { ColorKey } from '../shared/colors';
import { COLOR_HEX } from '../shared/colors';
import { angleToSpokeIndex } from '../shared/diskGeometry';
import type { Disk } from './Disk';
import type { RingData } from '../shared/types';

interface Door {
  /** Static angular offset on the ring, radians. */
  offsetAngle: number;
  color: ColorKey;
  marker: THREE.Mesh;
  // Per-spoke timing state — re-keyed when the door enters a new outer-layer spoke.
  currentOuterSpoke: number;
  timeInSpoke: number;
  ticksFired: number;
  lidded: boolean;
}

export interface PullEvent {
  color: ColorKey;
  layer: number;
  indexInLayer: number;
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
    this.group.add(this.torusMesh);

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
        currentOuterSpoke: -1,
        timeInSpoke: 0,
        ticksFired: 0,
        lidded: false,
      };
    });
  }

  applyTransform(): void {
    this.group.rotation.z = this.angle;
  }

  update(
    dt: number,
    disk: Disk,
    firstTickDelay: number,
    tickInterval: number,
    out: PullEvent[]
  ): void {
    for (const door of this.doors) {
      const worldAngle = this.angle + door.offsetAngle;

      // Track door dwell against the OUTER layer's spoke (the visually-meaningful unit).
      const outerN = disk.spokesAtLayer(0);
      const outerSpoke = outerN > 0 ? angleToSpokeIndex(worldAngle, outerN) : 0;

      if (outerSpoke !== door.currentOuterSpoke) {
        door.currentOuterSpoke = outerSpoke;
        door.timeInSpoke = 0;
        door.ticksFired = 0;
        door.lidded = false;
        // Don't continue — fall through so the FIRST pull on this spoke
        // fires this same frame. Subsequent pulls remain time-gated below.
      }

      door.timeInSpoke += dt;

      while (!door.lidded) {
        const nextTickAt = firstTickDelay + door.ticksFired * tickInterval;
        if (door.timeInSpoke < nextTickAt) break;

        const found = disk.findOutermostAtAngle(worldAngle);
        if (!found) {
          door.lidded = true;
          break;
        }

        if (found.color === door.color) {
          const result = disk.extract(found.layer, found.indexInLayer);
          if (result) {
            // Spawn the ball at the door's outer position so it doesn't visually
            // clip through the ring on its way out.
            const cosA = Math.cos(worldAngle);
            const sinA = Math.sin(worldAngle);
            const spawnPos = new THREE.Vector3(
              cosA * (this.radius + this.thickness * 1.4),
              sinA * (this.radius + this.thickness * 1.4),
              0
            );
            const ejectDir = new THREE.Vector3(cosA, sinA, 0);
            out.push({
              color: result.color,
              layer: found.layer,
              indexInLayer: found.indexInLayer,
              worldPos: spawnPos,
              mesh: result.mesh,
              ejectDir,
            });
          }
          door.ticksFired++;
        } else {
          // Lid: outermost-non-empty was a different color. Stop until door moves.
          door.lidded = true;
          break;
        }
      }
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
 * Manages all rings for a level + ring-picking by world-plane radius.
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
