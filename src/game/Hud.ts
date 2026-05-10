export interface HudCallbacks {
  onMenu: () => void;
  onRestart: () => void;
}

export class Hud {
  private root: HTMLDivElement;
  private floorEl: HTMLDivElement;
  private modalEl: HTMLDivElement | null = null;
  private capacity: number;

  constructor(parent: HTMLElement, capacity: number, private cb: HudCallbacks) {
    this.capacity = capacity;
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    parent.appendChild(this.root);

    const top = document.createElement('div');
    top.className = 'hud-top';

    const back = document.createElement('button');
    back.className = 'btn ghost small';
    back.textContent = '← Levels';
    back.addEventListener('click', () => this.cb.onMenu());
    top.appendChild(back);

    this.floorEl = document.createElement('div');
    this.floorEl.className = 'hud-floor';
    this.floorEl.innerHTML = `Floor: <strong>0</strong> / ${capacity}`;
    top.appendChild(this.floorEl);

    this.root.appendChild(top);
  }

  setFloor(n: number): void {
    this.floorEl.innerHTML = `Floor: <strong>${n}</strong> / ${this.capacity}`;
    this.floorEl.classList.toggle('warn', n >= this.capacity * 0.75 && n < this.capacity);
    this.floorEl.classList.toggle('danger', n >= this.capacity);
  }

  showWin(): void {
    this.showModal('win', 'You cleared it!', 'Disk emptied, queue done. Floor stayed clean.', [
      { text: 'Levels', kind: 'ghost', onClick: () => this.cb.onMenu() },
      { text: 'Replay', kind: 'primary', onClick: () => this.cb.onRestart() },
    ]);
  }

  showLose(): void {
    this.showModal('lose', 'Floor overflowed', 'Too many balls piled up before the queue could keep up.', [
      { text: 'Levels', kind: 'ghost', onClick: () => this.cb.onMenu() },
      { text: 'Retry', kind: 'primary', onClick: () => this.cb.onRestart() },
    ]);
  }

  private showModal(
    kind: 'win' | 'lose',
    title: string,
    body: string,
    actions: { text: string; kind: 'primary' | 'ghost'; onClick: () => void }[]
  ): void {
    if (this.modalEl) this.modalEl.remove();
    const modal = document.createElement('div');
    modal.className = 'modal';
    const card = document.createElement('div');
    card.className = `modal-card endgame ${kind}`;
    const h = document.createElement('h1');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = body;
    const actionsRow = document.createElement('div');
    actionsRow.className = 'modal-actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = `btn ${a.kind === 'ghost' ? 'ghost' : ''}`;
      btn.textContent = a.text;
      btn.addEventListener('click', a.onClick);
      actionsRow.appendChild(btn);
    }
    card.appendChild(h);
    card.appendChild(p);
    card.appendChild(actionsRow);
    modal.appendChild(card);
    this.root.appendChild(modal);
    this.modalEl = modal;
  }

  dispose(): void {
    if (this.modalEl) this.modalEl.remove();
    this.modalEl = null;
    this.root.remove();
  }
}
