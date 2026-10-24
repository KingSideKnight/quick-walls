/**
 * Quick Walls
 * A floating toolbar for fast map walling. System-agnostic.
 *
 * Draw a RECTANGLE over a building, a quick LINE along a wall for each door or
 * window, then click Build: the module turns each rectangle into four walls and
 * cuts real doors and see-through windows where the lines are. Door/window lines
 * are auto-colored as you draw, so you never touch the color picker.
 */

const MODULE = "quick-walls";
const NORMAL = 20, NONE = 0; // CONST.WALL_SENSE_TYPES

Hooks.once("init", () => {
  game.settings.register(MODULE, "doorColor", {
    name: "QUICKWALLS.Settings.DoorColor.Name",
    hint: "QUICKWALLS.Settings.DoorColor.Hint",
    scope: "client", config: true, type: new foundry.data.fields.ColorField({ initial: "#ff0000" }),
  });
  game.settings.register(MODULE, "windowColor", {
    name: "QUICKWALLS.Settings.WindowColor.Name",
    hint: "QUICKWALLS.Settings.WindowColor.Hint",
    scope: "client", config: true, type: new foundry.data.fields.ColorField({ initial: "#0000ff" }),
  });
  game.settings.register(MODULE, "deleteGuides", {
    name: "QUICKWALLS.Settings.DeleteGuides.Name",
    hint: "QUICKWALLS.Settings.DeleteGuides.Hint",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(MODULE, "windowBlocksSound", {
    name: "QUICKWALLS.Settings.WindowSound.Name",
    hint: "QUICKWALLS.Settings.WindowSound.Hint",
    scope: "world", config: true, type: Boolean, default: true,
  });
});

// Toolbar button in the Walls controls
Hooks.on("getSceneControlButtons", (controls) => {
  const group = controls.walls;
  if (!group?.tools) return;
  group.tools.quickWalls = {
    name: "quickWalls",
    title: "QUICKWALLS.ToggleTitle",
    icon: "fa-solid fa-trowel-bricks",
    button: true,          // button tool: fires onChange once on click
    visible: game.user.isGM,
    order: 99,
    // Only onChange — core also fires a deprecated onClick if present, which
    // would toggle the panel a second time (open then immediately close).
    onChange: () => QuickWalls.toggle(),
  };
});

export class QuickWalls {
  static _el = null;
  static _mode = null;
  static _hookId = null;
  static _onMove = null;
  static _onUp = null;

  static toggle() {
    if (QuickWalls._el) return QuickWalls.close();
    QuickWalls.open();
  }

  static open() {
    if (!canvas?.scene) { ui.notifications.error("Quick Walls: no active scene."); return; }

    // Auto-color door/window lines as they are drawn (hook lives only while open)
    QuickWalls._hookId = Hooks.on("preCreateDrawing", (doc, data, opts, userId) => {
      if (userId !== game.user.id) return;
      if (QuickWalls._mode === "door")   doc.updateSource({ strokeColor: game.settings.get(MODULE, "doorColor"),   strokeWidth: 8 });
      if (QuickWalls._mode === "window") doc.updateSource({ strokeColor: game.settings.get(MODULE, "windowColor"), strokeWidth: 8 });
    });

    const el = document.createElement("div");
    el.id = "quick-walls-panel";
    el.innerHTML = `
      <div class="qw-head"><i class="fa-solid fa-trowel-bricks"></i> ${game.i18n.localize("QUICKWALLS.Title")} <span class="qw-x" title="${game.i18n.localize("QUICKWALLS.Close")}">✕</span></div>
      <div class="qw-body">
        <button data-mode="building" title="${game.i18n.localize("QUICKWALLS.BuildingHint")}"><i class="fa-solid fa-vector-square"></i> ${game.i18n.localize("QUICKWALLS.Building")}</button>
        <button data-mode="door"     title="${game.i18n.localize("QUICKWALLS.DoorHint")}"><i class="fa-solid fa-door-open"></i> ${game.i18n.localize("QUICKWALLS.Door")}</button>
        <button data-mode="window"   title="${game.i18n.localize("QUICKWALLS.WindowHint")}"><i class="fa-solid fa-border-top-left"></i> ${game.i18n.localize("QUICKWALLS.Window")}</button>
        <button class="qw-build" title="${game.i18n.localize("QUICKWALLS.BuildHint")}"><i class="fa-solid fa-hammer"></i> ${game.i18n.localize("QUICKWALLS.Build")}</button>
      </div>`;
    document.body.appendChild(el);
    QuickWalls._el = el;

    el.querySelector('[data-mode="building"]').addEventListener("click", () => QuickWalls._setMode("building", "rect"));
    el.querySelector('[data-mode="door"]').addEventListener("click",     () => QuickWalls._setMode("door", "freehand"));
    el.querySelector('[data-mode="window"]').addEventListener("click",   () => QuickWalls._setMode("window", "freehand"));
    el.querySelector(".qw-build").addEventListener("click", () => QuickWalls.build());
    el.querySelector(".qw-x").addEventListener("click", () => QuickWalls.close());

    // drag to move
    const head = el.querySelector(".qw-head");
    let dx = 0, dy = 0, dragging = false;
    head.addEventListener("mousedown", (e) => { dragging = true; dx = e.clientX - el.offsetLeft; dy = e.clientY - el.offsetTop; e.preventDefault(); });
    QuickWalls._onMove = (e) => { if (dragging) { el.style.left = (e.clientX - dx) + "px"; el.style.top = (e.clientY - dy) + "px"; } };
    QuickWalls._onUp = () => { dragging = false; };
    window.addEventListener("mousemove", QuickWalls._onMove);
    window.addEventListener("mouseup", QuickWalls._onUp);
  }

  static close() {
    if (QuickWalls._hookId != null) Hooks.off("preCreateDrawing", QuickWalls._hookId);
    if (QuickWalls._onMove) window.removeEventListener("mousemove", QuickWalls._onMove);
    if (QuickWalls._onUp) window.removeEventListener("mouseup", QuickWalls._onUp);
    QuickWalls._el?.remove();
    QuickWalls._el = null; QuickWalls._mode = null; QuickWalls._hookId = null;
    QuickWalls._onMove = null; QuickWalls._onUp = null;
  }

  static _setMode(mode, tool) {
    QuickWalls._mode = mode;
    try { ui.controls.activate({ control: "drawings", tool }); }
    catch (e) { canvas.drawings?.activate?.(); }
    for (const b of QuickWalls._el.querySelectorAll("button[data-mode]"))
      b.classList.toggle("active", b.dataset.mode === mode);
  }

  // ---- geometry --------------------------------------------------------------
  static _rectEdges(x, y, w, h) {
    const tl = [x, y], tr = [x + w, y], br = [x + w, y + h], bl = [x, y + h];
    return [[...tl, ...tr], [...tr, ...br], [...br, ...bl], [...bl, ...tl]];
  }
  static _project(a, b, p) {
    const abx = b[0] - a[0], aby = b[1] - a[1], len2 = abx * abx + aby * aby || 1e-9;
    const t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
    return { t, dist: Math.hypot(p[0] - (a[0] + t * abx), p[1] - (a[1] + t * aby)) };
  }
  static _segmentsForEdge(edge, markers, tol) {
    const a = [edge[0], edge[1]], b = [edge[2], edge[3]], openings = [];
    for (const m of markers) {
      const q0 = QuickWalls._project(a, b, m.p0), q1 = QuickWalls._project(a, b, m.p1);
      if (q0.dist > tol || q1.dist > tol) continue;
      const t0 = Math.max(0, Math.min(q0.t, q1.t)), t1 = Math.min(1, Math.max(q0.t, q1.t));
      if (t1 - t0 > 1e-3) openings.push({ t0, t1, type: m.type });
    }
    openings.sort((x, y) => x.t0 - y.t0);
    const pt = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const out = []; let c = 0;
    for (const o of openings) {
      if (o.t0 > c + 1e-3) out.push({ c: [...pt(c), ...pt(o.t0)], type: "solid" });
      out.push({ c: [...pt(o.t0), ...pt(o.t1)], type: o.type });
      c = Math.max(c, o.t1);
    }
    if (c < 1 - 1e-3) out.push({ c: [...pt(c), ...pt(1)], type: "solid" });
    return out;
  }
  static _wallProps(type) {
    const winSound = game.settings.get(MODULE, "windowBlocksSound") ? NORMAL : NONE;
    if (type === "door")   return { move: NORMAL, sight: NORMAL, light: NORMAL, sound: NORMAL, door: 1, ds: 0 };
    if (type === "window") return { move: NORMAL, sight: NONE,   light: NONE,   sound: winSound, door: 0, ds: 0 };
    return                        { move: NORMAL, sight: NORMAL, light: NORMAL, sound: NORMAL, door: 0, ds: 0 };
  }
  static _colorKind(col) {
    if (col == null) return null;
    let s = col; if (typeof s === "object" && s.css) s = s.css;
    const n = (typeof s === "string") ? parseInt(s.replace("#", ""), 16) : Number(s);
    if (Number.isNaN(n)) return null;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const door = game.settings.get(MODULE, "doorColor"), win = game.settings.get(MODULE, "windowColor");
    const near = (hex) => { const m = Number(typeof hex === "object" ? Number(hex) : parseInt(String(hex).replace("#",""),16)); return Math.abs(((m>>16)&255)-r) + Math.abs(((m>>8)&255)-g) + Math.abs((m&255)-b) < 80; };
    if (near(door)) return "door";
    if (near(win))  return "window";
    // fallback: dominant channel
    if (r > g + 40 && r > b + 40) return "door";
    if (b > r + 40 && b > g + 40) return "window";
    return null;
  }

  static async build() {
    const scene = canvas.scene;
    if (!scene) { ui.notifications.error("Quick Walls: no active scene."); return; }
    const grid = scene.grid.size || 100, tol = grid * 0.6;
    const drawings = Array.from(scene.drawings);
    const buildings = [], markers = [];
    for (const d of drawings) {
      const t = d.shape?.type;
      if (t === "r") buildings.push({ d, x: d.x, y: d.y, w: d.shape.width, h: d.shape.height });
      else if ((t === "p" || t === "f") && Array.isArray(d.shape.points) && d.shape.points.length >= 4) {
        const p = d.shape.points, kind = QuickWalls._colorKind(d.strokeColor);
        if (kind) markers.push({ p0: [d.x + p[0], d.y + p[1]], p1: [d.x + p[p.length - 2], d.y + p[p.length - 1]], type: kind, id: d.id });
      }
    }
    if (!buildings.length) { ui.notifications.warn(game.i18n.localize("QUICKWALLS.NoBuildings")); return; }

    const walls = []; let doors = 0, wins = 0;
    for (const b of buildings) for (const e of QuickWalls._rectEdges(b.x, b.y, b.w, b.h)) for (const s of QuickWalls._segmentsForEdge(e, markers, tol)) {
      if (s.type === "door") doors++; if (s.type === "window") wins++;
      walls.push({ c: s.c.map(Math.round), ...QuickWalls._wallProps(s.type) });
    }

    const del = game.settings.get(MODULE, "deleteGuides");
    const ok = await Dialog.confirm({
      title: game.i18n.localize("QUICKWALLS.Title"),
      content: `<p><b>${scene.name}</b></p><ul>
        <li>${buildings.length} ${game.i18n.localize("QUICKWALLS.Buildings")}</li>
        <li>${walls.length} ${game.i18n.localize("QUICKWALLS.Walls")}</li>
        <li>${doors} ${game.i18n.localize("QUICKWALLS.Doors")}, ${wins} ${game.i18n.localize("QUICKWALLS.Windows")}</li>
        </ul><p>${game.i18n.localize(del ? "QUICKWALLS.ConfirmDelete" : "QUICKWALLS.Confirm")}</p>`,
    });
    if (!ok) return;

    await scene.createEmbeddedDocuments("Wall", walls);
    if (del) await scene.deleteEmbeddedDocuments("Drawing", [...new Set([...buildings.map(b => b.d.id), ...markers.map(m => m.id)])]);
    ui.notifications.info(game.i18n.format("QUICKWALLS.Done", { walls: walls.length, doors, windows: wins }));
  }
}

// Expose a tiny API for macros/other modules
Hooks.once("ready", () => {
  game.modules.get(MODULE).api = { toggle: () => QuickWalls.toggle(), build: () => QuickWalls.build() };
});
