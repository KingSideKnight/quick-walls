/**
 * Quick Walls
 * A floating toolbar for fast map walling. System-agnostic.
 *
 * Draw guides over your map, then click Build. A RECTANGLE or ELLIPSE becomes a
 * building's perimeter walls; a FREEHAND stroke becomes a curved/irregular wall;
 * a LINE along a wall cuts a door or window; a MARK drops a light. Guides are
 * auto-colored as you draw, so you never touch the color picker.
 */

const MODULE = "quick-walls";
const NORMAL = 20, LIMITED = 10, NONE = 0; // CONST.WALL_SENSE_TYPES

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
  game.settings.register(MODULE, "lightColor", {
    name: "QUICKWALLS.Settings.LightColor.Name",
    hint: "QUICKWALLS.Settings.LightColor.Hint",
    scope: "client", config: true, type: new foundry.data.fields.ColorField({ initial: "#ffaa00" }),
  });
  game.settings.register(MODULE, "lightTint", {
    name: "QUICKWALLS.Settings.LightTint.Name",
    hint: "QUICKWALLS.Settings.LightTint.Hint",
    scope: "world", config: true, type: new foundry.data.fields.ColorField({ initial: "#f6a848" }),
  });
  game.settings.register(MODULE, "lightBright", {
    name: "QUICKWALLS.Settings.LightBright.Name",
    hint: "QUICKWALLS.Settings.LightBright.Hint",
    scope: "world", config: true, type: Number, default: 10,
  });
  game.settings.register(MODULE, "lightDim", {
    name: "QUICKWALLS.Settings.LightDim.Name",
    hint: "QUICKWALLS.Settings.LightDim.Hint",
    scope: "world", config: true, type: Number, default: 20,
  });
  game.settings.register(MODULE, "lightTorch", {
    name: "QUICKWALLS.Settings.LightTorch.Name",
    hint: "QUICKWALLS.Settings.LightTorch.Hint",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(MODULE, "wallColor", {
    name: "QUICKWALLS.Settings.WallColor.Name",
    hint: "QUICKWALLS.Settings.WallColor.Hint",
    scope: "client", config: true, type: new foundry.data.fields.ColorField({ initial: "#33cc33" }),
  });
  game.settings.register(MODULE, "wallSimplify", {
    name: "QUICKWALLS.Settings.WallSimplify.Name",
    hint: "QUICKWALLS.Settings.WallSimplify.Hint",
    scope: "world", config: true, type: Number, default: 0.33,
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
  static _wallType = "normal"; // normal | terrain | invisible | ethereal (for solid building walls)

  static toggle() {
    if (QuickWalls._el) return QuickWalls.close();
    QuickWalls.open();
  }

  static open() {
    if (!canvas?.scene) { ui.notifications.error("Quick Walls: no active scene."); return; }
    QuickWalls._wallType = "normal";

    // Auto-color door/window lines as they are drawn (hook lives only while open)
    QuickWalls._hookId = Hooks.on("preCreateDrawing", (doc, data, opts, userId) => {
      if (userId !== game.user.id) return;
      if (QuickWalls._mode === "door")   doc.updateSource({ strokeColor: game.settings.get(MODULE, "doorColor"),   strokeWidth: 8 });
      if (QuickWalls._mode === "window") doc.updateSource({ strokeColor: game.settings.get(MODULE, "windowColor"), strokeWidth: 8 });
      if (QuickWalls._mode === "light")  doc.updateSource({ strokeColor: game.settings.get(MODULE, "lightColor"),  strokeWidth: 8 });
      // Wall guides (rectangle, ellipse, freehand) get their own color so the
      // red door lines stand out against them instead of blending in.
      if (QuickWalls._mode === "building" || QuickWalls._mode === "round" || QuickWalls._mode === "wall")
        doc.updateSource({ strokeColor: game.settings.get(MODULE, "wallColor"), strokeWidth: 8 });
    });

    const el = document.createElement("div");
    el.id = "quick-walls-panel";
    el.innerHTML = `
      <div class="qw-head"><i class="fa-solid fa-trowel-bricks"></i> ${game.i18n.localize("QUICKWALLS.Title")} <span class="qw-x" title="${game.i18n.localize("QUICKWALLS.Close")}">✕</span></div>
      <div class="qw-body">
        <button data-mode="building" title="${game.i18n.localize("QUICKWALLS.BuildingHint")}"><i class="fa-solid fa-vector-square"></i> ${game.i18n.localize("QUICKWALLS.Building")}</button>
        <button data-mode="round"    title="${game.i18n.localize("QUICKWALLS.RoundHint")}"><i class="fa-solid fa-circle"></i> ${game.i18n.localize("QUICKWALLS.Round")}</button>
        <button data-mode="wall"     title="${game.i18n.localize("QUICKWALLS.FreehandHint")}"><i class="fa-solid fa-pen-nib"></i> ${game.i18n.localize("QUICKWALLS.Freehand")}</button>
        <button data-mode="door"     title="${game.i18n.localize("QUICKWALLS.DoorHint")}"><i class="fa-solid fa-door-open"></i> ${game.i18n.localize("QUICKWALLS.Door")}</button>
        <button data-mode="window"   title="${game.i18n.localize("QUICKWALLS.WindowHint")}"><i class="fa-solid fa-border-top-left"></i> ${game.i18n.localize("QUICKWALLS.Window")}</button>
        <button data-mode="light"    title="${game.i18n.localize("QUICKWALLS.LightHint")}"><i class="fa-solid fa-fire"></i> ${game.i18n.localize("QUICKWALLS.Light")}</button>
        <label class="qw-walltype-label" title="${game.i18n.localize("QUICKWALLS.WallTypeHint")}"><i class="fa-solid fa-grip-lines-vertical"></i>
          <select class="qw-walltype">
            <option value="normal">${game.i18n.localize("QUICKWALLS.WTNormal")}</option>
            <option value="terrain">${game.i18n.localize("QUICKWALLS.WTTerrain")}</option>
            <option value="invisible">${game.i18n.localize("QUICKWALLS.WTInvisible")}</option>
            <option value="ethereal">${game.i18n.localize("QUICKWALLS.WTEthereal")}</option>
          </select>
        </label>
        <button class="qw-build" title="${game.i18n.localize("QUICKWALLS.BuildHint")}"><i class="fa-solid fa-hammer"></i> ${game.i18n.localize("QUICKWALLS.Build")}</button>
      </div>`;
    document.body.appendChild(el);
    QuickWalls._el = el;

    el.querySelector('[data-mode="building"]').addEventListener("click", () => QuickWalls._setMode("building", "rect"));
    el.querySelector('[data-mode="round"]').addEventListener("click",    () => QuickWalls._setMode("round", "ellipse"));
    el.querySelector('[data-mode="wall"]').addEventListener("click",     () => QuickWalls._setMode("wall", "freehand"));
    el.querySelector('[data-mode="door"]').addEventListener("click",     () => QuickWalls._setMode("door", "freehand"));
    el.querySelector('[data-mode="window"]').addEventListener("click",   () => QuickWalls._setMode("window", "freehand"));
    el.querySelector('[data-mode="light"]').addEventListener("click",    () => QuickWalls._setMode("light", "freehand"));
    el.querySelector(".qw-walltype").addEventListener("change", (e) => { QuickWalls._wallType = e.target.value; });
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
  // Where does segment p0->p1 lie along edge a->b? Returns the clamped [t0,t1]
  // interval if it is collinear and within tol, else null. Shared by opening
  // detection (markers) and duplicate detection (existing walls).
  static _overlapInterval(a, b, p0, p1, tol) {
    const q0 = QuickWalls._project(a, b, p0), q1 = QuickWalls._project(a, b, p1);
    if (q0.dist > tol || q1.dist > tol) return null;
    const t0 = Math.max(0, Math.min(q0.t, q1.t)), t1 = Math.min(1, Math.max(q0.t, q1.t));
    return (t1 - t0 > 1e-3) ? { t0, t1 } : null;
  }
  static _segmentsForEdge(edge, markers, tol) {
    const a = [edge[0], edge[1]], b = [edge[2], edge[3]], openings = [];
    for (const m of markers) {
      const iv = QuickWalls._overlapInterval(a, b, m.p0, m.p1, tol);
      if (iv) openings.push({ ...iv, type: m.type });
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
    return QuickWalls._solidProps(QuickWalls._wallType); // solid walls use the chosen Foundry wall type
  }
  // Foundry's four wall types (per the Walls KB): what each blocks.
  static _solidProps(wt) {
    switch (wt) {
      case "terrain":   return { move: NORMAL, sight: LIMITED, light: LIMITED, sound: NORMAL, door: 0, ds: 0 };
      case "invisible": return { move: NORMAL, sight: NONE,    light: NONE,    sound: NONE,   door: 0, ds: 0 };
      case "ethereal":  return { move: NONE,   sight: NORMAL,  light: NORMAL,  sound: NORMAL, door: 0, ds: 0 };
      default:          return { move: NORMAL, sight: NORMAL,  light: NORMAL,  sound: NORMAL, door: 0, ds: 0 };
    }
  }
  static _colorKind(col) {
    if (col == null) return null;
    let s = col; if (typeof s === "object" && s.css) s = s.css;
    const n = (typeof s === "string") ? parseInt(s.replace("#", ""), 16) : Number(s);
    if (Number.isNaN(n)) return null;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const door = game.settings.get(MODULE, "doorColor"), win = game.settings.get(MODULE, "windowColor"), light = game.settings.get(MODULE, "lightColor"), wall = game.settings.get(MODULE, "wallColor");
    const near = (hex) => { const m = Number(typeof hex === "object" ? Number(hex) : parseInt(String(hex).replace("#",""),16)); return Math.abs(((m>>16)&255)-r) + Math.abs(((m>>8)&255)-g) + Math.abs((m&255)-b) < 80; };
    if (near(door))  return "door";
    if (near(win))   return "window";
    if (near(light)) return "light";
    if (near(wall))  return "wall";
    // fallback: dominant channel (orange lights are caught by near() above)
    if (r > g + 40 && r > b + 40) return "door";
    if (b > r + 40 && b > g + 40) return "window";
    return null;
  }
  // Bounding-box center of any drawing — used to place a light at its guide mark.
  static _drawingCenter(d) {
    const p = d.shape?.points;
    if (Array.isArray(p) && p.length >= 2) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < p.length; i += 2) {
        minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
        minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
      }
      return [d.x + (minX + maxX) / 2, d.y + (minY + maxY) / 2];
    }
    return [d.x + (d.shape?.width || 0) / 2, d.y + (d.shape?.height || 0) / 2];
  }

  // The stretches of candidate segment segC that NO existing collinear wall
  // already covers — so a rectangle laid over existing walls doesn't duplicate.
  static _subtractExisting(segC, existing, tol) {
    const a = [segC[0], segC[1]], b = [segC[2], segC[3]], covered = [];
    for (const w of existing) {
      const c = w.c; if (!c || c.length < 4) continue;
      const iv = QuickWalls._overlapInterval(a, b, [c[0], c[1]], [c[2], c[3]], tol);
      if (iv) covered.push(iv);
    }
    if (!covered.length) return [segC];
    covered.sort((x, y) => x.t0 - y.t0);
    const merged = [{ ...covered[0] }];
    for (let i = 1; i < covered.length; i++) {
      const last = merged[merged.length - 1], cur = covered[i];
      if (cur.t0 <= last.t1 + 1e-3) last.t1 = Math.max(last.t1, cur.t1);
      else merged.push({ ...cur });
    }
    const pt = (t) => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    const out = []; let cur = 0;
    for (const iv of merged) {
      if (iv.t0 > cur + 1e-3) out.push([...pt(cur), ...pt(iv.t0)]);
      cur = Math.max(cur, iv.t1);
    }
    if (cur < 1 - 1e-3) out.push([...pt(cur), ...pt(1)]);
    return out;
  }
  // A plain-object copy of an existing wall's data, re-pointed to new endpoints,
  // so a split keeps the original wall's sense/door/flags on its solid pieces.
  static _wallClone(w, c) {
    const o = (typeof w.toObject === "function") ? w.toObject() : foundry.utils.deepClone(w);
    delete o._id; delete o.id;
    o.c = c;
    return o;
  }
  // Ramer-Douglas-Peucker: thin a traced path to its essential points, so a
  // freehand curve becomes a handful of walls, not hundreds of tiny ones.
  static _rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const a = pts[0], b = pts[pts.length - 1];
    let idx = -1, max = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = QuickWalls._project(a, b, pts[i]).dist;
      if (d > max) { max = d; idx = i; }
    }
    if (max > eps && idx > 0) {
      const left = QuickWalls._rdp(pts.slice(0, idx + 1), eps);
      const right = QuickWalls._rdp(pts.slice(idx), eps);
      return left.slice(0, -1).concat(right);
    }
    return [a, b];
  }
  // Sample points around an ellipse drawing (rotation-aware) for a ring of walls.
  static _ellipsePoints(d, grid) {
    const w = d.shape?.width || 0, h = d.shape?.height || 0;
    if (w < 1 || h < 1) return [];
    const cx = d.x + w / 2, cy = d.y + h / 2, rx = w / 2, ry = h / 2;
    const rot = ((d.rotation || 0) * Math.PI) / 180, cos = Math.cos(rot), sin = Math.sin(rot);
    const perim = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
    const n = Math.max(8, Math.min(64, Math.round(perim / (grid * 0.5))));
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * 2 * Math.PI, ex = rx * Math.cos(ang), ey = ry * Math.sin(ang);
      pts.push([cx + ex * cos - ey * sin, cy + ex * sin + ey * cos]);
    }
    return pts;
  }
  // Chain a point list into solid walls of the chosen type, deduped, into `out`.
  static _solidChain(points, closed, existing, dtol, out) {
    const props = QuickWalls._solidProps(QuickWalls._wallType);
    const edges = [];
    for (let i = 0; i + 1 < points.length; i++) edges.push([points[i], points[i + 1]]);
    if (closed && points.length > 2) edges.push([points[points.length - 1], points[0]]);
    let n = 0;
    for (const [a, b] of edges)
      for (const c of QuickWalls._subtractExisting([a[0], a[1], b[0], b[1]], existing, dtol)) {
        out.push({ c: c.map(Math.round), ...props }); n++;
      }
    return n;
  }

  static async build() {
    const scene = canvas.scene;
    if (!scene) { ui.notifications.error("Quick Walls: no active scene."); return; }
    const grid = scene.grid.size || 100, tol = grid * 0.6, dtol = grid * 0.25;
    const drawings = Array.from(scene.drawings);
    const buildings = [], rounds = [], freehandWalls = [], markers = [], lights = [];
    for (const d of drawings) {
      const t = d.shape?.type;
      if (t === "r") buildings.push({ d, x: d.x, y: d.y, w: d.shape.width, h: d.shape.height });
      else if (t === "e") rounds.push({ d });
      else if ((t === "p" || t === "f") && Array.isArray(d.shape.points) && d.shape.points.length >= 2) {
        const p = d.shape.points, kind = QuickWalls._colorKind(d.strokeColor);
        if (kind === "light") lights.push({ c: QuickWalls._drawingCenter(d), id: d.id });
        else if (kind === "wall") freehandWalls.push({ d });
        else if (kind && p.length >= 4) markers.push({ p0: [d.x + p[0], d.y + p[1]], p1: [d.x + p[p.length - 2], d.y + p[p.length - 1]], type: kind, id: d.id });
      }
    }
    const existing = Array.from(scene.walls);
    const wallsToCreate = [], wallsToDelete = [];
    let doors = 0, wins = 0, cutExisting = 0;

    // Pass 1 — cut door/window openings into existing walls the lines sit on,
    // so you can add a missed opening without redrawing the building.
    if (markers.length) for (const w of existing) {
      if (!w.c || w.c.length < 4) continue;
      const segs = QuickWalls._segmentsForEdge(w.c, markers, tol);
      if (!segs.some(s => s.type !== "solid")) continue; // no opening on this wall
      wallsToDelete.push(w.id); cutExisting++;
      for (const s of segs) {
        if (s.type === "door") doors++; else if (s.type === "window") wins++;
        const rc = s.c.map(Math.round);
        wallsToCreate.push(s.type === "solid"
          ? QuickWalls._wallClone(w, rc)
          : { c: rc, ...QuickWalls._wallProps(s.type) });
      }
    }

    // Pass 2 — turn each rectangle into four walls, skipping any stretch an
    // existing wall already covers so overlapping draws don't duplicate.
    for (const b of buildings) for (const e of QuickWalls._rectEdges(b.x, b.y, b.w, b.h)) for (const s of QuickWalls._segmentsForEdge(e, markers, tol)) {
      const pieces = QuickWalls._subtractExisting(s.c, existing, dtol);
      if (!pieces.length) continue;
      if (s.type === "door") doors++; else if (s.type === "window") wins++;
      for (const c of pieces) wallsToCreate.push({ c: c.map(Math.round), ...QuickWalls._wallProps(s.type) });
    }

    // Round buildings — segment each ellipse into a closed ring of walls.
    for (const r of rounds) {
      const pts = QuickWalls._ellipsePoints(r.d, grid);
      if (pts.length >= 3) QuickWalls._solidChain(pts, true, existing, dtol, wallsToCreate);
    }

    // Freehand walls — simplify the traced path, then chain it into walls.
    const simpTol = grid * (game.settings.get(MODULE, "wallSimplify") || 0.33);
    for (const fw of freehandWalls) {
      const d = fw.d, p = d.shape.points, pts = [];
      for (let i = 0; i + 1 < p.length; i += 2) {
        const x = d.x + p[i], y = d.y + p[i + 1], last = pts[pts.length - 1];
        if (!last || Math.hypot(x - last[0], y - last[1]) > 1) pts.push([x, y]);
      }
      if (pts.length < 2) continue;
      const simp = QuickWalls._rdp(pts, simpTol);
      const closed = simp.length > 2 && Math.hypot(simp[0][0] - simp[simp.length - 1][0], simp[0][1] - simp[simp.length - 1][1]) < grid * 0.5;
      QuickWalls._solidChain(closed ? simp.slice(0, -1) : simp, closed, existing, dtol, wallsToCreate);
    }

    // Lights — drop an AmbientLight at each light-colored guide mark.
    const torch = game.settings.get(MODULE, "lightTorch");
    const tint = game.settings.get(MODULE, "lightTint");
    const bright = game.settings.get(MODULE, "lightBright");
    const dim = game.settings.get(MODULE, "lightDim");
    const lightDocs = lights.map(L => ({
      x: Math.round(L.c[0]), y: Math.round(L.c[1]), walls: true,
      config: {
        bright, dim, color: tint || null,
        ...(torch ? { animation: { type: "torch", speed: 3, intensity: 3 } } : {}),
      },
    }));

    if (!wallsToCreate.length && !lightDocs.length) {
      ui.notifications.warn(game.i18n.localize(markers.length ? "QUICKWALLS.NoMatch" : "QUICKWALLS.NoBuildings"));
      return;
    }

    const del = game.settings.get(MODULE, "deleteGuides");
    const rows = [];
    if (wallsToCreate.length) {
      if (buildings.length) rows.push(`<li>${buildings.length} ${game.i18n.localize("QUICKWALLS.Buildings")}</li>`);
      if (rounds.length) rows.push(`<li>${rounds.length} ${game.i18n.localize("QUICKWALLS.RoundBuildings")}</li>`);
      if (freehandWalls.length) rows.push(`<li>${freehandWalls.length} ${game.i18n.localize("QUICKWALLS.FreehandWalls")}</li>`);
      rows.push(`<li>${wallsToCreate.length} ${game.i18n.localize("QUICKWALLS.Walls")}</li>`);
      if (doors || wins) rows.push(`<li>${doors} ${game.i18n.localize("QUICKWALLS.Doors")}, ${wins} ${game.i18n.localize("QUICKWALLS.Windows")}</li>`);
      if (cutExisting) rows.push(`<li>${game.i18n.format("QUICKWALLS.ExistingCut", { n: cutExisting })}</li>`);
    }
    if (lightDocs.length) rows.push(`<li>${lightDocs.length} ${game.i18n.localize("QUICKWALLS.Lights")}</li>`);
    const ok = await Dialog.confirm({
      title: game.i18n.localize("QUICKWALLS.Title"),
      content: `<p><b>${scene.name}</b></p><ul>${rows.join("")}</ul><p>${game.i18n.localize(del ? "QUICKWALLS.ConfirmDelete" : "QUICKWALLS.Confirm")}</p>`,
    });
    if (!ok) return;

    if (wallsToCreate.length) await scene.createEmbeddedDocuments("Wall", wallsToCreate);
    if (wallsToDelete.length) await scene.deleteEmbeddedDocuments("Wall", wallsToDelete);
    if (lightDocs.length) await scene.createEmbeddedDocuments("AmbientLight", lightDocs);
    if (del) {
      const ids = [...new Set([...buildings.map(b => b.d.id), ...rounds.map(r => r.d.id), ...freehandWalls.map(f => f.d.id), ...markers.map(m => m.id), ...lights.map(L => L.id)])];
      if (ids.length) await scene.deleteEmbeddedDocuments("Drawing", ids);
    }
    let msg = wallsToCreate.length ? game.i18n.format("QUICKWALLS.Done", { walls: wallsToCreate.length, doors, windows: wins }) : "";
    if (lightDocs.length) {
      const lmsg = game.i18n.format("QUICKWALLS.DoneLights", { lights: lightDocs.length });
      msg = msg ? `${msg} ${lmsg}` : lmsg;
    }
    ui.notifications.info(msg);
  }
}

// Expose a tiny API for macros/other modules
Hooks.once("ready", () => {
  game.modules.get(MODULE).api = { toggle: () => QuickWalls.toggle(), build: () => QuickWalls.build() };
});
