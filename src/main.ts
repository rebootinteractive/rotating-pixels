import type { LevelData } from './shared/types';
import { MainMenu } from './ui/MainMenu';
import { GameApp } from './game/GameApp';
import { EditorApp } from './editor/EditorApp';

const app = document.getElementById('app')!;

interface State {
  current?:
    | { kind: 'game'; instance: GameApp }
    | { kind: 'editor'; instance: EditorApp }
    | { kind: 'menu'; instance: MainMenu };
}

const state: State = {};

function clearApp(): void {
  if (state.current?.kind === 'game') state.current.instance.dispose();
  if (state.current?.kind === 'editor') state.current.instance.dispose();
  if (state.current?.kind === 'menu') state.current.instance.dispose();
  state.current = undefined;
}

function showMenu(): void {
  clearApp();
  const menu = new MainMenu(app, {
    onPlay: (level) => showGame(level),
    onOpenEditor: (level) => showEditor(level),
  });
  state.current = { kind: 'menu', instance: menu };
}

function showGame(level: LevelData, returnToEditor?: LevelData): void {
  clearApp();
  const game = new GameApp(app, {
    level,
    onMenu: () => {
      if (returnToEditor) showEditor(returnToEditor);
      else showMenu();
    },
    onRestart: () => showGame(level, returnToEditor),
  });
  state.current = { kind: 'game', instance: game };
}

function showEditor(initial?: LevelData): void {
  clearApp();
  const editor = new EditorApp(app, {
    initial,
    onExit: () => showMenu(),
    onTestPlay: (lv) => showGame(lv, lv),
  });
  state.current = { kind: 'editor', instance: editor };
}

showMenu();
