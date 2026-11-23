// Tabelle: Spreadsheet mit Formelleiste, Tastatur, Bereichsauswahl, Füllen per ⌘D, Kopieren/Einfügen,
// Ring-Popup in der Zelle und Bulk-Aktionen für markierte Zeilen.
import { S, h, icon, GET, POST, PATCH, clear, invalidate, optimistic, avatar, circleChip, nameEl, rel, ringName, menu, pickCircle, toast, confirmDlg, modal, rows, MOD, popover, closePop } from "./core.js";
import { LOCALE } from "./i18n.js";
import { editField, plain, TYPE_NAMES } from "./fields.js";
import { ringPopup } from "./shared.js";
import { groupOf } from "./groups.js";
import { matches, keys, binding } from "./shortcuts.js";
import { dateInput } from "./date.js";
import { VS } from "./desktop.js";

const INLINE = new Set(["text", "number", "date", "phone", "email", "address", "choice"]);
const letter = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function allColumns() {
  const cols = [
    { key: "kind", label: "Art", ty: "auswahl", get: (r) => (r.kind === "pet" ? "Haustier" : "Mensch"), edit: "kind" },
    { key: "main_circle_id", label: "Hauptkreis", ty: "kreis", get: (r) => r.main_circle_id, render: (r) => (r.main_circle_id ? circleChip(r.main_circle_id) : h("span.chip", "Lose")), edit: "circle" },
  ];
  if (S.settings.use_levels) cols.push({ key: "f_level", label: "Ring", ty: "ring", get: (r) => r.level, render: (r) => (r.level ? ringName(r.level) : h("span.t3", "–")), edit: "ring" });
  if (S.settings.use_ist) cols.push({ key: "ist", label: "Ist", ty: "berechnet", get: (r) => r.ist?.ring, render: (r) => (r.ist ? `${r.ist.ring} · ${rel(r.ist.last)}` : "–"), locked: true });
  for (const f of S.fieldList) {
    if (f.scope === "kreis" || f.id === "f_level") continue;
    cols.push({ key: f.id, label: f.name, ty: f.type, def: f, get: (r) => r.v[f.id]?.raw, render: (r) => cellVal(f, r), edit: INLINE.has(f.type) ? "inline" : "dialog" });
  }
  cols.push({ key: "created", label: "Erfasst", ty: "datum", get: (r) => (r.created_at || "").slice(0, 10), render: (r) => h("span.mono", (r.created_at || "").slice(0, 10)), locked: true });
  return cols;
}
function cellVal(f, r) {
  const x = r.v[f.id]; if (!x) return "";
  const txt = ["date", "phone"].includes(f.type) ? h("span.mono", x.d) : f.type === "choice" ? x.d : x.d;
  const el = x.u ? h("span.unsure-val", txt) : h("span", txt);
  return x.n > 1 ? h("span", el, h("span.t3", ` +${x.n - 1}`)) : el;
}
const DEFAULT = ["kind", "main_circle_id", "f_level", "ist", "f_seen", "f_bday", "f_phone", "f_profile", "f_via"];

export async function table(body, list, all, grouping = "", redraw = null) {
  const cols0 = allColumns();
  const chosen = VS.columns || DEFAULT;
  const cols = [{ key: "name", label: "Name", ty: "text", get: (r) => r.name || r.description, edit: "name" }, ...chosen.map((k) => cols0.find((c) => c.key === k)).filter(Boolean)];
  // Spaltenfilter wie in Excel: je Spalte die erlaubten Werte
  const CF = (VS.colFilters ||= {});
  const base = list;
  const EMPTY = "(leer)";
  const cellKey = (r, c) => rawText(r, c).trim() || (c.key === "main_circle_id" ? "Lose" : EMPTY);
  for (const k of Object.keys(CF)) if (!cols.some((c) => c.key === k)) delete CF[k];
  list = list.filter((r) => cols.every((c) => !CF[c.key] || CF[c.key].includes(cellKey(r, c))));
  function colFilter(anchor, c) {
    const counts = new Map();
    for (const r of base) { const k = cellKey(r, c); counts.set(k, (counts.get(k) || 0) + 1); }
    const vals = [...counts.keys()].sort((a, b) => (a === EMPTY) - (b === EMPTY) || a.localeCompare(b, LOCALE(), { numeric: true }));
    const sel = new Set(CF[c.key] || vals);
    const q = h("input.input", { placeholder: "Werte suchen …", style: { width: "100%" } });
    const boxes = vals.map((v) => {
      const cb = h("input", { type: "checkbox", checked: sel.has(v), on: { change: () => { cb.checked ? sel.add(v) : sel.delete(v); syncAll(); } } });
      return { v, el: h("label.check.cf-item", cb, h("span.grow.ellipsis", v), h("span.t3.small", counts.get(v))), cb };
    });
    const allCb = h("input", { type: "checkbox", on: { change: () => { const vis = boxes.filter((b) => b.el.style.display !== "none"); vis.forEach((b) => { b.cb.checked = allCb.checked; allCb.checked ? sel.add(b.v) : sel.delete(b.v); }); } } });
    const syncAll = () => { allCb.checked = boxes.every((b) => b.cb.checked); allCb.indeterminate = !allCb.checked && boxes.some((b) => b.cb.checked); };
    syncAll();
    q.addEventListener("input", () => { const t = q.value.trim().toLowerCase(); boxes.forEach((b) => (b.el.style.display = !t || b.v.toLowerCase().includes(t) ? "" : "none")); });
    const apply = () => {
      closePop();
      if (sel.size === vals.length) delete CF[c.key]; else CF[c.key] = [...sel];
      redraw?.();
    };
    const sortBtn = (dir, label, ic) => h("button", { type: "button", on: { click: () => { closePop(); VS.sort = (dir < 0 ? "-" : "") + (c.key === "main_circle_id" ? "main_circle_id" : c.key); redraw?.(); } } }, icon(ic), h("span.grow", label));
    popover(anchor, h("div.cf", h("div.menu", sortBtn(1, "Aufsteigend sortieren", "sort"), sortBtn(-1, "Absteigend sortieren", "sort"),
      CF[c.key] ? h("button", { type: "button", on: { click: () => { closePop(); delete CF[c.key]; redraw?.(); } } }, icon("x"), h("span.grow", "Filter entfernen")) : null),
      q, h("label.check.cf-item.cf-all", allCb, h("span.grow", "Alle auswählen")), h("div.cf-list", boxes.map((b) => b.el)),
      h("div.row", { style: { justifyContent: "flex-end", gap: "6px" } }, h("button.btn.sm", { type: "button", on: { click: closePop } }, "Abbrechen"), h("button.btn.sm.primary", { type: "button", on: { click: apply } }, "OK"))));
    setTimeout(() => q.focus(), 20);
  }
  let dups = new Set();
  try { (await GET("/duplicates")).forEach((p) => { dups.add(p.a); dups.add(p.b); }); } catch (_) {}
  const st = { act: { r: 0, c: 0 }, anc: { r: 0, c: 0 }, rowsSel: new Set(), lastRow: null, editing: null };
  const tds = [];
  const addr = h("input.input.mono.addr", { readOnly: true });
  const fx = h("input.input.mono.grow", { placeholder: "Wert" });
  const fxTag = h("span.tag");
  const sheet = h("div.sheet", { tabIndex: 0 });
  const foot = h("div.sheet-foot");
  const bulk = h("div.row");

  const tbl = h("table");
  const colgroup = h("colgroup", h("col", { style: { width: "40px" } }), cols.map((c, i) => h("col", { style: { width: (i === 0 ? 220 : c.key === "main_circle_id" ? 150 : 140) + "px" } })));
  const thead = h("tr", h("th.rn", h("span", "")), cols.map((c, i) => h("th" + (i === 0 ? ".name" : "") + (CF[c.key] ? ".cf-on" : ""), { title: c.def ? c.def.id : c.key }, h("span.th-in", h("span.th-l", c.label, h("span.ty", c.def ? TYPE_NAMES[c.ty] : c.ty)),
    h("button.cf-btn", { type: "button", title: CF[c.key] ? "Gefiltert – ändern" : "Filtern & sortieren", on: { mousedown: (e) => e.stopPropagation(), click: (e) => { e.stopPropagation(); colFilter(e.currentTarget, c); } } }, icon(CF[c.key] ? "filter" : "down", "xs"))))));
  const tbody = h("tbody");
  let lastGroup = null;
  list.forEach((r, ri) => {
    if (grouping) {
      const [gk, head] = groupOf(grouping, r);
      if (gk !== lastGroup) { lastGroup = gk; tbody.append(h("tr.grp-row", h("td", { colSpan: cols.length + 1 }, h("div.grp-row-in", head, h("span.small.t3", list.filter((x) => groupOf(grouping, x)[0] === gk).length))))); }
    }
    const tr = h("tr");
    tr.append(h("td.rn", { on: { mousedown: (e) => selectRow(ri, e) } }, ri + 1));
    tds[ri] = [];
    cols.forEach((c, ci) => {
      const td = h("td" + (ci === 0 ? ".name" : "") + (c.locked ? ".locked" : ""));
      fillCell(td, r, c);
      td.addEventListener("mousedown", (e) => { if (e.detail === 2) return; mouseDown(ri, ci, e); });
      td.addEventListener("mouseenter", (e) => { if (e.buttons === 1 && st.dragging) { st.act = { r: ri, c: ci }; paint(); } });
      td.addEventListener("dblclick", () => startEdit());
      tds[ri][ci] = td; tr.append(td);
    });
    tbody.append(tr);
  });
  tbl.append(colgroup, h("thead", thead), tbody);
  tbl.style.width = [...colgroup.children].reduce((a, c) => a + parseInt(c.style.width), 0) + "px";
  sheet.append(tbl);
  addEventListener("mouseup", () => (st.dragging = false));

  function fillCell(td, r, c) {
    clear(td);
    if (c.key === "name") {
      td.append(h("span.row", { style: { gap: "6px" } }, h("a.tbl-av", { href: "#/p/" + r.id, on: { mousedown: (e) => e.stopPropagation() } }, avatar(r, 20)), h("span.ellipsis", nameEl(r)), dups.has(r.id) ? h("span", { title: "Mögliche Doppelte" }, icon("merge")) : null));
    } else td.append(c.render ? c.render(r) : String(c.get(r) ?? ""));
  }
  const range = () => ({ r1: Math.min(st.act.r, st.anc.r), r2: Math.max(st.act.r, st.anc.r), c1: Math.min(st.act.c, st.anc.c), c2: Math.max(st.act.c, st.anc.c) });
  function paint() {
    const g = range();
    tds.forEach((row, ri) => row.forEach((td, ci) => {
      td.classList.toggle("inr", ri >= g.r1 && ri <= g.r2 && ci >= g.c1 && ci <= g.c2 && (g.r1 !== g.r2 || g.c1 !== g.c2));
      td.classList.toggle("act", ri === st.act.r && ci === st.act.c);
    }));
    [...tbody.children].forEach((tr, ri) => tr.classList.toggle("rsel", st.rowsSel.has(ri)));
    const r = list[st.act.r], c = cols[st.act.c];
    addr.value = r ? letter(st.act.c) + (st.act.r + 1) : "";
    fx.value = r ? rawText(r, c) : "";
    fx.disabled = !r || c.locked || (c.edit !== "inline" && c.edit !== "name");
    fxTag.textContent = c ? (c.def ? c.def.id : c.key) : "";
    const n = (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1);
    clear(foot, h("span", `${list.length} Zeilen`), h("span", `${all.filter((x) => !x.is_self).length} gesamt`), n > 1 ? h("span", `Auswahl ${g.r2 - g.r1 + 1} × ${g.c2 - g.c1 + 1}`) : null,
      st.rowsSel.size ? h("span", `${st.rowsSel.size} Zeilen markiert`) : null, h("span.grow"),
      h("span.row", keys("↑↓"), " bewegen"), h("span.row", keys("Enter"), " bearbeiten"), h("span.row", keys("Shift"), "+Klick Bereich"), h("span.row", keys(binding("fill_down")), " füllen"), h("span.row", keys("Mod+C"), " kopieren"));
    drawBulk();
    const td = tds[st.act.r]?.[st.act.c];
    if (td) { const sr = sheet.getBoundingClientRect(), tr = td.getBoundingClientRect();
      if (tr.bottom > sr.bottom) sheet.scrollTop += tr.bottom - sr.bottom + 4; if (tr.top < sr.top + 28) sheet.scrollTop -= sr.top + 28 - tr.top;
      if (tr.right > sr.right) sheet.scrollLeft += tr.right - sr.right + 4; if (tr.left < sr.left + 260 && st.act.c > 0) sheet.scrollLeft -= sr.left + 260 - tr.left; }
  }
  function rawText(r, c) {
    if (c.key === "name") return r.name || r.description || "";
    const v = c.get(r);
    if (c.key === "main_circle_id") return v ? S.circles[v]?.name || "" : "";
    if (c.def) return v == null ? "" : plain(c.def, v);
    return v == null ? "" : String(v);
  }
  function mouseDown(ri, ci, e) {
    if (st.editing) commitEdit();
    sheet.focus();
    if (e.shiftKey) st.act = { r: ri, c: ci };
    else { st.act = st.anc = { r: ri, c: ci }; st.dragging = true; }
    if (!e.shiftKey) st.rowsSel.clear();
    paint();
    const c = cols[ci];
    if (!e.shiftKey && (c.edit === "ring" || c.edit === "circle") && e.target.closest("td")) setTimeout(() => cellAction(), 0);
  }
  function selectRow(ri, e) {
    sheet.focus();
    if (e.shiftKey && st.lastRow !== null) { const [a, b] = [Math.min(st.lastRow, ri), Math.max(st.lastRow, ri)]; for (let i = a; i <= b; i++) st.rowsSel.add(i); }
    else if (e.metaKey || e.ctrlKey) { st.rowsSel.has(ri) ? st.rowsSel.delete(ri) : st.rowsSel.add(ri); }
    else { st.rowsSel.clear(); st.rowsSel.add(ri); }
    st.lastRow = ri; st.act = { r: ri, c: 0 }; st.anc = { r: ri, c: cols.length - 1 }; paint();
  }
  function selectedIds() {
    if (st.rowsSel.size) return [...st.rowsSel].map((i) => list[i].id);
    const g = range(); return list.slice(g.r1, g.r2 + 1).map((r) => r.id);
  }

  // ------------------------------------------------ Bearbeiten
  // Erst zeigen, dann speichern: Zelle sofort lokal setzen, Server im Hintergrund; danach still die echten Werte holen
  const byId = (id) => list.find((y) => y.id === id);
  function applyLocal(r, key, value) {
    if (!r) return;
    if (key === "name") { if (r.name || !r.description) r.name = value || null; else r.description = value; r.display = r.name || r.description; return; }
    if (key === "f_level") { r.level = value ?? null; return; }
    if (key === "main_circle_id") { r.main_circle_id = value; if (value && !r.circles.includes(value)) r.circles.push(value); return; }
    if (key === "kind") { r.kind = value; return; }
    const def = S.fields[key]; if (!def) return;
    if (value == null || value === "" || (Array.isArray(value) && !value.length)) delete r.v[key];
    else r.v[key] = { ...(r.v[key] || {}), raw: value, d: plain(def, value), u: false };
  }
  let syncT = null;
  const resync = () => { clearTimeout(syncT); syncT = setTimeout(async () => {
    if (st.editing || document.querySelector(".backdrop:not(.leaving), .pop")) return resync();
    const fresh = Object.fromEntries((await rows(true)).map((x) => [x.id, x]));
    list.forEach((r) => fresh[r.id] && Object.assign(r, fresh[r.id])); refreshAll();
  }, 700); };
  const bg = (server) => optimistic(server, { onDone: resync, onFail: resync });
  function save(r, c, value) {
    const cellValue = value === "" ? null : c.def?.type === "choice" ? (c.def.options?.multiple ? value.split(",").map((s) => s.trim()).filter(Boolean) : value) : value;
    if (c.key === "name") {
      const body = r.name || !r.description ? { name: value } : { description: value };
      applyLocal(r, "name", value);
      bg(() => PATCH("/entities/" + r.id, body));
    } else {
      applyLocal(r, c.key, cellValue);
      bg(() => POST("/bulk/cells", { cells: [{ id: r.id, field: c.key, value: cellValue }] }));
    }
    const ri = list.indexOf(r); cols.forEach((cc, ci) => fillCell(tds[ri][ci], r, cc)); paint();
  }
  function startEdit(initial) {
    const r = list[st.act.r], c = cols[st.act.c];
    if (!r || c.locked) return;
    if (c.edit !== "inline" && c.edit !== "name") return cellAction();
    const td = tds[st.act.r][st.act.c];
    if (c.def?.type === "date" && initial === undefined) {
      const di = dateInput(r.v[c.key]?.raw || "", { onChange: (v) => { closePop(); save(r, c, v); sheet.focus(); } });
      popover(td, h("div", { style: { width: "260px" } }, h("div.small.t2", c.label), di));
      requestAnimationFrame(() => { di.focus(); di.open(); });
      return;
    }
    const inp = h("input.cell-edit", { value: initial !== undefined ? initial : rawText(r, c) });
    const sr = sheet.getBoundingClientRect(), tr = td.getBoundingClientRect();
    Object.assign(inp.style, { left: tr.left - sr.left + sheet.scrollLeft + "px", top: tr.top - sr.top + sheet.scrollTop + "px", width: Math.max(tr.width, 180) + "px", height: tr.height + "px" });
    sheet.append(inp); inp.focus();
    if (initial === undefined) inp.select();
    st.editing = { inp, r, c };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { commitEdit(); move(1, 0); }
      else if (e.key === "Tab") { e.preventDefault(); commitEdit(); move(0, e.shiftKey ? -1 : 1); }
      else if (e.key === "Escape") { cancelEdit(); }
    });
    inp.addEventListener("blur", () => setTimeout(() => { if (st.editing?.inp === inp) commitEdit(); }, 50));
  }
  function commitEdit() {
    const ed = st.editing; if (!ed) return; st.editing = null; ed.inp.remove();
    if (ed.inp.value !== rawText(ed.r, ed.c)) save(ed.r, ed.c, ed.inp.value.trim());
    sheet.focus();
  }
  function cancelEdit() { const ed = st.editing; if (!ed) return; st.editing = null; ed.inp.remove(); sheet.focus(); }
  async function cellAction() {
    const r = list[st.act.r], c = cols[st.act.c]; if (!r || c.locked) return;
    const td = tds[st.act.r][st.act.c];
    if (c.edit === "ring") return ringPopup(td, r.level, (l) => { const ids = selectedIds(); ids.forEach((id) => applyLocal(byId(id), "f_level", l)); refreshAll(); bg(() => POST("/bulk", { ids, op: "ring", value: l })); });
    if (c.edit === "circle") return pickCircle(td, { onPick: (ci) => { const ids = selectedIds(); ids.forEach((id) => applyLocal(byId(id), "main_circle_id", ci.id)); refreshAll(); bg(() => POST("/bulk", { ids, op: "main_circle", value: ci.id })); } });
    if (c.edit === "kind") return menu(td, [["person", "Mensch"], ["pet", "Haustier"]].map(([k, l]) => ({ label: l, action: () => { const ids = selectedIds(); ids.forEach((id) => applyLocal(byId(id), "kind", k)); refreshAll(); bg(() => POST("/bulk", { ids, op: "kind", value: k })); } })));
    if (c.edit === "dialog" || c.edit === "inline") {
      const e = await GET("/entities/" + r.id);
      const vals = c.def.scope === "bund" ? (e.ihr_zwei?.fields?.[c.key] || []) : (e.fields[c.key] || []);
      if (await editField(c.def, vals, `/entities/${r.id}/fields/${c.key}`)) { const fresh = (await rows(true)).find((x) => x.id === r.id); if (fresh) Object.assign(r, fresh); refreshAll(); }
    }
    if (c.edit === "name") startEdit();
  }
  function refreshAll() { list.forEach((r, ri) => cols.forEach((c, ci) => fillCell(tds[ri][ci], r, c))); paint(); }
  function move(dr, dc, extend = false) {
    const r = Math.max(0, Math.min(list.length - 1, st.act.r + dr)), c = Math.max(0, Math.min(cols.length - 1, st.act.c + dc));
    st.act = { r, c }; if (!extend) { st.anc = { r, c }; st.rowsSel.clear(); } paint();
  }
  async function fillDown() {
    const g = range(); if (g.r1 === g.r2) return toast("Bereich mit mehreren Zeilen markieren, dann ⌘D");
    const cells = [];
    for (let ci = g.c1; ci <= g.c2; ci++) {
      const c = cols[ci]; if (c.locked || c.key === "name") continue;
      const src = list[g.r1];
      for (let ri = g.r1 + 1; ri <= g.r2; ri++) {
        if (c.edit === "ring") cells.push({ id: list[ri].id, field: "f_level", value: src.level });
        else if (c.key === "main_circle_id") { if (src.main_circle_id) cells.push({ id: list[ri].id, field: "main_circle_id", value: src.main_circle_id }); }
        else if (c.key === "kind") cells.push({ id: list[ri].id, field: "kind", value: src.kind });
        else if (c.def) cells.push({ id: list[ri].id, field: c.key, value: src.v[c.key]?.raw ?? null });
      }
    }
    if (!cells.length) return;
    cells.forEach((x) => applyLocal(byId(x.id), x.field, x.value)); refreshAll();
    toast(`${cells.length} Zellen gefüllt`);
    bg(() => POST("/bulk/cells", { cells }));
  }
  function copy(e) {
    const g = range(); const lines = [];
    for (let ri = g.r1; ri <= g.r2; ri++) { const row = []; for (let ci = g.c1; ci <= g.c2; ci++) row.push(rawText(list[ri], cols[ci])); lines.push(row.join("\t")); }
    e.clipboardData.setData("text/plain", lines.join("\n")); e.preventDefault(); toast("Kopiert");
  }
  async function paste(e) {
    if (st.editing) return;
    const text = e.clipboardData.getData("text/plain"); if (!text) return; e.preventDefault();
    const data = text.replace(/\r/g, "").split("\n").filter((l) => l !== "").map((l) => l.split("\t"));
    const cells = [];
    data.forEach((row, i) => row.forEach((v, j) => {
      const r = list[st.act.r + i], c = cols[st.act.c + j]; if (!r || !c || c.locked) return;
      if (c.key === "name") cells.push({ id: r.id, field: "name", value: v });
      else if (c.def && INLINE.has(c.def.type)) cells.push({ id: r.id, field: c.key, value: v === "" ? null : c.def.type === "choice" && c.def.options?.multiple ? v.split(",").map((s) => s.trim()) : v });
      else if (c.edit === "ring" && /^[1-4]?$/.test(v)) cells.push({ id: r.id, field: "f_level", value: v ? +v : null });
    }));
    if (!cells.length) return;
    cells.forEach((x) => applyLocal(byId(x.id), x.field, x.value)); refreshAll(); toast(`${cells.length} Zellen eingefügt`);
    bg(() => POST("/bulk/cells", { cells }));
  }
  sheet.addEventListener("copy", copy);
  sheet.addEventListener("paste", paste);
  sheet.addEventListener("keydown", (e) => {
    if (st.editing) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key;
    if (k === "ArrowDown") { e.preventDefault(); move(mod ? list.length : 1, 0, e.shiftKey); }
    else if (k === "ArrowUp") { e.preventDefault(); move(mod ? -list.length : -1, 0, e.shiftKey); }
    else if (k === "ArrowRight" || (k === "Tab" && !e.shiftKey)) { e.preventDefault(); move(0, 1, e.shiftKey && k !== "Tab"); }
    else if (k === "ArrowLeft" || (k === "Tab" && e.shiftKey)) { e.preventDefault(); move(0, -1, e.shiftKey && k !== "Tab"); }
    else if (k === "Enter" || k === "F2") { e.preventDefault(); if (e.shiftKey) move(-1, 0); else startEdit(); }
    else if (matches(e, "fill_down")) { e.preventDefault(); e.stopPropagation(); fillDown(); }
    else if (matches(e, "select_all")) { e.preventDefault(); e.stopPropagation(); st.anc = { r: 0, c: 0 }; st.act = { r: list.length - 1, c: cols.length - 1 }; paint(); }
    else if (matches(e, "open_row")) { e.preventDefault(); e.stopPropagation(); location.hash = "#/p/" + list[st.act.r].id; }
    else if ((k === "Delete" || k === "Backspace") && !mod) {
      e.preventDefault(); const g = range(); const cells = [];
      for (let ri = g.r1; ri <= g.r2; ri++) for (let ci = g.c1; ci <= g.c2; ci++) { const c = cols[ci]; if (c.def && !c.locked) cells.push({ id: list[ri].id, field: c.key, value: null }); else if (c.edit === "ring") cells.push({ id: list[ri].id, field: "f_level", value: null }); }
      if (cells.length) POST("/bulk/cells", { cells }).then(async () => { const fresh = Object.fromEntries((await rows(true)).map((x) => [x.id, x])); list.forEach((r) => fresh[r.id] && Object.assign(r, fresh[r.id])); refreshAll(); });
    } else if (/^[1-4]$/.test(k) && cols[st.act.c].edit === "ring" && !mod) {
      e.preventDefault(); POST("/bulk", { ids: selectedIds(), op: "ring", value: +k }).then(() => { selectedIds().forEach((id) => { const x = list.find((y) => y.id === id); if (x) x.level = +k; }); invalidate(); refreshAll(); });
    } else if (k.length === 1 && !mod && !e.altKey) { startEdit(k); e.preventDefault(); }
  });
  fx.addEventListener("keydown", (e) => { if (e.key === "Enter") { const r = list[st.act.r], c = cols[st.act.c]; save(r, c, fx.value.trim()); sheet.focus(); } if (e.key === "Escape") { paint(); sheet.focus(); } });

  // ------------------------------------------------ Bulk-Aktionen
  function drawBulk() {
    const ids = selectedIds(); const n = ids.length;
    clear(bulk, n > 1 || st.rowsSel.size ? [
      h("span.small.t2", `${n} markiert`),
      h("button.btn.sm", { on: { click: (e) => pickCircle(e.currentTarget, { onPick: (c) => { ids.forEach((id) => { const x = byId(id); if (x && !x.circles.includes(c.id)) { x.circles.push(c.id); x.main_circle_id ||= c.id; } }); refreshAll(); toast(`${n} zu ${c.name} hinzugefügt`); bg(() => POST("/bulk", { ids, op: "add_circle", value: c.id })); } }) } }, icon("circles"), "Kreis zuordnen"),
      S.settings.use_levels ? h("button.btn.sm", { on: { click: (e) => ringPopup(e.currentTarget, null, (l) => { ids.forEach((id) => applyLocal(byId(id), "f_level", l)); refreshAll(); bg(() => POST("/bulk", { ids, op: "ring", value: l })); }) } }, icon("rings"), "Ring") : null,
      n === 2 ? h("button.btn.sm.dark", { on: { click: () => (location.hash = `#/merge/${ids[0]}/${ids[1]}`) } }, icon("merge"), "Zusammenführen") : null,
      h("button.btn.sm", { on: { click: (e) => menu(e.currentTarget, [
        { label: "Mit Handy synchronisieren", icon: "smartphone", action: () => { toast("Wird mit dem Handy synchronisiert"); bg(() => POST("/bulk", { ids, op: "on_phone", value: true })); } },
        { label: "Nicht mit Handy synchronisieren", action: () => bg(() => POST("/bulk", { ids, op: "on_phone", value: false })) },
        { label: "Heute gesehen", icon: "eye", action: () => { const d = new Date(), t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; ids.forEach((id) => applyLocal(byId(id), "f_seen", t)); refreshAll(); toast(`${n} × heute gesehen`); bg(() => Promise.all(ids.map((id) => POST(`/seen-today/${id}`)))); } },
        { label: "Löschen", icon: "trash", action: async () => { if (await confirmDlg(`${n} Einträge löschen?`, "Personen aus Importen werden danach nicht wieder importiert (freigeben unter Einstellungen → Importe). Mit Rückgängig holst du alle zurück.", "Löschen", true)) { await POST("/bulk", { ids, op: "delete" }); invalidate(); location.reload(); } } }]) } }, icon("more"))] : null);
  }

  const colBtn = h("button.btn.sm", { on: { click: () => chooseColumns(cols0, chosen) } }, icon("table"), "Spalten");
  body.append(h("div.sheet-wrap", { style: { height: "calc(100vh - 170px)" } },
    h("div.fbar", addr, h("span.t3.mono", "ƒ"), fx, fxTag, bulk, colBtn), sheet, foot));
  paint();
  requestAnimationFrame(() => sheet.focus());
}

async function chooseColumns(cols0, chosen) {
  const sel = new Set(chosen);
  const list = h("div.col", cols0.map((c) => h("label.check", h("input", { type: "checkbox", checked: sel.has(c.key), on: { change: (e) => e.target.checked ? sel.add(c.key) : sel.delete(c.key) } }), c.label, h("span.tag", c.def ? c.def.id : c.ty))));
  const ok = await modal("Spalten", list, [{ label: "Abbrechen" }, { label: "Übernehmen", primary: true, value: true }]);
  if (ok) { VS.columns = cols0.map((c) => c.key).filter((k) => sel.has(k)); location.hash = location.hash; dispatchEvent(new HashChangeEvent("hashchange")); toast("Spalten geändert – mit „Ansicht speichern“ merken"); }
}
