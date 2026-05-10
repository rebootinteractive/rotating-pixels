import * as THREE from 'three';
import type { ColorKey } from '../shared/colors';
import { COLOR_HEX } from '../shared/colors';

/** Visual + state for the pixel-mosaic disk. */
export class Disk {
  readonly group = new THREE.Group();
  readonly spokes: number;
  readonly layers: number;

  // Geometry parameters
  readonly sphereRadius: number;
  /** Radius of the innermost layer's center circle. */
  readonly innerRadius: number;
  /** Radius of the outermost layer's center circle. */
  readonly outerRadius: number;
  /** Outer hull radius (beyond outermost layer's centers). */
  readonly hullRadius: number;

  // disk[layer * spokes + spoke] = ColorKey | null
  private cells: (ColorKey | null)[];

  // meshes[i] = mesh at the same index as cells[i] (or undefined if empty)
  private meshes: (THREE.Mesh | undefined)[];

  // Shared sphere geometry (read-only) — safe to share
  private static sharedGeometry: THREE.SphereGeometry | null = null;

  constructor(spokes: number, layers: number, cells: (ColorKey | null)[]) {
    if (cells.length !== spokes * layers) {
      throw new Error(`Disk cell count mismatch: expected ${spokes * layers}, got ${cells.length}`);
    }
    this.spokes = spokes;
    this.layers = layers;
    this.cells = cells.slice();
    this.meshes = new Array(cells.length);

    // Sphere sizing: pack along outermost layer. Each spoke gets 2π/spokes of arc.
    // Sphere radius = (outerRadius * π / spokes) * pack_factor.
    // Choose innerRadius so spheres on innermost layer also don't overlap.
    // If innermost has spokes=N spheres at radius r, neighbor distance ≈ 2 * r * sin(π/N).
    // For non-overlap: 2 * r * sin(π/N) >= 2 * sphereRadius → r >= sphereRadius / sin(π/N).
    const pack = 0.92;
    // We'll pick sphereRadius first, then derive radii.
    const sphereRadius = 0.42;
    const innerRadius = Math.max(0.7, sphereRadius / Math.sin(Math.PI / spokes)) * 1.0;
    const layerSpacing = sphereRadius * 2 * 1.04;
    const outerRadius = innerRadius + (layers - 1) * layerSpacing;

    this.sphereRadius = sphereRadius * pack;
    this.innerRadius = innerRadius;
    this.outerRadius = outerRadius;
    this.hullRadius = outerRadius + sphereRadius;

    if (!Disk.sharedGeometry) {
      Disk.sharedGeometry = new THREE.SphereGeometry(1, 18, 14);
    }

    // Build meshes. Layer 0 is the OUTERMOST layer (largest radius);
    // layer (layers-1) is the innermost. Door beams enter from outside,
    // so layer 0 must be the radially-largest one.
    for (let l = 0; l < layers; l++) {
      const r = outerRadius - l * layerSpacing;
      for (let s = 0; s < spokes; s++) {
        const idx = l * spokes + s;
        const color = this.cells[idx];
        if (color === null) continue;
        const mesh = this.makeSphereMesh(color);
        const angle = this.spokeAngle(s);
        mesh.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
        mesh.scale.setScalar(this.sphereRadius);
        mesh.userData.layer = l;
        mesh.userData.spoke = s;
        this.group.add(mesh);
        this.meshes[idx] = mesh;
      }
    }
  }

  /** Center angle for spoke index s, in radians. */
  spokeAngle(s: number): number {
    return (s / this.spokes) * Math.PI * 2;
  }

  /** Returns spoke index whose center is closest to the given angle (radians). */
  spokeAt(angleRad: number): number {
    const tau = Math.PI * 2;
    let a = ((angleRad % tau) + tau) % tau;
    return Math.round((a / tau) * this.spokes) % this.spokes;
  }

  /** World position of a (layer, spoke) cell. Layer 0 is outermost. */
  cellWorldPosition(layer: number, spoke: number, target: THREE.Vector3): THREE.Vector3 {
    const spacing = this.layers <= 1 ? 0 : (this.outerRadius - this.innerRadius) / (this.layers - 1);
    const r = this.outerRadius - layer * spacing;
    const a = this.spokeAngle(spoke);
    return target.set(Math.cos(a) * r, Math.sin(a) * r, 0);
  }

  /**
   * Find the outermost non-empty layer index in a spoke.
   * Returns -1 if column is empty.
   */
  outermostInSpoke(spoke: number): number {
    for (let l = 0; l < this.layers; l++) {
      const idx = l * this.spokes + spoke;
      if (this.cells[idx] !== null) return l;
    }
    return -1;
  }

  /** Color at a specific cell, or null. */
  colorAt(layer: number, spoke: number): ColorKey | null {
    return this.cells[layer * this.spokes + spoke];
  }

  /** Total non-null cells remaining. */
  remainingCount(): number {
    let n = 0;
    for (const c of this.cells) if (c !== null) n++;
    return n;
  }

  /**
   * Extract (remove) a single cell. Returns the color and world position
   * of the pixel that was removed, or null if the cell was already empty.
   * The mesh is detached from the disk group; caller decides what to do
   * with it (typically: hand to the falling-balls system).
   */
  extract(layer: number, spoke: number): { color: ColorKey; mesh: THREE.Mesh; worldPos: THREE.Vector3 } | null {
    const idx = layer * this.spokes + spoke;
    const color = this.cells[idx];
    const mesh = this.meshes[idx];
    if (!color || !mesh) return null;
    this.cells[idx] = null;
    this.meshes[idx] = undefined;
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    // Detach without destroying
    this.group.remove(mesh);
    return { color, mesh, worldPos };
  }

  /** Free all GPU resources allocated by this disk's meshes. */
  dispose(): void {
    for (const m of this.meshes) {
      if (!m) continue;
      (m.material as THREE.Material).dispose();
    }
    this.meshes = [];
    this.group.parent?.remove(this.group);
    // sharedGeometry is read-only — leave it for the page session
  }

  private makeSphereMesh(color: ColorKey): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR_HEX[color],
      roughness: 0.45,
      metalness: 0.05,
    });
    const mesh = new THREE.Mesh(Disk.sharedGeometry!, mat);
    mesh.userData.color = color;
    return mesh;
  }
}
