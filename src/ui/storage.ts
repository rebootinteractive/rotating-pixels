import type { LevelData } from '../shared/types';

const KEY = 'rp:custom-levels';

export function loadCustomLevels(): LevelData[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LevelData[];
  } catch {
    return [];
  }
}

export function saveCustomLevel(level: LevelData): void {
  const all = loadCustomLevels();
  const idx = all.findIndex((l) => l.id === level.id);
  if (idx >= 0) all[idx] = level;
  else all.push(level);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function deleteCustomLevel(id: string): void {
  const all = loadCustomLevels().filter((l) => l.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
}

export function getCustomLevel(id: string): LevelData | null {
  return loadCustomLevels().find((l) => l.id === id) ?? null;
}
