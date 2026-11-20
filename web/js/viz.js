// Räumliche Ansichten: Ringe, Achsen, Netz, Kreis-Bereiche – dazu der Zeitregler.
import { S, h, icon, GET, POST, PUT, PATCH, clear, invalidate, avatar, circleChip, nameEl, rel, ringName, menu, toast, rows, RING,
  circleColors, kindColors, initials, daysSince, today, qs, reloadCircles, pickCircle, modal, popover, closePop } from "./core.js";
import { VS, filterRows, newCircle } from "./desktop.js";
import { setRing, bundKindName } from "./shared.js";

const NS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => h(tag, attrs, ...kids);
const LS = (k, d) => { try { return JSON.parse(localStorage.getItem("syn." + k)) ?? d; } catch (_) { return d; } };
const SAVE = (k, v) => { try { localStorage.setItem("syn." + k, JSON.stringify(v)); } catch (_) {} };

function svgPoint(svg, e) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); }

function node(r, x, y, size = 15, { approx = false, sel = false } = {}) {
  const cc = r.is_self ? { bg: "#16181D", fg: "#fff" } : circleColors(r.main_circle_id);
  const unsure = !r.is_self && (!r.name || r.name_uncertain);
  const g = s("g.node", { transform: `translate(${x},${y})`, "data-id": r.id });
  g.append(s("circle", { r: size, fill: unsure ? "#fff" : cc.bg, stroke: sel ? "#16181D" : unsure || approx ? cc.fg : "#fff", "stroke-width": sel ? 2.5 : 1.5, "stroke-dasharray": unsure || approx ? "3 2" : null }));
  if (r.avatar) {
    const id = "clip" + r.id;
    g.append(s("clipPath", { id }, s("circle", { r: size - 1 })), s("image", { href: r.avatar, x: -size, y: -size, width: size * 2, height: size * 2, "clip-path": `url(#${id})`, preserveAspectRatio: "xMidYMid slice" }));
  } else g.append(s("text", { "text-anchor": "middle", dy: "0.35em", "font-size": size * 0.72, "font-weight": 600, fill: r.is_self ? "#fff" : cc.fg }, r.is_self ? "Du" : !r.name ? "?" : initials(r.name)));
  return g;
}

function tip(box, r, x, y, extra = []) {
  box.querySelector(".tip")?.remove();
  const t = h("div.tip", { style: { left: Math.min(x + 14, box.clientWidth - 200) + "px", top: Math.min(y + 14, box.clientHeight - 110) + "px" } },
    h("b", r.display), h("div.small.t2", [S.settings.use_levels ? ringName(r.level) : null, r.bund_kind ? bundKindName(r.bund_kind) : null].filter(Boolean).join(" · ")),
    h("div.small.t2", r.v.f_seen ? "Zuletzt gesehen: " + rel(r.v.f_seen.raw) : "noch nicht gesehen"), h("a.small", { href: "#/p/" + r.id }, "Profil öffnen →"));
  box.append(t);
  return t;
}

// ---------------------------------------------------------------- Zeitregler
async function timeSlider(onChange) {
  const range = await GET("/timeline/range");
  const d0 = new Date(range.from + "T12:00:00"), d1 = new Date(range.to + "T12:00:00");
  const days = Math.max(1, Math.round((d1 - d0) / 86400000));
  const lab = h("span.mono", { style: { width: "90px" } }, "heute");
  const inp = h("input", { type: "range", min: 0, max: days, value: days });
  const apply = () => {
    const d = new Date(d0.getTime() + +inp.value * 86400000);
    const iso = d.toISOString().slice(0, 10);
    const isToday = +inp.value === days;
    lab.textContent = isToday ? "heute" : iso;
    onChange(isToday ? null : iso);
  };
  inp.addEventListener("change", apply);
  inp.addEventListener("input", () => { const d = new Date(d0.getTime() + +inp.value * 86400000); lab.textContent = +inp.value === days ? "heute" : d.toISOString().slice(0, 10); });
  return h("div.timebar", icon("clock"), h("span.small.t2", "Zeitregler"), h("span.mono.t3.small", range.from), inp, lab,
    h("span.tiny.t3", { title: "Ohne „Gültig von“ zählt das Erfasst-Datum – solche Punkte sind gestrichelt" }, "ungefähr = gestrichelt"));
}

// ---------------------------------------------------------------- Ringe
export async function rings(body, list0, all) {
  const opt = Object.assign({ dist: "level", sector: "kind", pets: true }, LS("ringopt", {}));
  let at = null, data = list0;
  const vizBox = h("div.viz", { style: { height: "calc(100vh - 230px)", minHeight: "460px" } });
  const side = h("div.col", { style: { gap: "16px" } });
  const wrap = h("div.col", { style: { gap: 0 } }, vizBox, await timeSlider(async (d) => { at = d; data = d ? filterRows(await GET("/entities" + qs({ at: d }))) : list0; draw(); }));
  body.append(h("div.split", wrap, side));
  const draw = () => {
    const list = data.filter((r) => !r.is_self && (opt.pets || r.kind !== "pet"));
    const lvl = (r) => (opt.dist === "ist" ? r.ist?.ring : r.level);
    const placed = list.filter((r) => lvl(r) != null), unplaced = list.filter((r) => lvl(r) == null);
    const W = 760, Hh = 760, cx = W / 2, cy = Hh / 2, R = 330, band = R / 4;
    const svg = s("svg", { viewBox: `0 0 ${W} ${Hh}` });
    // Sektoren
    const keyOf = (r) => (opt.sector === "kind" ? (S.circles[r.main_circle_id]?.kind_id || "_lose") : (r.main_circle_id || "_lose"));
    const groups = {};
    for (const r of placed) (groups[keyOf(r)] ||= []).push(r);
    const keys = Object.keys(groups).sort((a, b) => (a === "_lose") - (b === "_lose") || a.localeCompare(b));
    const total = placed.length || 1, minShare = 0.07;
    let shares = keys.map((k) => Math.max(minShare, groups[k].length / total));
    const sum = shares.reduce((a, b) => a + b, 0) || 1; shares = shares.map((x) => x / sum);
    for (let i = 4; i >= 1; i--) svg.append(s("circle", { cx, cy, r: band * i, fill: i <= 2 ? (i === 1 ? "#F4F5F7" : "#FAFAFB") : "#fff", stroke: "#E3E5EA" }));
    for (let i = 1; i <= 4; i++) svg.append(s("text", { x: cx + 4, y: cy - band * i + 14, class: "label-mono" }, `${i} · ${RING()[i]}`));
    let a0 = -Math.PI / 2;
    const sectors = [];
    keys.forEach((k, i) => {
      const a1 = a0 + shares[i] * Math.PI * 2;
      sectors.push({ k, a0, a1 });
      if (keys.length > 1) svg.append(s("line", { x1: cx, y1: cy, x2: cx + Math.cos(a0) * R, y2: cy + Math.sin(a0) * R, stroke: "#E3E5EA" }));
      const am = (a0 + a1) / 2;
      const col = k === "_lose" ? S.lose : opt.sector === "kind" ? kindColors(k) : circleColors(k);
      const label = (k === "_lose" ? "Lose" : opt.sector === "kind" ? S.kinds[k]?.name : S.circles[k]?.name) + " · " + groups[k].length;
      const lx = cx + Math.cos(am) * (R + 22), ly = cy + Math.sin(am) * (R + 22);
      const tw = label.length * 6.4 + 16;
      svg.append(s("g", { transform: `translate(${lx - tw / 2},${ly - 10})` }, s("rect", { width: tw, height: 20, rx: 10, fill: col.bg }), s("text", { x: tw / 2, y: 14, "text-anchor": "middle", "font-size": 11, "font-weight": 500, fill: col.fg }, label)));
      // Personen im Sektor verteilen
      for (let l = 1; l <= 4; l++) {
        const ps = groups[k].filter((r) => lvl(r) === l);
        const rr = band * (l - 0.5);
        const span = a1 - a0;
        const perRow = Math.max(1, Math.floor((span * rr) / 34));
        ps.forEach((r, j) => {
          const row = Math.floor(j / perRow), idx = j % perRow, inRow = Math.min(perRow, ps.length - row * perRow);
          const a = a0 + (span * (idx + 1)) / (inRow + 1);
          const rad = rr + (row % 2 ? 14 : row ? -14 : 0) * Math.ceil(row / 2);
          r._x = cx + Math.cos(a) * rad; r._y = cy + Math.sin(a) * rad;
        });
      }
      a0 = a1;
    });
    const nodes = s("g");
    for (const r of placed) nodes.append(node(r, r._x, r._y, 15, { approx: at && r.approx_created }));
    svg.append(nodes, node({ is_self: true, display: "Du" }, cx, cy, 20));
    clear(vizBox, svg);
    // Ziehen: Abstand = Ring, Sektor = Kreis-Art des Hauptkreises
    let drag = null;
    nodes.addEventListener("pointerdown", (e) => {
      const g = e.target.closest(".node"); if (!g || at) return;
      drag = { g, r: placed.find((x) => x.id === g.dataset.id), moved: false }; g.setPointerCapture(e.pointerId);
    });
    nodes.addEventListener("pointermove", (e) => {
      if (!drag) { const g = e.target.closest(".node"); if (g) { const b = vizBox.getBoundingClientRect(); tip(vizBox, placed.find((x) => x.id === g.dataset.id), e.clientX - b.left, e.clientY - b.top); } return; }
      const p = svgPoint(svg, e); drag.moved = true; drag.g.setAttribute("transform", `translate(${p.x},${p.y})`); drag.p = p;
    });
    nodes.addEventListener("pointerup", async (e) => {
      if (!drag) return; const d = drag; drag = null;
      if (!d.moved) { location.hash = "#/p/" + d.r.id; return; }
      await dropAt(d.r, d.p);
    });
    const dropAt = async (r, p) => {
      const dist = Math.hypot(p.x - cx, p.y - cy);
      const level = dist > R ? null : Math.min(4, Math.max(1, Math.ceil(dist / band)));
      let ang = Math.atan2(p.y - cy, p.x - cx); if (ang < -Math.PI / 2) ang += Math.PI * 2;
      const sec = sectors.find((x) => ang >= x.a0 && ang < x.a1);
      if (opt.dist === "level" && level !== r.level) { await setRing(r.id, level); r.level = level; toast(`${r.display}: ${level ? ringName(level) : "ohne Ring"}`); }
      invalidate(); draw();
      if (sec && dist <= R && sec.k !== keyOf(r) && sec.k !== "_lose") { await moveSector(r, sec.k); invalidate(); draw(); }
    };
    svg.addEventListener("dragover", (e) => e.preventDefault());
    svg.addEventListener("drop", async (e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/syn-id"); const r = list.find((x) => x.id === id); if (r) { r.level = null; await dropAt(r, svgPoint(svg, e)); } });
    vizBox.addEventListener("mouseleave", () => vizBox.querySelector(".tip")?.remove());
    // Seitenleiste: Ohne Ring + Ansicht
    clear(side,
      h("div.card", h("div.card-h", h("h3", "Ohne Ring"), h("span.small.t2", unplaced.length)),
        h("div.card-b.col", h("p.small.t2", "Ins Diagramm ziehen. Der Abstand setzt den Ring, der Sektor den Kreis."),
          unplaced.slice(0, 40).map((r) => h("div.row", { draggable: true, style: { cursor: "grab", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: "10px" },
            on: { dragstart: (e) => e.dataTransfer.setData("text/syn-id", r.id) } }, avatar(r, 26), h("div.grow", h("div", nameEl(r)), h("div.tiny.t2", r.main_circle_id ? S.circles[r.main_circle_id]?.name : "erfasst " + rel(r.created_at.slice(0, 10))))))),
        unplaced.length > 40 ? h("div.small.t3", `… und ${unplaced.length - 40} weitere`) : null),
      h("div.card", h("div.card-h", h("h3", "Ansicht")), h("div.card-b.col",
        h("div.row.between", h("span", "Mitte"), h("span.chip.plain", "Du")),
        h("div.row.between", h("span", "Abstand"), h("select.input", { style: { height: "28px" }, on: { change: (e) => { opt.dist = e.target.value; SAVE("ringopt", opt); draw(); } } },
          h("option", { value: "level", selected: opt.dist === "level" }, "Ring"), S.settings.use_ist ? h("option", { value: "ist", selected: opt.dist === "ist" }, "Ist (berechnet)") : null)),
        h("div.row.between", h("span", "Sektoren"), h("select.input", { style: { height: "28px" }, on: { change: (e) => { opt.sector = e.target.value; SAVE("ringopt", opt); draw(); } } },
          h("option", { value: "kind", selected: opt.sector === "kind" }, "Kreis-Art"), h("option", { value: "circle", selected: opt.sector === "circle" }, "Hauptkreis"))),
        h("label.check.between", h("span.grow", "Haustiere zeigen"), h("input", { type: "checkbox", checked: opt.pets, on: { change: (e) => { opt.pets = e.target.checked; SAVE("ringopt", opt); draw(); } } })),
        at ? h("div.hint", "Stand vom ", h("b.mono", at), " – Ziehen ist im Rückblick aus.") : null)));
  };
  async function moveSector(r, k) {
    if (k === "_lose") return;
    const cid = opt.sector === "kind" ? null : k;
    if (cid) { await POST("/bulk", { ids: [r.id], op: "main_circle", value: cid }); r.main_circle_id = cid; return; }
    const own = r.circles.find((c) => S.circles[c]?.kind_id === k);
    if (own) { await PATCH("/entities/" + r.id, { main_circle_id: own }); r.main_circle_id = own; toast(`Hauptkreis: ${S.circles[own].name}`); return; }
    const options = Object.values(S.circles).filter((c) => c.kind_id === k);
    await new Promise((res) => {
      menu(null, [{ label: `${r.display} in einen Kreis der Art ${S.kinds[k]?.name}:` }, ...options.map((c) => ({ label: c.name, action: async () => { await POST("/bulk", { ids: [r.id], op: "main_circle", value: c.id }); r.main_circle_id = c.id; res(); } })),
        { label: "Neuen Kreis anlegen …", icon: "plus", action: async () => { closePop(); await newCircle({ members: [r.id] }); res(); } }], { x: innerWidth / 2 - 100, y: innerHeight / 3 });
    });
  }
  draw();
}

// ---------------------------------------------------------------- Achsen
const AX_SPECIAL = { f_level: { label: "Ring", kind: "ring" }, ist: { label: "Ist (berechnet)", kind: "ring", locked: true }, created: { label: "Erfasst", kind: "date", locked: true } };
function axisOptions() {
  const o = {};
  if (S.settings.use_levels) o.f_level = AX_SPECIAL.f_level;
  if (S.settings.use_ist) o.ist = AX_SPECIAL.ist;
  for (const f of S.fieldList) if ((f.type === "date" || f.type === "number") && f.id !== "f_level" && f.scope !== "kreis") o[f.id] = { label: f.name, kind: f.type === "date" ? "date" : "number" };
  o.created = AX_SPECIAL.created;
  return o;
}
function axVal(r, key, kind) {
  if (key === "f_level") return r.level;
  if (key === "ist") return r.ist?.ring;
  if (key === "created") return daysSince(r.created_at?.slice(0, 10));
  const raw = r.v[key]?.raw; if (raw == null) return null;
  return kind === "date" ? daysSince(raw) : +raw;
}

export async function axes(body, list0) {
  const opts = axisOptions();
  const cfg = Object.assign({ x: S.settings.use_levels ? "f_level" : Object.keys(opts)[0], y: "f_seen", zoneRing: 2, zoneDays: 30 }, LS("axes", {}), VS.cfg.axes || {});
  const box = h("div.viz", { style: { height: "calc(100vh - 230px)", minHeight: "440px" } });
  const side = h("div.col", { style: { gap: "16px" } });
  body.append(h("div.split", box, side));
  const draw = () => {
    SAVE("axes", cfg); VS.cfg.axes = cfg;
    const X = opts[cfg.x], Y = opts[cfg.y];
    const list = list0.filter((r) => !r.is_self);
    const pts = list.map((r) => ({ r, x: axVal(r, cfg.x, X?.kind), y: axVal(r, cfg.y, Y?.kind) }));
    const shown = pts.filter((p) => p.x != null && p.y != null), missing = pts.filter((p) => p.x == null || p.y == null);
    const W = 900, H = 600, m = { l: 70, r: 20, t: 40, b: 50 };
    const dom = (k, kind, vals) => kind === "ring" ? [0.5, 4.5] : (() => { const v = vals.filter((x) => x != null); let a = Math.min(0, ...v), b = Math.max(1, ...v); if (kind === "date") a = Math.min(0, a); return [a, b + (b - a) * 0.05]; })();
    const dx = dom(cfg.x, X?.kind, shown.map((p) => p.x)), dy = dom(cfg.y, Y?.kind, shown.map((p) => p.y));
    const sx = (v) => m.l + ((v - dx[0]) / (dx[1] - dx[0])) * (W - m.l - m.r);
    const sy = (v) => H - m.b - ((v - dy[0]) / (dy[1] - dy[0])) * (H - m.t - m.b);
    const ix = (px) => dx[0] + ((px - m.l) / (W - m.l - m.r)) * (dx[1] - dx[0]);
    const iy = (py) => dy[0] + ((H - m.b - py) / (H - m.t - m.b)) * (dy[1] - dy[0]);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}` });
    // Zone „nah, aber lange nicht gesehen“
    const ringAx = cfg.x === "f_level" || cfg.x === "ist" ? "x" : cfg.y === "f_level" || cfg.y === "ist" ? "y" : null;
    const seenAx = cfg.y === "f_seen" ? "y" : cfg.x === "f_seen" ? "x" : null;
    if (ringAx && seenAx) {
      const rx = ringAx === "x" ? [sx(0.5), sx(cfg.zoneRing + 0.5)] : [sx(cfg.zoneDays), sx(dx[1])];
      const ry = ringAx === "y" ? [sy(cfg.zoneRing + 0.5), sy(0.5)] : [sy(dy[1]), sy(cfg.zoneDays)];
      svg.append(s("rect", { x: Math.min(...rx), y: Math.min(...ry), width: Math.abs(rx[1] - rx[0]), height: Math.abs(ry[1] - ry[0]), fill: "#FFF6CC", stroke: "#D4A800", "stroke-dasharray": "5 4", rx: 8 }),
        s("text", { x: Math.min(...rx) + 8, y: Math.min(...ry) + 18, "font-size": 11.5, fill: "#16181D", "font-weight": 600 }, "nah, aber lange nicht gesehen"));
    }
    // Achsen
    svg.append(s("line", { x1: m.l, y1: H - m.b, x2: W - m.r, y2: H - m.b, stroke: "#8A8F99" }), s("line", { x1: m.l, y1: m.t, x2: m.l, y2: H - m.b, stroke: "#8A8F99" }));
    const ticks = (kind, d) => kind === "ring" ? [1, 2, 3, 4] : Array.from({ length: 6 }, (_, i) => Math.round(d[0] + ((d[1] - d[0]) * i) / 5));
    const tl = (kind, v) => kind === "ring" ? `${v} · ${RING()[v]}` : kind === "date" ? (v === 0 ? "heute" : `vor ${v} T`) : v;
    for (const v of ticks(X?.kind, dx)) svg.append(s("text", { x: sx(v), y: H - m.b + 18, "text-anchor": "middle", class: "label-mono" }, tl(X?.kind, v)), s("line", { x1: sx(v), x2: sx(v), y1: m.t, y2: H - m.b, stroke: "#F0F1F4" }));
    for (const v of ticks(Y?.kind, dy)) svg.append(s("text", { x: m.l - 8, y: sy(v) + 4, "text-anchor": "end", class: "label-mono" }, tl(Y?.kind, v)), s("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), stroke: "#F0F1F4" }));
    svg.append(s("text", { x: W - m.r, y: H - 10, "text-anchor": "end", "font-size": 12, fill: "#5B606B" }, X?.label + (X?.locked ? " (berechnet)" : "")),
      s("text", { x: m.l, y: m.t - 18, "font-size": 12, fill: "#5B606B" }, Y?.label + (Y?.locked ? " (berechnet)" : "")));
    const g = s("g");
    // Kollisionen leicht verteilen
    const seen = {};
    for (const p of shown) { const k = Math.round(sx(p.x) / 8) + ":" + Math.round(sy(p.y) / 8); const n = (seen[k] = (seen[k] || 0) + 1) - 1; p.px = sx(p.x) + (n % 3) * 12 - (n ? 12 : 0); p.py = sy(p.y) - Math.floor(n / 3) * 12; g.append(node(p.r, p.px, p.py, 13)); }
    svg.append(g);
    clear(box, svg);
    const locked = X?.locked || Y?.locked;
    let drag = null;
    g.addEventListener("pointerdown", (e) => { const n = e.target.closest(".node"); if (!n) return; drag = { n, p: shown.find((x) => x.r.id === n.dataset.id), moved: false }; n.setPointerCapture(e.pointerId); });
    g.addEventListener("pointermove", (e) => {
      if (!drag) { const n = e.target.closest(".node"); if (n) { const b = box.getBoundingClientRect(); tip(box, shown.find((x) => x.r.id === n.dataset.id).r, e.clientX - b.left, e.clientY - b.top); } return; }
      if (locked) return; const pt = svgPoint(svg, e); drag.moved = true; drag.pt = pt; drag.n.setAttribute("transform", `translate(${pt.x},${pt.y})`);
    });
    g.addEventListener("pointerup", async () => {
      if (!drag) return; const d = drag; drag = null;
      if (!d.moved) { if (locked) toast("Berechnete Werte sind gesperrt – nur Felder, die man von Hand setzt, lassen sich ziehen"); location.hash = "#/p/" + d.p.r.id; return; }
      const cells = [];
      const conv = (key, kind, v) => key === "f_level" ? Math.min(4, Math.max(1, Math.round(v))) : kind === "date" ? new Date(Date.now() - Math.max(0, Math.round(v)) * 86400000).toISOString().slice(0, 10) : Math.round(v * 10) / 10;
      cells.push({ id: d.p.r.id, field: cfg.x, value: conv(cfg.x, X.kind, ix(d.pt.x)) }, { id: d.p.r.id, field: cfg.y, value: conv(cfg.y, Y.kind, iy(d.pt.y)) });
      await POST("/bulk/cells", { cells });
      const fresh = (await rows(true)).find((x) => x.id === d.p.r.id); if (fresh) Object.assign(d.p.r, fresh);
      draw();
    });
    box.addEventListener("mouseleave", () => box.querySelector(".tip")?.remove());
    const sel = (key) => h("select.input", { style: { height: "28px" }, on: { change: (e) => { cfg[key] = e.target.value; draw(); } } }, Object.entries(opts).map(([k, o]) => h("option", { value: k, selected: cfg[key] === k }, o.label + (o.locked ? " 🔒" : ""))));
    clear(side, h("div.card", h("div.card-h", h("h3", "Achsen")), h("div.card-b.col",
      h("label.f", "X-Achse", sel("x")), h("label.f", "Y-Achse", sel("y")),
      h("p.small.t3", "Ziehen setzt beide Werte. Berechnete Werte (Ist, Erfasst) sind gesperrt."),
      missing.length ? h("p.small.t2", `${missing.length} ohne Wert auf einer Achse – nicht gezeigt.`) : null)),
      ringAx && seenAx ? h("div.card", h("div.card-h", h("h3", "Gelbe Zone")), h("div.card-b.col",
        h("label.f", "Ring höchstens", h("input.input", { type: "number", min: 1, max: 4, value: cfg.zoneRing, on: { change: (e) => { cfg.zoneRing = +e.target.value; draw(); } } })),
        h("label.f", "Länger nicht gesehen als (Tage)", h("input.input", { type: "number", value: cfg.zoneDays, on: { change: (e) => { cfg.zoneDays = +e.target.value; draw(); } } })),
        h("div.small", `${shown.filter((p) => (ringAx === "x" ? p.x : p.y) <= cfg.zoneRing && (seenAx === "y" ? p.y : p.x) > cfg.zoneDays).length} Personen in der Zone`),
        h("button.btn.sm", { on: { click: async () => {
          const r = await POST("/routines", { name: `Nah, aber ${cfg.zoneDays} Tage nicht gesehen`, trigger: { type: "schedule", every: "weekly", weekday: 0, time: "08:00" },
            conditions: [{ field: cfg.x === "ist" || cfg.y === "ist" ? "ist" : "f_level", op: "<=", value: cfg.zoneRing }, { field: "f_seen", op: "days_since_gt", value: cfg.zoneDays }],
            actions: [{ type: "list", title: "Lange nicht gesehen" }] });
          toast("Als wöchentliche Routine gespeichert"); location.hash = "#/settings/routines?r=" + r.id;
        } } }, icon("zap"), "Zone als Routine speichern"))) : null);
  };
  draw();
}

// ---------------------------------------------------------------- Netz
export async function net(body, list0) {
  const opt = Object.assign({ self: false }, LS("netopt", {}));
  const bunds = await GET("/bunds");
  let sugg = await GET("/suggestions/circles");
  const box = h("div.viz", { style: { height: "calc(100vh - 230px)", minHeight: "460px" } });
  const side = h("div.col", { style: { gap: "16px" } });
  let at = null, data = list0;
  body.append(h("div.split", h("div.col", { style: { gap: 0 } }, box, await timeSlider(async (d) => { at = d; data = d ? filterRows(await GET("/entities" + qs({ at: d }))) : list0; layout(); draw(); })), side));
  const W = 1000, H = 700;
  let nodes = [], links = [], pos = LS("netpos", {});
  const layout = () => {
    nodes = data.filter((r) => opt.self || !r.is_self);
    const ids = new Set(nodes.map((n) => n.id));
    links = bunds.filter((b) => ids.has(b.a_id) && ids.has(b.b_id)).map((b) => ({ a: b.a_id, b: b.b_id, kind: b.kind_id }));
    const P = {};
    nodes.forEach((n, i) => { P[n.id] = pos[n.id] ? { ...pos[n.id] } : { x: W / 2 + Math.cos(i * 2.4) * (60 + i * 3), y: H / 2 + Math.sin(i * 2.4) * (60 + i * 3) }; });
    // Kreis-Anziehung: Mitglieder desselben Hauptkreises zueinander
    const fresh = nodes.some((n) => !pos[n.id]);
    for (let it = 0; it < 300; it++) {
      const k = 1 - it / 300 + 0.05;
      for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
        const A = P[nodes[i].id], B = P[nodes[j].id]; let dx = A.x - B.x, dy = A.y - B.y; const d2 = dx * dx + dy * dy || 1;
        if (d2 > 250000) continue; const d = Math.sqrt(d2); const f = Math.min(30, 5000 / d2) * k; dx /= d; dy /= d;
        A.x += dx * f; A.y += dy * f; B.x -= dx * f; B.y -= dy * f;
      }
      for (const l of links) { const A = P[l.a], B = P[l.b]; const dx = B.x - A.x, dy = B.y - A.y; const d = Math.hypot(dx, dy) || 1; const f = (d - 90) * 0.03 * k; A.x += (dx / d) * f; A.y += (dy / d) * f; B.x -= (dx / d) * f; B.y -= (dy / d) * f; }
      const cent = {};
      for (const n of nodes) if (n.main_circle_id) { const c = (cent[n.main_circle_id] ||= { x: 0, y: 0, n: 0 }); c.x += P[n.id].x; c.y += P[n.id].y; c.n++; }
      for (const n of nodes) { const c = cent[n.main_circle_id]; const p = P[n.id]; if (c) { p.x += (c.x / c.n - p.x) * 0.05 * k; p.y += (c.y / c.n - p.y) * 0.05 * k; } p.x += (W / 2 - p.x) * 0.002; p.y += (H / 2 - p.y) * 0.002; }
    }
    if (fresh) {
      // auf die Fläche einpassen
      const xs = nodes.map((n) => P[n.id].x), ys = nodes.map((n) => P[n.id].y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const sc = Math.min((W - 140) / Math.max(1, x1 - x0), (H - 140) / Math.max(1, y1 - y0), 3);
      for (const n of nodes) { P[n.id] = { x: W / 2 + (P[n.id].x - (x0 + x1) / 2) * sc, y: H / 2 + (P[n.id].y - (y0 + y1) / 2) * sc }; }
    }
    for (const n of nodes) { P[n.id].x = Math.max(30, Math.min(W - 30, P[n.id].x)); P[n.id].y = Math.max(30, Math.min(H - 30, P[n.id].y)); }
    for (const n of nodes) if (!pos[n.id]) pos[n.id] = P[n.id]; else pos[n.id] = P[n.id];
  };
  const hull = (pts) => {
    if (pts.length < 3) return pts;
    pts = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
    const cr = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  };
  let areas = [];
  const draw = () => {
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}` });
    const gA = s("g"), gL = s("g"), gN = s("g");
    // Kreise als Flächen
    areas = [];
    for (const c of Object.values(S.circles)) {
      const mem = nodes.filter((n) => n.circles_all.includes(c.id));
      if (mem.length < 2) continue;
      const pts = hull(mem.map((n) => pos[n.id]));
      const col = circleColors(c.id);
      const d = pts.length === 2 ? `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}` : "M" + pts.map((p) => `${p.x},${p.y}`).join("L") + "Z";
      gA.append(s("path", { d, fill: col.bg, stroke: col.bg, "stroke-width": 46, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: 0.75, "data-circle": c.id }));
      const top = pts.reduce((a, b) => (b.y < a.y ? b : a));
      let ly = top.y - 26;
      while (areas.some((o) => Math.abs(o.lx - top.x) < 90 && Math.abs(o.ly - ly) < 13)) ly -= 14;
      areas.lastLabel = { lx: top.x, ly };
      gA.append(s("text", { x: top.x, y: ly, "text-anchor": "middle", "font-size": 11, "font-weight": 600, fill: col.fg }, c.name));
      areas.push({ id: c.id, pts, mem, lx: top.x, ly });
    }
    // Vorschläge gestrichelt
    for (const sg of sugg) {
      const mem = nodes.filter((n) => sg.members.includes(n.id)); if (mem.length < 2) continue;
      const pts = hull(mem.map((n) => pos[n.id]));
      gA.append(s("path", { d: "M" + pts.map((p) => `${p.x},${p.y}`).join("L") + "Z", fill: "none", stroke: "#D4A800", "stroke-width": 1.5, "stroke-dasharray": "6 5", transform: "", "stroke-linejoin": "round" }));
    }
    for (const l of links) gL.append(s("line", { x1: pos[l.a].x, y1: pos[l.a].y, x2: pos[l.b].x, y2: pos[l.b].y, stroke: "#8A8F99", "stroke-width": 1.2, "data-a": l.a, "data-b": l.b }));
    for (const n of nodes) gN.append(node(n, pos[n.id].x, pos[n.id].y, 14, { approx: at && n.approx_created }));
    svg.append(gA, gL, gN);
    clear(box, svg);
    let drag = null;
    gN.addEventListener("pointerdown", (e) => { const g = e.target.closest(".node"); if (!g) return; drag = { g, id: g.dataset.id, moved: false }; g.setPointerCapture(e.pointerId); });
    gN.addEventListener("pointermove", (e) => {
      if (!drag) { const g = e.target.closest(".node"); if (g) { const b = box.getBoundingClientRect(); tip(box, nodes.find((x) => x.id === g.dataset.id), e.clientX - b.left, e.clientY - b.top); } return; }
      const p = svgPoint(svg, e); drag.moved = true; pos[drag.id] = { x: p.x, y: p.y }; drag.g.setAttribute("transform", `translate(${p.x},${p.y})`);
      for (const ln of gL.children) { if (ln.dataset.a === drag.id) { ln.setAttribute("x1", p.x); ln.setAttribute("y1", p.y); } if (ln.dataset.b === drag.id) { ln.setAttribute("x2", p.x); ln.setAttribute("y2", p.y); } }
    });
    gN.addEventListener("pointerup", async (e) => {
      if (!drag) return; const d = drag; drag = null; SAVE("netpos", pos);
      if (!d.moved) { location.hash = "#/p/" + d.id; return; }
      // Fallenlassen auf einem Kreis macht zum Mitglied
      const n = nodes.find((x) => x.id === d.id); const p = pos[d.id];
      const hit = areas.find((a) => !n.circles_all.includes(a.id) && inside(p, a.pts));
      if (hit && !at) { await POST(`/circles/${hit.id}/members`, { entity_id: d.id }); toast(`${n.display} ist jetzt in ${S.circles[hit.id].name}`); invalidate(); n.circles_all.push(hit.id); n.circles.push(hit.id); if (!n.main_circle_id) n.main_circle_id = hit.id; draw(); }
      else draw();
    });
    box.addEventListener("mouseleave", () => box.querySelector(".tip")?.remove());
    drawSide();
  };
  const inside = (p, pts) => {
    if (pts.length < 3) return pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 30);
    const cx = pts.reduce((a, b) => a + b.x, 0) / pts.length, cy = pts.reduce((a, b) => a + b.y, 0) / pts.length;
    const grown = pts.map((q) => ({ x: q.x + (q.x - cx) * 0.25 + Math.sign(q.x - cx) * 20, y: q.y + (q.y - cy) * 0.25 + Math.sign(q.y - cy) * 20 }));
    let c = false; for (let i = 0, j = grown.length - 1; i < grown.length; j = i++) { const a = grown[i], b = grown[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c;
  };
  const drawSide = () => clear(side,
    sugg.length ? h("div.card", h("div.card-h", h("h3", "Vorschläge"), h("span.tag.yellow", sugg.length)), h("div.card-b.col", sugg.map((sg) => h("div.col", { style: { gap: "6px", borderBottom: "1px solid var(--line)", paddingBottom: "8px" } },
      h("div", h("b", sg.member_names.join(", ")), " als Kreis anlegen?"), h("div.small.t2", "Grund: " + sg.reason),
      h("div.row", h("button.btn.sm.primary", { on: { click: async () => { const n = await (await import("./core.js")).promptDlg("Kreis anlegen", "Name", sg.name); if (!n) return; await POST("/suggestions/circles/accept", { ...sg, name: n }); await reloadCircles(); invalidate(); sugg = await GET("/suggestions/circles"); data = filterRows(await rows(true)); layout(); draw(); } } }, "Anlegen"),
        h("button.btn.sm.ghost", { on: { click: async () => { await POST("/suggestions/circles/dismiss", sg); sugg = sugg.filter((x) => x !== sg); draw(); } } }, "Nein")))))) : null,
    h("div.card", h("div.card-h", h("h3", "Ansicht")), h("div.card-b.col",
      h("p.small.t2", "Punkte = Personen, Linien = Bünde, Flächen = Kreise. Fallenlassen auf einem Kreis macht zum Mitglied."),
      h("label.check", h("input", { type: "checkbox", checked: opt.self, on: { change: (e) => { opt.self = e.target.checked; SAVE("netopt", opt); layout(); draw(); } } }), "Dich zeigen"),
      h("button.btn.sm", { on: { click: () => { pos = {}; SAVE("netpos", {}); layout(); draw(); } } }, icon("refresh"), "Neu anordnen"))));
  layout(); draw();
}

// ---------------------------------------------------------------- Kreise als Bereiche
export async function areas(page, all) {
  await reloadCircles();
  const cs = Object.values(S.circles);
  const wrap = h("div.row.wrap", { style: { alignItems: "flex-start", gap: "14px" } });
  const area = (c, small = false) => {
    const col = circleColors(c.id);
    const direct = all.filter((r) => r.circles.includes(c.id));
    const el = h("div", { style: { background: col.bg, borderRadius: "16px", padding: "12px", minWidth: small ? "160px" : "240px", flex: small ? "1" : "0 1 360px", border: "1px solid transparent" },
      on: { dragover: (e) => { e.preventDefault(); el.style.borderColor = col.fg; }, dragleave: () => (el.style.borderColor = "transparent"), drop: async (e) => {
        e.preventDefault(); e.stopPropagation(); el.style.borderColor = "transparent";
        const [id, from] = e.dataTransfer.getData("text/plain").split("|");
        if (!id || from === c.id) return;
        await POST(`/circles/${c.id}/members`, { entity_id: id });
        toast(`Zu ${c.name} hinzugefügt`); invalidate(); location.reload();
      } } },
      h("div.row", h("a", { href: "#/c/" + c.id, style: { color: col.fg, fontWeight: 600, textDecoration: "none" } }, c.name), h("span.small", { style: { color: col.fg } }, c.count)),
      h("div.row.wrap", { style: { gap: "6px", marginTop: "8px" } }, direct.map((r) => h("a", { href: "#/p/" + r.id, draggable: true, title: r.display,
        on: { dragstart: (e) => e.dataTransfer.setData("text/plain", r.id + "|" + c.id) } }, avatar(r, 30)))),
      h("div.row.wrap", { style: { gap: "8px", marginTop: "8px" } }, cs.filter((x) => x.parent_id === c.id).map((x) => area(x, true))));
    return el;
  };
  const lose = all.filter((r) => !r.is_self && !r.circles.length);
  const loseEl = h("div", { style: { background: S.lose.bg, borderRadius: "16px", padding: "12px", flex: "0 1 360px", border: "1px dashed var(--text3)" },
    on: { dragover: (e) => e.preventDefault(), drop: async (e) => {
      e.preventDefault(); const [id, from] = e.dataTransfer.getData("text/plain").split("|"); if (!from) return;
      const ent = await GET("/entities/" + id); const m = ent.memberships.find((x) => x.circle_id === from && x.active);
      if (m) { await POST(`/memberships/${m.id}/end`); toast("Aus dem Kreis genommen (bis heute)"); invalidate(); location.reload(); }
    } } }, h("div.row", h("b", "Lose"), h("span.small.t2", lose.length), h("span.tiny.t3", "hierher ziehen = aus Kreis nehmen")),
    h("div.row.wrap", { style: { gap: "6px", marginTop: "8px" } }, lose.map((r) => h("a", { href: "#/p/" + r.id, draggable: true, title: r.display, on: { dragstart: (e) => e.dataTransfer.setData("text/plain", r.id + "|") } }, avatar(r, 30)))));
  cs.filter((c) => !c.parent_id).sort((a, b) => b.count - a.count).forEach((c) => wrap.append(area(c)));
  wrap.append(loseEl);
  page.append(h("p.small.t2", "Personen zwischen Bereichen ziehen fügt sie dem Kreis hinzu. Rausziehen nach „Lose“ setzt „bis heute“ und löscht nichts."), wrap);
}
