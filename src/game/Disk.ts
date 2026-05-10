import * as THREE from 'three';
import type { ColorKey } from '../shared/colors';
import { COLOR_HEX } from '../shared/colors';
import {
  SPHERE_RADIUS,
  angleToSpokeIndex,
  diskHullRadius,
  layerRadius,
  spokeAngle,
  spokesPerLayer,
} from '../shared/diskGeometry';

/** Visual + state for the pixel-mosaic disk. */
export class Disk {
  readonly group = new THREE.Group();
  readonly outerSpokes: number;
  readonly layers: number;
  readonly sphereRadius: number;
  readonly hullRadius: number;

  /** Per-layer mutable cell colors. cells[layer][indexInLayer] = ColorKey | null. */
  private cells: (ColorKey | null)[][];
  /** Mirror of cells with mesh references. meshes[layer][index] may be undefined. */
  private meshes: (THREE.Mesh | undefined)[][];
  /** Layer's spoke counts cached. */
  private layerSpokes: number[];

  private static sharedGeometry: THREE.SphereGeometry | null = null;

  constructor(outerSpokes: number, layers: number, disk: (ColorKey | null)[][]) {
    this.outerSpokes = outerSpokes;
    this.layers = layers;
    this.sphereRadius = SPHERE_RADIUS * 0.96;
    this.hullRadius = diskHullRadius(outerSpokes);

    this.layerSpokes = [];
    for (let L = 0; L < layers; L++) this.layerSpokes.push(spokesPerLayer(outerSpokes, L));

    if (!Disk.sharedGeometry) {
      Disk.sharedGeometry = new THREE.SphereGeometry(1, 18, 14);
    }

    // Validate input shape and copy.
    this.cells = [];
    this.meshes = [];
    for (let L = 0; L < layers; L++) {
      const N = this.layerSpokes[L];
      const layerCells = disk[L] ?? [];
      const row: (ColorKey | null)[] = [];
      const meshRow: (THREE.Mesh | undefined)[] = [];
      for (let s = 0; s < N; s++) {
        const c = layerCells[s] ?? null;
        row.push(c);
        meshRow.push(undefined);
      }
      this.cells.push(row);
      this.meshes.push(meshRow);
    }

    // Build meshes
    for (let L = 0; L < layers; L++) {
      const N = this.layerSpokes[L];
      if (N <= 0) continue;
      const r = layerRadius(outerSpokes, L);
      for (let s = 0; s < N; s++) {
        const color = this.cells[L][s];
        if (color === null) continue;
        const a = spokeAngle(L, s, N);
        const mesh = this.makeSphereMesh(color);
        mesh.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
        mesh.scale.setScalar(this.sphereRadius);
        mesh.userData.layer = L;
        mesh.userData.indexInLayer = s;
        this.group.add(mesh);
        this.meshes[L][s] = mesh;
      }
    }
  }

  /**
   * Find the outermost non-empty pixel along the given world angle,
   * across all layers (closest-spoke per layer).
   */
  findOutermostAtAngle(angleRad: number): { layer: number; indexInLayer: number; color: ColorKey } | null {
    for (let L = 0; L < this.layers; L++) {
      const N = this.layerSpokes[L];
      if (N <= 0) continue;
      const i = angleToSpokeIndex(angleRad - spokeAngle(L, 0, N), N);
      const color = this.cells[L][i];
      if (color !== null) return { layer: L, indexInLayer: i, color };
    }
    return null;
  }

  /** Total non-null cells remaining. */
  remainingCount(): number {
    let n = 0;
    for (const row of this.cells) for (const c of row) if (c !== null) n++;
    return n;
  }

  /**
   * Extract (remove) a single cell by (layer, indexInLayer). Returns the
   * pulled mesh (detached from disk group) along with the color and world
   * position, or null if the cell was already empty.
   */
  extract(layer: number, indexInLayer: number): { color: ColorKey; mesh: THREE.Mesh; worldPos: THREE.Vector3 } | null {
    if (layer < 0 || layer >= this.layers) return null;
    const N = this.layerSpokes[layer];
    if (indexInLayer < 0 || indexInLayer >= N) return null;
    const color = this.cells[layer][indexInLayer];
    const mesh = this.meshes[layer][indexInLayer];
    if (!color || !mesh) return null;
    this.cells[layer][indexInLayer] = null;
    this.meshes[layer][indexInLayer] = undefined;
    const worldPos = new THREE.Vector3();
    mesh.getWorldPosition(worldPos);
    this.group.remove(mesh);
    return { color, mesh, worldPos };
  }

  /** Number of slots in a layer. */
  spokesAtLayer(layer: number): number {
    return this.layerSpokes[layer] ?? 0;
  }

  dispose(): void {
    for (const row of this.meshes) {
      for (const m of row) {
        if (!m) continue;
        (m.material as THREE.Material).dispose();
      }
    }
    this.meshes = [];
    this.group.parent?.remove(this.group);
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
