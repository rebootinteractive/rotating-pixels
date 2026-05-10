# Contributed Levels

Drop a level `.json` file (downloaded from the in-app editor) into this folder and it ships in the next build.

## Workflow

1. Open the deployed game.
2. Tap **+ Create New Level** in the main menu.
3. Configure the level — palette, container counts, clumpiness, depth bias, rings, doors, queue, floor capacity.
4. Hit **Test** to play it. Tweak. Repeat.
5. Hit **↓ Download** to save it as a `.json`.
6. Move the file into `src/levels/contributed/`.
7. Commit + push to `main` — GitHub Pages auto-rebuilds and the level appears in the menu.

That's the whole pipeline. No code changes required.
