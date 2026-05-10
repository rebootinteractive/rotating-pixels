import type { LevelData } from '../shared/types';
import { ALL_LEVELS } from '../levels';
import { deleteCustomLevel, loadCustomLevels } from './storage';

export interface MenuCallbacks {
  onPlay: (level: LevelData) => void;
  onOpenEditor: (forLevel?: LevelData) => void;
}

export class MainMenu {
  private root: HTMLDivElement;

  constructor(private parent: HTMLElement, private cb: MenuCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'menu';
    this.parent.appendChild(this.root);
    this.render();
  }

  private render(): void {
    this.root.innerHTML = '';

    const title = document.createElement('h1');
    title.className = 'menu-title';
    title.textContent = 'RotatingPixels';
    this.root.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'menu-sub';
    sub.textContent = 'Spin a ring. Doors peel matching pixels off the disk. Feed the queue without overflowing the floor.';
    this.root.appendChild(sub);

    const builtinLabel = document.createElement('div');
    builtinLabel.className = 'menu-section-label';
    builtinLabel.textContent = 'Levels';
    this.root.appendChild(builtinLabel);

    const builtinList = document.createElement('div');
    builtinList.className = 'level-list';
    ALL_LEVELS.forEach((lvl) => {
      builtinList.appendChild(this.renderCard(lvl, false));
    });
    this.root.appendChild(builtinList);

    const customs = loadCustomLevels();
    const customLabel = document.createElement('div');
    customLabel.className = 'menu-section-label';
    customLabel.textContent = `Your Levels${customs.length ? ` (${customs.length})` : ''}`;
    this.root.appendChild(customLabel);

    const customList = document.createElement('div');
    customList.className = 'level-list';
    if (customs.length === 0) {
      const empty = document.createElement('div');
      empty.style.color = '#8b91a6';
      empty.style.fontSize = '13px';
      empty.style.padding = '6px 4px';
      empty.textContent = 'No custom levels yet — create one in the editor.';
      customList.appendChild(empty);
    } else {
      customs.forEach((lvl) => {
        customList.appendChild(this.renderCard(lvl, true));
      });
    }
    this.root.appendChild(customList);

    const footer = document.createElement('div');
    footer.className = 'menu-footer';
    const newBtn = document.createElement('button');
    newBtn.className = 'btn';
    newBtn.style.width = '100%';
    newBtn.textContent = '+ Create New Level';
    newBtn.addEventListener('click', () => this.cb.onOpenEditor());
    footer.appendChild(newBtn);
    this.root.appendChild(footer);
  }

  private renderCard(level: LevelData, isCustom: boolean): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'level-card';
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      this.cb.onPlay(level);
    });

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = level.name;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const ringCount = level.rings.length;
    const doorCount = level.rings.reduce((sum, r) => sum + r.doors.length, 0);
    const pixelCount = level.disk.filter((c) => c !== null).length;
    meta.textContent = `${ringCount} ring${ringCount === 1 ? '' : 's'} · ${doorCount} door${doorCount === 1 ? '' : 's'} · ${pixelCount} pixels · cap ${level.floorCapacity}`;
    left.appendChild(name);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.alignItems = 'center';
    right.style.gap = '8px';

    if (isCustom) {
      const editBtn = document.createElement('button');
      editBtn.className = 'btn ghost small';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onOpenEditor(level);
      });
      right.appendChild(editBtn);

      const del = document.createElement('button');
      del.className = 'delete';
      del.textContent = '×';
      del.title = 'Delete';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${level.name}"?`)) {
          deleteCustomLevel(level.id);
          this.render();
        }
      });
      right.appendChild(del);
    } else {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'PLAY';
      right.appendChild(badge);
    }

    card.appendChild(left);
    card.appendChild(right);
    return card;
  }

  dispose(): void {
    this.root.remove();
  }
}
