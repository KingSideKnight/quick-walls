# Quick Walls

A floating toolbar for **fast map walling** in Foundry VTT. Draw rectangles over
buildings and quick lines for doors and windows, then one click turns them into
proper walls, working doors, and see-through windows.

**System-agnostic** — it uses only core Foundry APIs, so it works with any game
system (D&D 5e, PF2e, a blank world, anything).

![Foundry v13](https://img.shields.io/badge/Foundry-v13%E2%80%93v14-informational)
![License: MIT](https://img.shields.io/badge/License-MIT-green)

## Why

Walling a battlemap by hand is slow: switch to the walls layer, trace every
segment, place each door. Quick Walls flips it: you rough out buildings with the
drawing tools (which snap to the grid), and it does the precise wall work.

## How to use

1. Open the **Drawings** controls in the left toolbar and click the **Quick
   Walls** button (trowel icon). A small panel appears.
2. **Building** — drag a rectangle over each (square) building.
3. **Door** — drag a short line along a wall where a door goes. The line is
   auto-colored; you never open the color picker.
4. **Window** — drag a short line for each window.
5. **Build Walls** — preview the counts, confirm, done.

Each rectangle becomes four walls. Each door line becomes a working door with a
gap left in the wall. Each window line becomes a segment that blocks movement but
lets sight and light through. The guide drawings are cleared afterward (optional).

The line's **length** sets the opening width, and a line only attaches to a wall
it sits on (within about half a grid square), so place it along the wall.

## Notes & limits

- Buildings are assumed **axis-aligned** (not rotated) — perfect for the common
  "square building" case. Irregular shapes are still best done by hand.
- Door/window lines can be drawn with the freehand **or** polygon tool.

## Settings

- **Door / Window line color** — the colors used to mark and detect openings.
- **Delete guide drawings after building** — clean up the rectangles/lines.
- **Windows block sound** — whether windows muffle sound (like glass).

## API

```js
game.modules.get("quick-walls").api.toggle(); // open/close the panel
game.modules.get("quick-walls").api.build();  // build walls from current drawings
```

## Installation

Manifest URL:

```
https://github.com/KingSideKnight/quick-walls/releases/latest/download/module.json
```

## License

[MIT](LICENSE) © KingSideKnight
