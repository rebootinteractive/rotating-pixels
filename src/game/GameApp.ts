import * as THREE from 'three';
import type { LevelData } from '../shared/types';
import { Disk } from './Disk';
import { Ring, RingsManager, type PullEvent } from './Rings';
import { FloorSystem } from './Floor';
import { Queue } from './Queue';
import { Hud } from './Hud';

export interface GameAppOptions {
  level: LevelData;
  onMenu: () => void;
  onRestart: () => void;
}

/** Time (seconds) before the FIRST pull on a spoke. Zero = pull on contact;
 *  this is what makes a fast flick still always peel the outer layer. */
const FIRST_TICK_DELAY = 0;
/** Time between successive pulls within the same dwell — gates layer 2, 3, ... */
const TICK_INTERVAL = 0.18;

export class GameApp {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private rafId = 0;
  private disposed = false;
  private lastTime = 0;

  private level: LevelData;
  private disk: Disk;
  private rings: RingsManager;
  private floor: FloorSystem;
  private queue: Queue;
  private hud: Hud;
  private resizeObserver: ResizeObserver;

  private raycaster = new THREE.Raycaster();
  private worldPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

  private grabState: {
    ring: Ring;
    startWorldAngle: number;
    startRingAngle: number;
    pointerId: number;
  } | null = null;

  private ended: 'win' | 'lose' | null = null;
  private cb: GameAppOptions;

  constructor(private parent: HTMLElement, opts: GameAppOptions) {
    this.cb = opts;
    this.level = opts.level;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x161924, 1);
    this.parent.appendChild(this.renderer.domElement);

    // Camera
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.scene.add(this.camera);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(3, 8, 6);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88a8ff, 0.4);
    rim.position.set(-4, 2, -3);
    this.scene.add(rim);

    // Build disk
    this.disk = new Disk(this.level.spokes, this.level.layers, this.level.disk);
    this.scene.add(this.disk.group);

    // Build rings
    this.rings = new RingsManager(this.level.rings, this.disk.hullRadius);
    this.scene.add(this.rings.group);

    // Layout floor + queue based on disk extent
    const outerRingExtent = this.computeOuterExtent();
    const floorGap = 0.7;
    const floorTopY = -(outerRingExtent + floorGap);
    const floorHeight = 3.6; // visual strip height
    const groundY = floorTopY - floorHeight;
    const floorHalfWidth = outerRingExtent + 0.4;
    this.floor = new FloorSystem({
      minX: -floorHalfWidth,
      maxX: floorHalfWidth,
      groundY,
      topY: floorTopY,
      ballRadius: this.disk.sphereRadius,
      capacity: this.level.floorCapacity,
    });
    this.scene.add(this.floor.group);

    // Queue
    const queueY = groundY - 2.0;
    const visibleCount = Math.min(4, this.level.queue.length);
    const slotWidth = (floorHalfWidth * 2) / Math.max(visibleCount, 1) * 0.92;
    const slotHeight = 1.8;
    const visibleSlotsForLayout = Math.max(visibleCount, 1);
    const totalQueueWidth = slotWidth * visibleSlotsForLayout;
    const leftAnchor = -totalQueueWidth / 2 + slotWidth / 2;
    this.queue = new Queue({
      containers: this.level.queue,
      visibleCount,
      slotWidth,
      slotHeight,
      leftAnchor,
      y: queueY,
    });
    this.scene.add(this.queue.group);

    // HUD
    this.hud = new Hud(this.parent, this.level.floorCapacity, {
      onMenu: () => this.cb.onMenu(),
      onRestart: () => this.cb.onRestart(),
    });

    // Camera fit & resize
    const sceneTop = outerRingExtent + 0.4;
    const sceneBottom = queueY - slotHeight / 2 - 0.6;
    const sceneWidth = (outerRingExtent + 0.6) * 2;
    this.fitCamera(sceneTop, sceneBottom, sceneWidth);

    this.resizeObserver = new ResizeObserver(() => this.handleResize(sceneTop, sceneBottom, sceneWidth));
    this.resizeObserver.observe(this.parent);
    this.handleResize(sceneTop, sceneBottom, sceneWidth);

    // Input
    this.attachInput();

    // Start loop
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private computeOuterExtent(): number {
    // Outer ring radius + thickness margin.
    // The RingsManager doesn't expose this directly; compute from level data.
    if (this.level.rings.length === 0) return this.disk.hullRadius;
    const ringSpacing = 0.75;
    const firstRingRadius = this.disk.hullRadius + 0.5;
    const lastRingRadius = firstRingRadius + (this.level.rings.length - 1) * ringSpacing;
    return lastRingRadius + 0.5;
  }

  private fitCamera(sceneTop: number, sceneBottom: number, sceneWidth: number): void {
    // Sets the look-at and distance such that the rectangle from
    // (-W/2, sceneBottom) to (W/2, sceneTop) fits in view with margin.
    const aspect = this.parent.clientWidth / Math.max(1, this.parent.clientHeight);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const margin = 0.8;
    const sceneHeight = sceneTop - sceneBottom + margin * 2;
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * aspect);
    const dV = sceneHeight / (2 * Math.tan(fovV / 2));
    const dH = (sceneWidth + margin * 2) / (2 * Math.tan(fovH / 2));
    const D = Math.max(dV, dH);

    const lookY = (sceneTop + sceneBottom) / 2;
    const tilt = THREE.MathUtils.degToRad(12);
    this.camera.position.set(0, lookY + D * Math.sin(tilt), D * Math.cos(tilt));
    this.camera.lookAt(0, lookY, 0);
  }

  private handleResize(top: number, bottom: number, width: number): void {
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.fitCamera(top, bottom, width);
  }

  // ---------- Input ----------

  private attachInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointercancel', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerUp);
  }

  private detachInput(): void {
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
  }

  private screenToWorldXY(clientX: number, clientY: number): THREE.Vector3 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const target = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.worldPlane, target)) return target;
    return null;
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.ended) return;
    const wp = this.screenToWorldXY(e.clientX, e.clientY);
    if (!wp) return;
    const r = Math.hypot(wp.x, wp.y);
    const ring = this.rings.pickByRadius(r);
    if (!ring) return;
    const startAngle = Math.atan2(wp.y, wp.x);
    this.grabState = {
      ring,
      startWorldAngle: startAngle,
      startRingAngle: ring.angle,
      pointerId: e.pointerId,
    };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.grabState) return;
    if (e.pointerId !== this.grabState.pointerId) return;
    const wp = this.screenToWorldXY(e.clientX, e.clientY);
    if (!wp) return;
    const newAngle = Math.atan2(wp.y, wp.x);
    let delta = newAngle - this.grabState.startWorldAngle;
    // Unwrap
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.grabState.ring.angle = this.grabState.startRingAngle + delta;
    this.grabState.ring.applyTransform();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.grabState && e.pointerId === this.grabState.pointerId) {
      this.grabState = null;
    }
  };

  // ---------- Loop ----------

  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    if (dt > 0.05) dt = 0.05; // cap to avoid big jumps after tab return
    this.lastTime = now;

    if (!this.ended) {
      // Ring extraction → pull events
      const pulls: PullEvent[] = [];
      this.rings.update(dt, this.disk, FIRST_TICK_DELAY, TICK_INTERVAL, pulls);
      // Hand pulled meshes to floor system
      for (const p of pulls) {
        this.floor.spawnBall({
          color: p.color,
          mesh: p.mesh,
          worldPos: p.worldPos,
          ejectDir: p.ejectDir,
        });
      }
      // Floor physics
      this.floor.update(dt);
      // Queue: leader pulls, fills, advances
      this.queue.update(dt, this.floor);

      // Update HUD floor counter
      this.hud.setFloor(this.floor.ballsInPlay());

      // Check end conditions
      if (this.floor.ballsInPlay() >= this.level.floorCapacity) {
        this.ended = 'lose';
        this.hud.showLose();
      } else if (this.disk.remainingCount() === 0 && this.queue.isCleared()) {
        this.ended = 'win';
        this.hud.showWin();
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.tick);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    this.detachInput();
    this.resizeObserver.disconnect();
    this.disk.dispose();
    this.rings.dispose();
    this.floor.dispose();
    this.queue.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
