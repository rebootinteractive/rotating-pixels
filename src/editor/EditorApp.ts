import * as THREE from 'three';
import type { ColorKey } from '../shared/colors';
import { COLOR_HEX, COLOR_HEX_STR, COLOR_KEYS } from '../shared/colors';
import type {
  ContainerData,
  DepthBias,
  EditorParams,
  LevelData,
  PerColorParams,
  RingData,
} from '../shared/types';
import { CONTAINER_SLOTS } from '../shared/types';
import { generateDisk, totalPixelsFromParams } from '../shared/diskGen';
import { maxLayersFor, spokesPerLayer, totalCellsFor } from '../shared/diskGeometry';
import { Disk } from '../game/Disk';
import { RingsManager } from '../game/Rings';
import { saveCustomLevel } from '../ui/storage';

export interface EditorCallbacks {
  initial?: LevelData;
  onExit: () => void;
  onTestPlay: (level: LevelData) => void;
}

const DEFAULTS = {
  outerSpokes: 18,
  layers: 3,
  floorCapacity: 12,
};

interface EditorState {
  id: string;
  name: string;
  outerSpokes: number;
  layers: number;
  floorCapacity: number;
  disk: (ColorKey | null)[][];
  rings: RingData[];
  queue: ContainerData[];
  params: EditorParams;
  /** The most recent palette color the designer picked — used for new doors / containers / pixel swaps. */
  activeColor: ColorKey;
  /** Currently focused ring (for door operations). */
  selectedRing: number;
}

export class EditorApp {
  private parent: HTMLElement;
  private cb: EditorCallbacks;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rafId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  private disk: Disk | null = null;
  private ringsMgr: RingsManager | null = null;
  private queueGroup: THREE.Group;
  private floorOutline: THREE.LineSegments | null = null;

  private root: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private statusFadeId: number | undefined;
  private panelEl: HTMLDivElement;

  private state: EditorState;
  private raycaster = new THREE.Raycaster();

  constructor(parent: HTMLElement, cb: EditorCallbacks) {
    this.parent = parent;
    this.cb = cb;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x161924, 1);
    this.parent.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.scene.add(this.camera);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(3, 8, 6);
    this.scene.add(key);

    this.queueGroup = new THREE.Group();
    this.scene.add(this.queueGroup);

    // Initial state
    this.state = this.loadInitial(cb.initial);

    // UI
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.parent.appendChild(this.root);

    const topBar = this.buildTopBar();
    this.root.appendChild(topBar);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'editor-status';
    this.statusEl.textContent = 'Tap a pixel to swap it. Tap the disk’s ring zone to add/remove a door.';
    this.root.appendChild(this.statusEl);

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'editor-bottom';
    this.panelEl.style.flexDirection = 'column';
    this.panelEl.style.alignItems = 'stretch';
    this.panelEl.style.maxHeight = '52%';
    this.panelEl.style.overflowY = 'auto';
    this.root.appendChild(this.panelEl);

    // Build the scene visuals from initial state
    this.rebuildScene();
    this.renderPanel();

    // Resize + camera
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.parent);
    this.handleResize();

    // Pointer
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);

    // Tick (just renders; no game logic)
    const loop = () => {
      if (this.disposed) return;
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  // ---------- Initial state ----------

  private loadInitial(initial: LevelData | undefined): EditorState {
    if (initial) {
      const params: EditorParams = initial.editorParams ?? this.deriveParamsFromLevel(initial);
      return {
        id: initial.id,
        name: initial.name,
        outerSpokes: initial.outerSpokes,
        layers: initial.layers,
        floorCapacity: initial.floorCapacity,
        disk: initial.disk.map((row) => row.slice()),
        rings: initial.rings.map((r) => ({ doors: r.doors.map((d) => ({ ...d })) })),
        queue: initial.queue.map((c) => ({ ...c })),
        params,
        activeColor: (Object.keys(params.perColor)[0] as ColorKey) || 'red',
        selectedRing: 0,
      };
    }
    // Fresh starter — small disk with red+blue, two rings, simple queue.
    const params: EditorParams = {
      seed: Math.floor(Math.random() * 1e9),
      perColor: {
        red: { containers: 2, clumpiness: 0.7, depthBias: 'outer' },
        blue: { containers: 2, clumpiness: 0.7, depthBias: 'inner' },
      },
    };
    const disk = generateDisk(DEFAULTS.outerSpokes, DEFAULTS.layers, params);
    return {
      id: `custom-${Date.now()}`,
      name: 'Untitled Level',
      outerSpokes: DEFAULTS.outerSpokes,
      layers: DEFAULTS.layers,
      floorCapacity: DEFAULTS.floorCapacity,
      disk,
      rings: [{ doors: [{ angleDeg: 0, color: 'red' }] }, { doors: [{ angleDeg: 90, color: 'blue' }] }],
      queue: [
        { color: 'red' }, { color: 'red' }, { color: 'blue' }, { color: 'blue' },
      ],
      params,
      activeColor: 'red',
      selectedRing: 0,
    };
  }

  private deriveParamsFromLevel(level: LevelData): EditorParams {
    // For built-in/imported levels without saved params, seed from disk counts.
    const counts = new Map<ColorKey, number>();
    for (const row of level.disk) {
      for (const c of row) if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const perColor: EditorParams['perColor'] = {};
    for (const [c, n] of counts) {
      perColor[c] = {
        containers: Math.max(1, Math.round(n / CONTAINER_SLOTS)),
        clumpiness: 0.6,
        depthBias: 'mixed',
      };
    }
    return { seed: 1, perColor };
  }

  // ---------- Scene rebuild ----------

  private rebuildScene(): void {
    // Disk
    if (this.disk) {
      this.disk.dispose();
      this.disk = null;
    }
    this.disk = new Disk(this.state.outerSpokes, this.state.layers, this.state.disk);
    this.scene.add(this.disk.group);

    // Rings
    if (this.ringsMgr) {
      this.ringsMgr.dispose();
      this.ringsMgr = null;
    }
    this.ringsMgr = new RingsManager(this.state.rings, this.disk.hullRadius);
    this.scene.add(this.ringsMgr.group);

    // Queue (static visual)
    while (this.queueGroup.children.length) {
      const c = this.queueGroup.children[0];
      this.queueGroup.remove(c);
      const m = c as THREE.Mesh;
      if (m.geometry?.dispose) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose?.();
    }
    this.layoutQueueVisual();

    // Floor outline
    if (this.floorOutline) {
      this.scene.remove(this.floorOutline);
      this.floorOutline.geometry.dispose();
      (this.floorOutline.material as THREE.Material).dispose();
      this.floorOutline = null;
    }
    this.layoutFloorOutline();

    // Camera fit
    this.handleResize();
  }

  private layoutQueueVisual(): void {
    if (!this.disk) return;
    const outer = this.computeOuterExtent();
    const groundY = -(outer + 0.7) - 3.6;
    const queueY = groundY - 2.0;
    const halfW = outer + 0.4;
    const visibleCount = Math.min(4, this.state.queue.length);
    const slotWidth = (halfW * 2) / Math.max(visibleCount, 1) * 0.92;
    const totalW = slotWidth * Math.max(visibleCount, 1);
    const leftX = -totalW / 2 + slotWidth / 2;

    const visible = this.state.queue.slice(0, visibleCount);
    visible.forEach((c, i) => {
      const geo = new THREE.BoxGeometry(slotWidth * 0.85, 1.4, 0.6);
      const mat = new THREE.MeshStandardMaterial({
        color: COLOR_HEX[c.color],
        roughness: 0.45,
        metalness: 0.05,
        emissive: i === 0 ? COLOR_HEX[c.color] : 0x000000,
        emissiveIntensity: i === 0 ? 0.2 : 0,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(leftX + i * slotWidth, queueY, 0);
      this.queueGroup.add(m);
    });
  }

  private layoutFloorOutline(): void {
    if (!this.disk) return;
    const outer = this.computeOuterExtent();
    const halfW = outer + 0.4;
    const topY = -(outer + 0.7);
    const bottomY = topY - 3.6;
    const pts = [
      new THREE.Vector3(-halfW, topY, 0), new THREE.Vector3(halfW, topY, 0),
      new THREE.Vector3(halfW, topY, 0), new THREE.Vector3(halfW, bottomY, 0),
      new THREE.Vector3(halfW, bottomY, 0), new THREE.Vector3(-halfW, bottomY, 0),
      new THREE.Vector3(-halfW, bottomY, 0), new THREE.Vector3(-halfW, topY, 0),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x4a4f63 });
    this.floorOutline = new THREE.LineSegments(geo, mat);
    this.scene.add(this.floorOutline);
  }

  private computeOuterExtent(): number {
    if (!this.disk) return 5;
    if (this.state.rings.length === 0) return this.disk.hullRadius;
    const ringSpacing = 0.75;
    const firstRingRadius = this.disk.hullRadius + 0.5;
    const lastRingRadius = firstRingRadius + (this.state.rings.length - 1) * ringSpacing;
    return lastRingRadius + 0.5;
  }

  private handleResize(): void {
    const w = this.parent.clientWidth;
    const h = this.parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const outer = this.computeOuterExtent();
    const sceneTop = outer + 0.4;
    const sceneBottom = -(outer + 0.7) - 3.6 - 2.5;
    const sceneWidth = (outer + 0.6) * 2;
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

  // ---------- UI ----------

  private buildTopBar(): HTMLDivElement {
    const bar = document.createElement('div');
    bar.className = 'editor-toolbar';

    const exit = document.createElement('button');
    exit.className = 'tool-btn';
    exit.textContent = '← Menu';
    exit.addEventListener('click', () => this.cb.onExit());
    bar.appendChild(exit);

    const nameField = document.createElement('div');
    nameField.className = 'editor-field';
    const nameLabel = document.createElement('span');
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.className = 'wide';
    nameInput.value = this.state.name;
    nameInput.addEventListener('input', () => {
      this.state.name = nameInput.value;
    });
    nameField.appendChild(nameLabel);
    nameField.appendChild(nameInput);
    bar.appendChild(nameField);

    return bar;
  }

  private renderPanel(): void {
    this.panelEl.innerHTML = '';

    // ---- Palette + per-color params ----
    this.panelEl.appendChild(this.sectionLabel('Colors'));

    // Active palette toggles
    const colorRow = document.createElement('div');
    colorRow.className = 'color-row';
    for (const c of COLOR_KEYS) {
      const dot = document.createElement('div');
      dot.className = 'color-dot';
      dot.style.background = COLOR_HEX_STR[c];
      const isActive = !!this.state.params.perColor[c];
      if (!isActive) dot.classList.add('disabled');
      if (this.state.activeColor === c) dot.classList.add('active');
      dot.title = `${c}${isActive ? ' (in palette — click to remove)' : ' (click to add to palette)'}`;
      dot.addEventListener('click', () => this.toggleColorInPalette(c));
      colorRow.appendChild(dot);
    }
    this.panelEl.appendChild(colorRow);

    // Per-color tuners
    for (const c of COLOR_KEYS) {
      const p = this.state.params.perColor[c];
      if (!p) continue;
      this.panelEl.appendChild(this.colorTuner(c, p));
    }

    // ---- Disk shape ----
    this.panelEl.appendChild(this.sectionLabel('Disk shape'));
    const shapeRow = document.createElement('div');
    shapeRow.style.display = 'flex';
    shapeRow.style.gap = '8px';
    shapeRow.style.flexWrap = 'wrap';

    const maxLayers = maxLayersFor(this.state.outerSpokes);
    shapeRow.appendChild(this.numberField('Outer spokes', this.state.outerSpokes, 6, 36, (v) => {
      this.state.outerSpokes = v;
      const lim = maxLayersFor(v);
      if (this.state.layers > lim) this.state.layers = lim;
      this.regenerateDisk();
    }));
    shapeRow.appendChild(this.numberField('Layers', this.state.layers, 1, Math.max(1, maxLayers), (v) => {
      this.state.layers = v;
      this.regenerateDisk();
    }));
    shapeRow.appendChild(this.numberField('Floor cap', this.state.floorCapacity, 4, 60, (v) => {
      this.state.floorCapacity = v;
    }));
    this.panelEl.appendChild(shapeRow);

    // Per-layer breakdown
    const breakdownPieces: string[] = [];
    for (let L = 0; L < this.state.layers; L++) breakdownPieces.push(`L${L}: ${spokesPerLayer(this.state.outerSpokes, L)}`);
    const breakdown = document.createElement('div');
    breakdown.style.fontSize = '11px';
    breakdown.style.color = '#8b91a6';
    breakdown.style.padding = '2px 0 4px';
    breakdown.textContent = `Spokes per layer (outer→inner): ${breakdownPieces.join(', ')}`;
    this.panelEl.appendChild(breakdown);

    // Capacity check
    const capacity = totalCellsFor(this.state.outerSpokes, this.state.layers);
    const total = totalPixelsFromParams(this.state.params);
    const note = document.createElement('div');
    note.style.fontSize = '11px';
    note.style.color = total > capacity ? '#ff6b6b' : '#8b91a6';
    note.style.padding = '4px 0';
    note.textContent =
      total > capacity
        ? `Pixels (${total}) exceed disk capacity (${capacity}). Reduce containers or add layers.`
        : `Pixels: ${total} of ${capacity} cells (${capacity - total} empty).`;
    this.panelEl.appendChild(note);

    // Regenerate button
    const regenRow = document.createElement('div');
    regenRow.style.display = 'flex';
    regenRow.style.gap = '8px';
    const regen = document.createElement('button');
    regen.className = 'btn ghost small';
    regen.textContent = '↻ Regenerate disk';
    regen.addEventListener('click', () => {
      this.state.params.seed = Math.floor(Math.random() * 1e9);
      this.regenerateDisk();
      this.flashStatus('Regenerated.');
    });
    regenRow.appendChild(regen);
    this.panelEl.appendChild(regenRow);

    // ---- Rings + doors ----
    this.panelEl.appendChild(this.sectionLabel('Rings & doors'));
    const ringsListEl = document.createElement('div');
    ringsListEl.style.display = 'flex';
    ringsListEl.style.flexDirection = 'column';
    ringsListEl.style.gap = '6px';
    this.state.rings.forEach((r, idx) => ringsListEl.appendChild(this.ringEditor(r, idx)));
    this.panelEl.appendChild(ringsListEl);

    const ringActions = document.createElement('div');
    ringActions.style.display = 'flex';
    ringActions.style.gap = '8px';
    ringActions.style.marginTop = '6px';
    const addRing = document.createElement('button');
    addRing.className = 'btn ghost small';
    addRing.textContent = '+ Ring';
    addRing.addEventListener('click', () => {
      this.state.rings.push({ doors: [] });
      this.rebuildScene();
      this.renderPanel();
    });
    ringActions.appendChild(addRing);
    if (this.state.rings.length > 0) {
      const removeRing = document.createElement('button');
      removeRing.className = 'btn ghost small';
      removeRing.textContent = '− Last ring';
      removeRing.addEventListener('click', () => {
        this.state.rings.pop();
        this.state.selectedRing = Math.max(0, this.state.rings.length - 1);
        this.rebuildScene();
        this.renderPanel();
      });
      ringActions.appendChild(removeRing);
    }
    this.panelEl.appendChild(ringActions);

    // ---- Queue ----
    this.panelEl.appendChild(this.sectionLabel('Queue (leader = leftmost)'));
    const queueEl = document.createElement('div');
    queueEl.className = 'queue-row';
    this.state.queue.forEach((c, idx) => {
      const slot = document.createElement('div');
      slot.className = 'queue-slot';
      slot.style.background = COLOR_HEX_STR[c.color];
      slot.title = `Container ${idx + 1} — ${c.color}. Click to remove.`;
      slot.addEventListener('click', () => {
        this.state.queue.splice(idx, 1);
        this.rebuildScene();
        this.renderPanel();
      });
      queueEl.appendChild(slot);
    });
    // Add button (appends container of activeColor)
    const addSlot = document.createElement('div');
    addSlot.className = 'queue-slot add';
    addSlot.textContent = '+';
    addSlot.title = `Add a ${this.state.activeColor} container`;
    addSlot.addEventListener('click', () => {
      this.state.queue.push({ color: this.state.activeColor });
      this.rebuildScene();
      this.renderPanel();
    });
    queueEl.appendChild(addSlot);
    this.panelEl.appendChild(queueEl);

    // Queue zero-sum hint
    const queueByColor = new Map<ColorKey, number>();
    for (const q of this.state.queue) queueByColor.set(q.color, (queueByColor.get(q.color) ?? 0) + 1);
    const lines: string[] = [];
    let mismatch = false;
    for (const k of COLOR_KEYS) {
      const p = this.state.params.perColor[k];
      if (!p) continue;
      const inQueue = queueByColor.get(k) ?? 0;
      const ok = inQueue === p.containers;
      if (!ok) mismatch = true;
      lines.push(`${k}: queue ${inQueue}, params ${p.containers}${ok ? ' ✓' : ' ✕'}`);
    }
    const sumNote = document.createElement('div');
    sumNote.style.fontSize = '11px';
    sumNote.style.color = mismatch ? '#ffd166' : '#8b91a6';
    sumNote.style.padding = '4px 0';
    sumNote.textContent = mismatch
      ? `Zero-sum mismatch — fix queue to match container counts: ${lines.join('  · ')}`
      : `Zero-sum OK: ${lines.join('  · ')}`;
    this.panelEl.appendChild(sumNote);

    // ---- Action buttons ----
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    actions.style.marginTop = '10px';
    actions.style.flexWrap = 'wrap';

    const test = document.createElement('button');
    test.className = 'btn';
    test.textContent = '▶ Test';
    test.addEventListener('click', () => this.testPlay());
    actions.appendChild(test);

    const save = document.createElement('button');
    save.className = 'btn ghost';
    save.textContent = 'Save';
    save.addEventListener('click', () => this.saveLocally());
    actions.appendChild(save);

    const dl = document.createElement('button');
    dl.className = 'btn ghost';
    dl.textContent = '↓ Download';
    dl.addEventListener('click', () => this.downloadJson());
    actions.appendChild(dl);

    const json = document.createElement('button');
    json.className = 'btn ghost';
    json.textContent = 'Copy JSON';
    json.addEventListener('click', () => this.showJsonModal());
    actions.appendChild(json);

    this.panelEl.appendChild(actions);
  }

  private sectionLabel(text: string): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'menu-section-label';
    div.style.margin = '12px 0 6px';
    div.textContent = text;
    return div;
  }

  private numberField(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'editor-field';
    const lab = document.createElement('span');
    lab.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = String(min);
    inp.max = String(max);
    inp.value = String(value);
    inp.addEventListener('change', () => {
      const v = Math.max(min, Math.min(max, parseInt(inp.value, 10) || min));
      inp.value = String(v);
      onChange(v);
      this.renderPanel();
    });
    wrap.appendChild(lab);
    wrap.appendChild(inp);
    return wrap;
  }

  private colorTuner(c: ColorKey, p: PerColorParams): HTMLDivElement {
    const tuner = document.createElement('div');
    tuner.className = 'color-tuner';

    const row1 = document.createElement('div');
    row1.className = 'color-tuner-row';
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = COLOR_HEX_STR[c];
    row1.appendChild(swatch);

    const colorLabel = document.createElement('label');
    colorLabel.textContent = c;
    row1.appendChild(colorLabel);

    const ctn = document.createElement('div');
    ctn.className = 'ctn';
    const minus = document.createElement('button');
    minus.textContent = '−';
    const span = document.createElement('span');
    span.textContent = `${p.containers}`;
    const plus = document.createElement('button');
    plus.textContent = '+';
    minus.addEventListener('click', () => {
      p.containers = Math.max(0, p.containers - 1);
      if (p.containers === 0) {
        delete this.state.params.perColor[c];
      }
      this.regenerateDisk();
      this.renderPanel();
    });
    plus.addEventListener('click', () => {
      p.containers = Math.min(20, p.containers + 1);
      this.regenerateDisk();
      this.renderPanel();
    });
    ctn.appendChild(minus);
    ctn.appendChild(span);
    ctn.appendChild(plus);
    row1.appendChild(ctn);
    tuner.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'color-tuner-row';
    const clumpLab = document.createElement('label');
    clumpLab.textContent = 'Clumpiness';
    row2.appendChild(clumpLab);
    const clump = document.createElement('input');
    clump.type = 'range';
    clump.min = '0';
    clump.max = '1';
    clump.step = '0.05';
    clump.value = String(p.clumpiness);
    clump.addEventListener('input', () => {
      p.clumpiness = parseFloat(clump.value);
    });
    clump.addEventListener('change', () => {
      this.regenerateDisk();
    });
    row2.appendChild(clump);
    tuner.appendChild(row2);

    const row3 = document.createElement('div');
    row3.className = 'color-tuner-row';
    const depthLab = document.createElement('label');
    depthLab.textContent = 'Depth';
    row3.appendChild(depthLab);
    const select = document.createElement('select');
    for (const opt of ['outer', 'mixed', 'inner'] as DepthBias[]) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (p.depthBias === opt) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', () => {
      p.depthBias = select.value as DepthBias;
      this.regenerateDisk();
    });
    row3.appendChild(select);
    tuner.appendChild(row3);

    return tuner;
  }

  private ringEditor(ring: RingData, idx: number): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.style.background = 'rgba(13, 15, 21, 0.5)';
    wrap.style.padding = '8px 10px';
    wrap.style.borderRadius = '8px';

    const head = document.createElement('div');
    head.style.display = 'flex';
    head.style.justifyContent = 'space-between';
    head.style.alignItems = 'center';
    head.style.fontSize = '12px';
    head.style.color = '#8b91a6';
    head.style.marginBottom = '4px';
    head.textContent = `Ring ${idx + 1} — ${ring.doors.length} door${ring.doors.length === 1 ? '' : 's'}`;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn ghost small';
    addBtn.textContent = `+ ${this.state.activeColor} door`;
    addBtn.addEventListener('click', () => {
      // Default angle: distribute doors evenly
      const used = ring.doors.map((d) => d.angleDeg);
      let candidate = 0;
      for (let a = 0; a < 360; a += 15) {
        if (!used.some((u) => Math.abs(((u - a + 540) % 360) - 180) > 165)) {
          candidate = a;
          break;
        }
      }
      ring.doors.push({ angleDeg: candidate, color: this.state.activeColor });
      this.rebuildScene();
      this.renderPanel();
    });
    head.appendChild(addBtn);
    wrap.appendChild(head);

    ring.doors.forEach((door, dIdx) => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '8px';
      row.style.padding = '4px 0';

      const dot = document.createElement('div');
      dot.style.width = '14px';
      dot.style.height = '14px';
      dot.style.borderRadius = '50%';
      dot.style.background = COLOR_HEX_STR[door.color];
      row.appendChild(dot);

      const label = document.createElement('span');
      label.style.fontSize = '11px';
      label.style.color = '#f1f3f9';
      label.style.minWidth = '46px';
      label.textContent = `${door.angleDeg}°`;
      row.appendChild(label);

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '359';
      slider.step = '5';
      slider.value = String(door.angleDeg);
      slider.style.flex = '1';
      slider.addEventListener('input', () => {
        door.angleDeg = parseInt(slider.value, 10);
        label.textContent = `${door.angleDeg}°`;
        this.rebuildScene();
      });
      row.appendChild(slider);

      const remove = document.createElement('button');
      remove.className = 'btn ghost small';
      remove.textContent = '×';
      remove.title = 'Remove door';
      remove.addEventListener('click', () => {
        ring.doors.splice(dIdx, 1);
        this.rebuildScene();
        this.renderPanel();
      });
      row.appendChild(remove);

      wrap.appendChild(row);
    });

    return wrap;
  }

  // ---------- Editor actions ----------

  private toggleColorInPalette(c: ColorKey): void {
    if (this.state.params.perColor[c]) {
      // If this is the active color and it's in palette, just remove from palette.
      delete this.state.params.perColor[c];
      // If the active color was just removed, switch to a remaining one.
      if (this.state.activeColor === c) {
        const remaining = Object.keys(this.state.params.perColor) as ColorKey[];
        this.state.activeColor = remaining[0] ?? 'red';
      }
    } else {
      // Adding a color: default container count 1, mixed clumpiness, mixed depth.
      this.state.params.perColor[c] = { containers: 1, clumpiness: 0.6, depthBias: 'mixed' };
      this.state.activeColor = c;
    }
    this.regenerateDisk();
    this.renderPanel();
  }

  private regenerateDisk(): void {
    const cap = totalCellsFor(this.state.outerSpokes, this.state.layers);
    const total = totalPixelsFromParams(this.state.params);
    if (total > cap) {
      // Don't regenerate — show error in panel notes.
      this.flashStatus('Pixel count exceeds disk capacity. Reduce containers or add layers.');
      return;
    }
    this.state.disk = generateDisk(this.state.outerSpokes, this.state.layers, this.state.params);
    this.rebuildScene();
  }

  private onPointerDown = (e: PointerEvent) => {
    if (!this.disk) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const intersects = this.raycaster.intersectObjects(this.disk.group.children, false);
    if (intersects.length === 0) return;
    const m = intersects[0].object as THREE.Mesh;
    const layer = m.userData.layer as number | undefined;
    const indexInLayer = m.userData.indexInLayer as number | undefined;
    if (layer === undefined || indexInLayer === undefined) return;
    this.swapPixel(layer, indexInLayer);
  };

  /** Swap clicked pixel's color with another randomly-chosen pixel of activeColor. */
  private swapPixel(layer: number, indexInLayer: number): void {
    const target = this.state.activeColor;
    const current = this.state.disk[layer]?.[indexInLayer];
    if (!current || current === target) {
      this.flashStatus(`Already ${target}.`);
      return;
    }
    // Find any other cell currently of target color and swap.
    const candidates: { l: number; i: number }[] = [];
    for (let L = 0; L < this.state.disk.length; L++) {
      const row = this.state.disk[L];
      for (let i = 0; i < row.length; i++) {
        if (row[i] === target && !(L === layer && i === indexInLayer)) {
          candidates.push({ l: L, i });
        }
      }
    }
    if (candidates.length === 0) {
      this.flashStatus(`No ${target} pixels to swap with.`);
      return;
    }
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    this.state.disk[layer][indexInLayer] = target;
    this.state.disk[pick.l][pick.i] = current;
    this.rebuildScene();
    this.flashStatus(`Swapped → ${target}.`);
  }

  private flashStatus(msg: string): void {
    this.statusEl.textContent = msg;
    this.statusEl.style.color = '#58e1c4';
    if (this.statusFadeId !== undefined) clearTimeout(this.statusFadeId);
    this.statusFadeId = window.setTimeout(() => {
      this.statusEl.style.color = '';
      this.statusEl.textContent = 'Tap a pixel on the disk to swap it to the active color.';
    }, 2400);
  }

  // ---------- Save/Test/Download ----------

  private snapshot(): LevelData {
    return {
      id: this.state.id,
      name: this.state.name,
      outerSpokes: this.state.outerSpokes,
      layers: this.state.layers,
      disk: this.state.disk.map((row) => row.slice()),
      rings: this.state.rings.map((r) => ({ doors: r.doors.map((d) => ({ ...d })) })),
      queue: this.state.queue.map((c) => ({ ...c })),
      floorCapacity: this.state.floorCapacity,
      editorParams: {
        seed: this.state.params.seed,
        perColor: { ...this.state.params.perColor },
      },
    };
  }

  private testPlay(): void {
    const lv = this.snapshot();
    if (!this.validateForPlay(lv)) return;
    this.cb.onTestPlay(lv);
  }

  private validateForPlay(lv: LevelData): boolean {
    const diskCells = lv.disk.flat();
    if (diskCells.every((c) => c === null)) {
      this.flashStatus('Disk is empty.');
      return false;
    }
    if (lv.rings.length === 0 || lv.rings.every((r) => r.doors.length === 0)) {
      this.flashStatus('Add at least one door.');
      return false;
    }
    if (lv.queue.length === 0) {
      this.flashStatus('Queue is empty.');
      return false;
    }
    // Zero-sum check
    const diskCounts = new Map<ColorKey, number>();
    for (const c of diskCells) if (c) diskCounts.set(c, (diskCounts.get(c) ?? 0) + 1);
    const queueCounts = new Map<ColorKey, number>();
    for (const c of lv.queue) queueCounts.set(c.color, (queueCounts.get(c.color) ?? 0) + 1);
    for (const [c, n] of diskCounts) {
      const queued = (queueCounts.get(c) ?? 0) * CONTAINER_SLOTS;
      if (queued !== n) {
        this.flashStatus(`${c}: ${n} pixels but ${queued} queue slots. Fix zero-sum first.`);
        return false;
      }
    }
    for (const [c, qn] of queueCounts) {
      const dn = diskCounts.get(c) ?? 0;
      if (qn * CONTAINER_SLOTS !== dn) {
        this.flashStatus(`${c}: ${qn * CONTAINER_SLOTS} queue slots but ${dn} pixels.`);
        return false;
      }
    }
    return true;
  }

  private saveLocally(): void {
    const lv = this.snapshot();
    saveCustomLevel(lv);
    this.flashStatus('Saved to your levels.');
  }

  private downloadJson(): void {
    const lv = this.snapshot();
    const json = JSON.stringify(lv, null, 2);
    const slug = (lv.name || lv.id || 'level')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'level';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.flashStatus('Downloaded — drop into src/levels/contributed/ to ship it.');
  }

  private showJsonModal(): void {
    const lv = this.snapshot();
    const json = JSON.stringify(lv, null, 2);
    const modal = document.createElement('div');
    modal.className = 'modal';
    const card = document.createElement('div');
    card.className = 'modal-card';
    const h = document.createElement('h2');
    h.textContent = 'Level JSON';
    const ta = document.createElement('textarea');
    ta.className = 'json';
    ta.value = json;
    ta.readOnly = true;
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const copy = document.createElement('button');
    copy.className = 'btn';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => {
      ta.select();
      document.execCommand('copy');
      copy.textContent = 'Copied!';
    });
    const close = document.createElement('button');
    close.className = 'btn ghost';
    close.textContent = 'Close';
    close.addEventListener('click', () => modal.remove());
    actions.appendChild(copy);
    actions.appendChild(close);
    card.appendChild(h);
    card.appendChild(ta);
    card.appendChild(actions);
    modal.appendChild(card);
    this.root.appendChild(modal);
  }

  // ---------- Dispose ----------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    if (this.statusFadeId !== undefined) clearTimeout(this.statusFadeId);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.resizeObserver.disconnect();
    if (this.disk) this.disk.dispose();
    if (this.ringsMgr) this.ringsMgr.dispose();
    while (this.queueGroup.children.length) {
      const c = this.queueGroup.children.pop()!;
      const m = c as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material)?.dispose?.();
    }
    if (this.floorOutline) {
      this.floorOutline.geometry.dispose();
      (this.floorOutline.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.root.remove();
  }
}
