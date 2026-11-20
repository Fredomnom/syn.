// Desktop: sortieren und bearbeiten in großen Mengen. Seitenleiste, sechs Ansichten, Personenseite, Kreise.
import { S, h, icon, GET, POST, PUT, PATCH, DEL, clear, rebuild, rows, invalidate, avatar, circleChip, nameEl, rel, ringName, today, debounce,
  toast, modal, logo, qs, menu, pickPerson, pickCircle, reloadCircles, confirmDlg, ringMini, MOD, fmtTs, circleColors, kindColors, promptDlg, RING, cssVar as V } from "./core.js";
import { primaryOf, valueEl, actionFor, editField, entityFieldList, runQuick, bundFields, TYPE_NAMES, SOURCE, plain, fieldsFor, service } from "./fields.js";
import { onPage, onGlobal, resetPage, binding, pretty, helpOverlay } from "./shortcuts.js";
import { dateInput } from "./date.js";
import { editPerson, addField, dupHint, ringPopup, setRing, editIhrZwei, bundKindName, addBund, addToCircle, historyText } from "./shared.js";

const LS = (k, d) => { try { return JSON.parse(localStorage.getItem("syn." + k)) ?? d; } catch (_) { return d; } };
const SAVE = (k, v) => { try { localStorage.setItem("syn." + k, JSON.stringify(v)); } catch (_) {} };

export const VIEWS = [["grid", "Grid", "grid"], ["list", "Liste", "list"], ["table", "Tabelle", "table"], ["rings", "Ringe", "rings"], ["axes", "Achsen", "axes"], ["net", "Netz", "net"]];
// Zustand der Personen-Ansicht (Filter, Sortierung, Spalten) – lässt sich als Ansicht speichern
export const VS = { view: LS("view", "table"), filter: "", kind: "all", q: "", sort: "name", circle: "", max_level: "", columns: null, savedId: null, cfg: {} };

let lastPath = null;
export async function render(app, route) {
  const [p0, p1, p2] = route.parts;
  const path = route.parts.join("/");
  const same = path === lastPath;
  lastPath = path;
  resetPage();
  const main = h("main.main");
  const side = await sidebar(route);
  const oldMain = app.querySelector(".main");
  const scroll = same && oldMain ? oldMain.scrollTop : 0;
  await routeTo(main, route);
  const desk = h("div.desk" + (LS("side", true) ? "" : ".collapsed"), side, main);
  clear(app, desk);
  main.scrollTop = scroll;
  if (!same) main.classList.add("enter");
  setupGlobalKeys();
}

async function routeTo(main, route) {
  const [p0, p1, p2] = route.parts;
  if (!p0 || p0 === "people") return people(main, p1 || null, route);
  if (p0 === "v") return savedView(main, p1, route);
  if (p0 === "p") return personPage(main, p1);
  if (p0 === "circles") return circlesPage(main, p1);
  if (p0 === "c") return circlePage(main, p1);
  if (p0 === "merge") return (await import("./merge.js")).mergePage(main, p1, p2);
  if (p0 === "settings") return (await import("./settings.js")).settingsPage(main, p1 || "fields", route);
  if (p0 === "notes") return notesPage(main);
  if (p0 === "today") return todayPage(main);
  return people(main, null, route);
}

export function toggleSidebar() {
  const d = document.querySelector(".desk"); if (!d) return;
  d.classList.toggle("collapsed"); SAVE("side", !d.classList.contains("collapsed"));
}
function setupGlobalKeys() {
  onGlobal("toggle_sidebar", toggleSidebar);
  onGlobal("search", () => { const i = document.querySelector("#people-search"); if (i) i.focus(); else location.hash = "#/people?focus=search"; });
  onGlobal("new_person", () => newPersonDialog());
  onGlobal("help", helpOverlay);
  onGlobal("go_people", () => (location.hash = "#/people"));
  onGlobal("go_circles", () => (location.hash = "#/circles"));
  onGlobal("go_today", () => (location.hash = "#/today"));
  onGlobal("go_notes", () => (location.hash = S.settings.notes_enabled ? "#/notes" : "#/settings/modules"));
  onGlobal("go_settings", () => (location.hash = "#/settings"));
}

async function sidebar(route) {
  const all = await rows();
  const p0 = route.parts[0] || "people";
  const nav = (href, ic, label, n, on) => h("a.nav" + (on ? ".on" : ""), { href, title: label }, icon(ic), h("span.lab", label), n !== undefined ? h("span.n", n) : null);
  const t = await GET("/today");
  const sugg = (await GET("/suggestions")).length;
  return h("aside.side",
    h("div.top", logo(), h("button.btn.ghost.icon", { title: `Seitenleiste ein-/ausklappen (${pretty(binding("toggle_sidebar"))})`, on: { click: toggleSidebar } }, icon("sidebar"))),
    nav("#/people", "users", "Personen", all.filter((r) => !r.is_self).length, ["people", "p", "v", "merge"].includes(p0)),
    nav("#/circles", "circles", "Kreise", Object.keys(S.circles).length, ["circles", "c"].includes(p0)),
    S.settings.notes_enabled ? nav("#/notes", "note", "Notizen", undefined, p0 === "notes")
      : h("a.nav", { href: "#/settings/modules", title: "Notizen" }, icon("note"), h("span.lab.t3", "Notizen"), h("span.n.tag", "Modul aus")),
    nav("#/today", "bell", "Heute", t.items.length || undefined, p0 === "today"),
    h("div.sect", "Gespeicherte Ansichten"),
    S.views.map((v) => h("a.view" + (route.parts[1] === v.id ? ".on" : ""), { href: "#/v/" + v.id }, h("span.ellipsis", v.name),
      v.view === "duplicates" ? null : null)),
    h("div.bottom",
      h("div.row.undo-row", h("button.btn.ghost.sm", { title: `Rückgängig (${pretty(binding("undo"))})`, on: { click: () => dispatchEvent(new CustomEvent("syn-undo", { detail: "undo" })) } }, icon("undo"), h("span.lab", "Rückgängig")),
        h("button.btn.ghost.sm.icon", { title: `Wiederholen (${pretty(binding("redo"))})`, on: { click: () => dispatchEvent(new CustomEvent("syn-undo", { detail: "redo" })) } }, icon("redo"))),
      sugg ? nav("#/settings/suggestions", "zap", "Vorschläge", sugg, route.parts[1] === "suggestions") : null,
      nav("#/settings", "settings", "Felder, Kreise, Routinen", undefined, p0 === "settings" && route.parts[1] !== "suggestions"),
      h("a.nav", { href: "#/p/" + S.me.self_id }, avatar({ is_self: true, display: "Du" }, 22, { self: true }), h("span.lab", "Mein Profil"))));
}

// ---------------------------------------------------------------- Personen
async function savedView(main, id, route) {
  const v = S.views.find((x) => x.id === id);
  if (!v) return people(main, null, route);
  if (v.view === "duplicates") return (await import("./merge.js")).duplicatesPage(main, v);
  Object.assign(VS, { filter: "", kind: "all", q: "", sort: "name", circle: "", max_level: "", columns: null, cfg: {} }, v.config, { view: v.view, savedId: v.id });
  return people(main, v.view, route, v);
}

export function filterRows(all) {
  let list = all.filter((r) => !r.is_self || VS.view === "net" || VS.view === "rings");
  if (VS.kind !== "all") list = list.filter((r) => r.kind === VS.kind);
  if (VS.filter === "lose") list = list.filter((r) => !r.circles.length && !r.is_self);
  if (VS.filter === "no_ring") list = list.filter((r) => r.level == null && !r.is_self);
  if (VS.filter === "uncertain") list = list.filter((r) => !r.name || r.name_uncertain || Object.values(r.v).some((x) => x.u));
  if (VS.filter === "long_unseen") list = list.filter((r) => r.long_unseen);
  if (VS.circle) list = list.filter((r) => r.circles_all.includes(VS.circle));
  if (VS.max_level) list = list.filter((r) => r.level != null && r.level <= +VS.max_level);
  if (VS.q) { const q = VS.q.toLowerCase(); list = list.filter((r) => [r.display, r.description, ...(r.aliases || []), ...r.circles_all.map((c) => S.circles[c]?.name), ...Object.values(r.v).map((x) => x.d)].join(" ").toLowerCase().includes(q)); }
  const key = VS.sort.replace(/^-/, ""), desc = VS.sort.startsWith("-");
  const val = (r) => key === "name" ? r.display.toLowerCase() : key === "created" ? r.created_at : key === "level" ? (r.level ?? 9) : key === "seen" ? (r.v.f_seen?.raw || "") : (r.v[key]?.raw ?? "");
  list.sort((a, b) => { const x = val(a), y = val(b); const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "de"); return desc ? -c : c; });
  return list;
}

async function people(main, view, route, saved = null) {
  if (view && !saved) { VS.view = view; VS.savedId = null; }
  if (!view && !saved) { VS.view = LS("view", "table"); }
  if (!S.settings.use_levels && VS.view === "rings") VS.view = "table";
  SAVE("view", VS.view);
  const all = await rows();
  const page = h("div.page");
  main.append(page);
  const body = h("div.col", { style: { flex: 1, minHeight: 0 } });
  const redraw = () => drawView(body, all);
  const views = VIEWS.filter(([id]) => S.settings.use_levels || id !== "rings");
  const filterBtn = h("button.btn.sm", { on: { click: (e) => filterMenu(e.currentTarget, redraw) } }, icon("filter"), "Filter" + (activeFilters() ? " · " + activeFilters() : ""));
  const sortBtn = h("button.btn.sm", { on: { click: (e) => sortMenu(e.currentTarget, redraw) } }, icon("sort"), "Sortiert: " + sortLabel());
  const search = h("input.input#people-search", { placeholder: `Suchen  ${pretty(binding("search"))}`, value: VS.q, style: { width: "220px" }, on: { input: debounce((e) => { VS.q = e.target.value; redraw(); }, 150), keydown: (e) => { if (e.key === "Escape") e.target.blur(); } } });
  if (route?.query?.focus === "search") requestAnimationFrame(() => search.focus());
  for (const [id] of views) onPage("view_" + id, () => (location.hash = "#/people/" + id));
  onPage("save_view", () => saveView(saved));
  page.append(
    h("div.page-h", h("h1", saved ? saved.name : "Personen"),
      h("button.btn.primary", { on: { click: () => newPersonDialog() } }, icon("plus"), "Person")),
    h("div.toolbar",
      h("span.small.t2", "Personen"), h("select.input", { on: { change: (e) => { VS.kind = e.target.value; redraw(); } } },
        [["all", "Alle Menschen & Tiere"], ["person", "Menschen"], ["pet", "Haustiere"]].map(([k, l]) => h("option", { value: k, selected: VS.kind === k }, l))),
      h("div.seg", views.map(([id, label, ic], i) => h("button" + (VS.view === id ? ".on" : ""), { title: `${label} (${pretty(binding("view_" + id))})`, on: { click: () => { location.hash = `#/people/${id}`; } } }, icon(ic), label))),
      h("span.grow"), filterBtn, sortBtn, search,
      h("button.btn.sm", { title: "Ansicht speichern", on: { click: () => saveView(saved) } }, icon("download"), saved ? "Speichern" : "Ansicht speichern")),
    body);
  redraw();
}

function activeFilters() { return [VS.filter, VS.circle, VS.max_level].filter(Boolean).length || ""; }
function sortLabel() { const k = VS.sort.replace("-", ""); return ({ name: "Name", created: "Erfasst", level: "Ring", seen: "Zuletzt gesehen" })[k] || S.fields[k]?.name || k; }

function filterMenu(anchor, redraw) {
  const it = (label, key, val) => ({ label, on: VS[key] === val, action: () => { VS[key] = VS[key] === val ? "" : val; redraw(); refreshToolbar(); } });
  menu(anchor, [{ label: "Zeigen" }, it("Lose (ohne Kreis)", "filter", "lose"), S.settings.use_levels ? it("Ohne Ring", "filter", "no_ring") : null, it("Mit unsicheren Angaben", "filter", "uncertain"),
    S.settings.use_ist ? it("Nah, aber lange nicht gesehen", "filter", "long_unseen") : null,
    S.settings.use_levels ? { label: "Ring höchstens" } : null, ...(S.settings.use_levels ? [1, 2, 3, 4].map((n) => it(ringName(n), "max_level", String(n))) : []),
    { label: "Kreis" }, ...Object.values(S.circles).sort((a, b) => a.name.localeCompare(b.name)).map((c) => it(c.name, "circle", c.id))]);
}
function refreshToolbar() { /* Toolbar wird beim nächsten Rendern aktualisiert */ }
function sortMenu(anchor, redraw) {
  const it = (label, key) => ({ label, on: VS.sort.replace("-", "") === key, hint: VS.sort === "-" + key ? "↓" : VS.sort === key ? "↑" : "", action: () => { VS.sort = VS.sort === key ? "-" + key : key; redraw(); } });
  menu(anchor, [it("Name", "name"), it("Erfasst", "created"), S.settings.use_levels ? it("Ring", "level") : null, it("Zuletzt gesehen", "seen"), { label: "Felder" },
    ...S.fieldList.filter((f) => !["note", "image"].includes(f.type) && f.scope !== "kreis").map((f) => it(f.name, f.id))]);
}

async function saveView(saved) {
  const cfg = { filter: VS.filter, kind: VS.kind, q: VS.q, sort: VS.sort, circle: VS.circle, max_level: VS.max_level, columns: VS.columns, ...VS.cfg };
  if (saved) { await PUT("/views/" + saved.id, { view: VS.view, config: cfg }); toast("Ansicht gespeichert"); }
  else {
    const name = await promptDlg("Ansicht speichern", "Name", "");
    if (!name) return;
    const r = await POST("/views", { name, view: VS.view, tab: "people", config: cfg });
    S.views = await GET("/views"); location.hash = "#/v/" + r.id;
  }
}

async function drawView(body, all) {
  const list = filterRows(all);
  const box = document.createDocumentFragment();
  if (VS.view === "grid") grid(box, list);
  else if (VS.view === "list") listView(box, list);
  else if (VS.view === "table") await (await import("./table.js")).table(box, list, all);
  else {
    const viz = await import("./viz.js");
    if (VS.view === "rings") await viz.rings(box, list, all);
    if (VS.view === "axes") await viz.axes(box, list, all);
    if (VS.view === "net") await viz.net(box, list, all);
  }
  body.replaceChildren(box);
}

function grid(body, list) {
  const g = h("div.pgrid");
  for (const r of list) {
    const seen = r.v.f_seen?.raw;
    g.append(h("a.pcell", { href: "#/p/" + r.id }, avatar(r, 56), h("div.nm.ellipsis", nameEl(r)), h("div.small.t2", seen ? rel(seen) : "–"),
      h("button.btn.sm.seen-btn", { title: "Heute gesehen", on: { click: async (e) => { e.preventDefault(); await POST(`/seen-today/${r.id}`); invalidate(); toast(`${r.display}: heute gesehen`); r.v.f_seen = { raw: today(), d: today() }; } } }, icon("eye"))));
  }
  body.append(list.length ? g : h("div.card.empty", "Keine Personen für diese Auswahl."));
}

function listView(body, list) {
  const groups = {};
  for (const r of list) (groups[r.main_circle_id || "_lose"] ||= []).push(r);
  const closed = new Set(LS("closed", []));
  const box = h("div.card.plist");
  const keys = Object.keys(groups).sort((a, b) => (a === "_lose") - (b === "_lose") || (S.circles[a]?.name || "").localeCompare(S.circles[b]?.name || ""));
  for (const k of keys) {
    const items = h("div" + (closed.has(k) ? ".hidden" : ""), groups[k].map((r) => h("a.item", { href: "#/p/" + r.id }, avatar(r, 26), h("span.grow", nameEl(r)),
      S.settings.use_levels ? h("span.small.t2", ringName(r.level)) : null, h("span.small.t2", { style: { width: "120px", textAlign: "right" } }, r.v.f_seen ? rel(r.v.f_seen.raw) : "–"))));
    const head = h("div.grp-h", { on: { click: () => { items.classList.toggle("hidden"); closed.has(k) ? closed.delete(k) : closed.add(k); SAVE("closed", [...closed]); } } },
      icon(closed.has(k) ? "right" : "down"), k === "_lose" ? h("span.chip", "Lose") : circleChip(k), h("span.small.t2", groups[k].length));
    box.append(h("div.grp", head, items));
  }
  body.append(list.length ? box : h("div.card.empty", "Keine Personen."));
}

export async function newPersonDialog(prefill = {}) {
  const name = h("input.input", { placeholder: "Name oder Beschreibung", value: prefill.name || "" });
  const unk = h("input", { type: "checkbox" });
  const kind = h("select.input", h("option", { value: "person" }, "Mensch"), h("option", { value: "pet" }, "Haustier"));
  const hint = h("div");
  name.addEventListener("input", debounce(async () => {
    const d = name.value.trim() ? await GET("/duplicates/check" + qs({ text: name.value })) : [];
    clear(hint, d.length ? h("div.hint", h("div.grow", h("b", "Schon da? "), d.map((x, i) => h("a", { href: "#/p/" + x.id, on: { click: () => document.querySelector(".backdrop:not(.leaving)")?._close(null) } }, (i ? ", " : "") + x.display + (x.circle ? " · " + x.circle : ""))))) : null);
  }, 200));
  const r = await modal("Neue Person", h("div.col", h("div.row", name, kind), h("label.check", unk, "Name noch unbekannt (als Beschreibung speichern)"), hint),
    [{ label: "Abbrechen" }, { label: "Anlegen", primary: true, action: () => POST("/entities", unk.checked ? { description: name.value, name_uncertain: true, kind: kind.value } : { name: name.value, kind: kind.value }).catch(() => false) }]);
  if (r) { invalidate(); location.hash = "#/p/" + r.id; }
}

// ---------------------------------------------------------------- Personenseite
async function personPage(main, id) {
  const e = await GET("/entities/" + id);
  const page = h("div.page"); main.append(page);
  const reload = () => rebuild(main, (m) => personPage(m, id));
  if (!e.is_self) onPage("seen_today", async () => { await POST(`/seen-today/${id}`); invalidate(); toast(`${e.display}: heute gesehen`); reload(); });
  onPage("edit_person", async () => { if (await editPerson(e)) reload(); });
  onPage("add_field", () => addField(e, { onDone: reload }));
  const iz = e.ihr_zwei?.fields || {};
  const phone = primaryOf(e.fields.f_phone), mail = primaryOf(e.fields.f_email);
  const sugg = await GET("/suggestions" + qs({ entity_id: id }));
  const head = h("div.phead", avatar(e, 72),
    h("div.names.grow", h("h1", e.name || e.description || "Ohne Namen", !e.name ? h("span.qmark", "ohne Namen") : e.name_uncertain ? h("span.qmark", "Name ?") : null,
      e.kind === "pet" ? h("span.chip.plain", icon("paw"), "Haustier") : null),
      e.aliases?.length ? h("div.small.t2", "auch: " + e.aliases.join(", ")) : null,
      h("div.meta-line", h("span", "Erfasst ", h("span.mono", (e.created_at || "").slice(0, 10))), e.on_phone_effective ? h("span.meta-pill", icon("smartphone", "xs"), "aufs Handy") : null)),
    e.is_self ? null : h("button.btn.primary", { on: { click: async () => { await POST(`/seen-today/${id}`); invalidate(); reload(); } } }, icon("eye"), "Heute gesehen"),
    phone ? h("a.btn", { href: "tel:" + phone.value.replace(/[^\d+]/g, "") }, icon("phone"), "Anrufen") : null,
    mail ? h("a.btn", { href: "mailto:" + mail.value }, icon("message"), "Schreiben") : null,
    h("button.btn.icon", { on: { click: (ev) => menu(ev.currentTarget, [
      { label: "Bearbeiten", icon: "edit", action: async () => { if (await editPerson(e)) reload(); } },
      { label: "Feld hinzufügen", icon: "plus", action: () => addField(e, { onDone: reload }) },
      e.is_self ? null : { label: "Zusammenführen mit …", icon: "merge", action: () => pickPerson(ev.target, { exclude: [id], allowNew: false, onPick: (r) => (location.hash = `#/merge/${id}/${r.id}`) }) },
      e.is_self ? null : { label: e.on_phone ? "Nicht mehr aufs Handy" : "Aufs Handy", icon: "smartphone", action: async () => { await PATCH("/entities/" + id, { on_phone: !e.on_phone }); reload(); } },
      { label: "Verlauf als JSON", icon: "history", action: async () => modal("Verlauf", h("div.code", JSON.stringify(await GET(`/entities/${id}/history`), null, 2)), [], { wide: true }) },
    ], { align: "right" }) } }, icon("more")));

  // Ihr zwei
  const ring = e.level;
  const ihr = e.is_self ? null : h("div.card",
    h("div.card-h", h("div.row", h("span.small.t2", "Ihr zwei"), h("button.chip.sel", { style: { cursor: "pointer" }, on: { click: async () => { if (await editIhrZwei(e)) reload(); } } }, bundKindName(e.ihr_zwei?.kind_id), " ▾")),
      e.ist ? h("span.small.t2", `Ist: Ring ${e.ist.ring} · letzter Kontakt ${rel(e.ist.last)}`, e.long_unseen ? h("span.tag.yellow", { style: { marginLeft: "6px" } }, "lange nicht gesehen") : null) : null),
    h("div.card-b.row", { style: { gap: "24px", alignItems: "flex-start" } },
      S.settings.use_levels ? h("div.col", { style: { alignItems: "center" } },
        ringDrag(ring, async (l) => { await setRing(id, l); reload(); }),
        h("button.btn.sm.ghost", { on: { click: (ev) => ringPopup(ev.currentTarget, ring, async (l) => { await setRing(id, l); reload(); }) } }, h("b", ringName(ring)), icon("down"))) : null,
      h("div.fields2.grow", bundFields().filter((d) => d.id !== "f_level").map((d) => fieldCell(d, iz[d.id] || [], `/entities/${id}/fields/${d.id}`, e, reload, true)))));

  // Felder
  const fl = entityFieldList(e, { all: false });
  const fields = h("div.card", h("div.card-h", h("h3", "Felder"), h("button.btn.sm", { on: { click: () => addField(e, { onDone: reload }) } }, icon("plus"), "Feld")),
    h("div.card-b", fl.length ? h("div.fields2", fl.map(({ def, vals }) => fieldCell(def, vals, `/entities/${id}/fields/${def.id}`, e, reload))) : h("div.empty", "Noch keine Felder. Ein Eintrag beginnt mit Kontext und wird nach und nach zur Person.")));

  // rechte Spalte: Bünde, Kreise, Verlauf, Routinen
  const bunds = h("div.card", h("div.card-h", h("h3", "Bünde"), h("button.btn.sm", { on: { click: (ev) => pickPerson(ev.currentTarget, { exclude: [id, S.me.self_id], onPick: async (r) => { if (await addBund(e, r)) reload(); } }) } }, icon("plus"), "Bund")),
    h("div.card-b.col", e.bunds.length ? e.bunds.map((b) => h("div.row", avatar({ display: b.other_name, name: b.other_name, main_circle_id: (S.rows || []).find((r) => r.id === b.other_id)?.main_circle_id }, 24),
      h("a.grow", { href: "#/p/" + b.other_id }, b.other_name), h("span.small.t2", b.role_other ? `${b.role_other}` : bundKindName(b.kind_id)),
      h("button.btn.sm.ghost.icon", { on: { click: (ev) => menu(ev.currentTarget, [
        { label: "Art ändern", action: async () => { const k = h("select.input", S.bundKinds.map((x) => h("option", { value: x.id, selected: x.id === b.kind_id }, x.name))); if (await modal("Bund-Art", k, [{ label: "OK", primary: true, action: () => PATCH("/bunds/" + b.id, { kind_id: k.value }) }])) reload(); } },
        { label: "Bund-Felder (z.B. Jahrestag)", action: async () => { const d = S.fields.f_anniv; if (d && await editField(d, b.fields.f_anniv || [], `/bunds/${b.id}/fields/f_anniv`)) reload(); } },
        { label: "Bund löschen", icon: "trash", action: async () => { if (await confirmDlg("Bund löschen?", `Bund mit ${b.other_name} löschen.`, "Löschen", true)) { await DEL("/bunds/" + b.id); invalidate(); reload(); } } }], { align: "right" }) } }, icon("more"))))
      : h("div.t3.small", "Noch keine Bünde zu anderen.")));
  const allRows = await rows();
  const myC = new Set(e.memberships.filter((m) => m.active).map((m) => m.circle_id));
  const knows = e.is_self ? [] : allRows.filter((r) => r.id !== id && !r.is_self && r.circles.some((c) => myC.has(c)));
  const knowsCard = knows.length ? h("div.card", h("div.card-h", h("h3", "Kennt vermutlich"), h("span.small.t2", knows.length)),
    h("div.card-b.col", h("p.tiny.t3", "Abgeleitet aus gemeinsamen Kreisen – nicht gespeichert."),
      h("div.row.wrap", { style: { gap: "4px" } }, knows.slice(0, 40).map((r) => h("a", { href: "#/p/" + r.id, title: r.display + " · " + r.circles.filter((c) => myC.has(c)).map((c) => S.circles[c]?.name).join(", ") }, avatar(r, 28)))))) : null;
  const circles = h("div.card", h("div.card-h", h("h3", "Kreise"), h("button.btn.sm", { on: { click: (ev) => addToCircle(ev.currentTarget, e, () => { reloadCircles(); reload(); }) } }, icon("plus"), "Kreis")),
    h("div.card-b.col", e.memberships.length ? e.memberships.map((m) => h("div.clabel" + (m.active ? "" : ".past"), { style: { "--cb": circleColors(m.circle_id).bg, "--cf": circleColors(m.circle_id).fg } },
      h("a.clabel-main", { href: "#/c/" + m.circle_id },
        m.circle_id === e.main_circle_id ? h("span.clabel-star", { title: "Hauptkreis" }, icon("star")) : null,
        h("span.grow", h("b", S.circles[m.circle_id]?.name || m.circle_name), h("span.clabel-sub", [circleColors(m.circle_id).kind, m.role].filter(Boolean).join(" · "))),
        h("span.clabel-date", { title: m.approx_from ? "ungefähr – ohne „Gültig von“ zählt das Erfasst-Datum" : null },
          m.active ? (m.approx_from ? "seit ≈ " : "seit ") + (m.valid_from || (m.created_at || "").slice(0, 10)) : `bis ${m.valid_to}`)),
      h("button.btn.sm.ghost.icon.clabel-more", { on: { click: (ev) => menu(ev.currentTarget, [
        m.active && m.circle_id !== e.main_circle_id ? { label: "Als Hauptkreis", icon: "star", action: async () => { await PATCH("/entities/" + id, { main_circle_id: m.circle_id }); invalidate(); reload(); } } : null,
        { label: "Rolle, von, bis …", icon: "edit", action: async () => {
          const role = h("input.input", { value: m.role || "" }), vf = dateInput(m.valid_from || ""), vt = dateInput(m.valid_to || "");
          if (await modal("Mitgliedschaft", h("div.col", h("label.f", "Rolle", role), h("label.f", "Von (leer = Erfasst-Datum, ungefähr)", vf), h("label.f", "Bis", vt)),
            [{ label: "Speichern", primary: true, action: () => PATCH("/memberships/" + m.id, { role: role.value || null, valid_from: vf.value || null, valid_to: vt.value || null }) }])) { invalidate(); reload(); } } },
        m.active ? { label: "Aus Kreis nehmen (bis heute)", icon: "x", action: async () => { await POST(`/memberships/${m.id}/end`); invalidate(); reload(); } } : null,
        { label: "Mitgliedschaft löschen", icon: "trash", action: async () => { await DEL("/memberships/" + m.id); invalidate(); reload(); } }], { align: "right" }) } }, icon("more"))))
      : h("div.t3.small", "In keinem Kreis – steht unter „Lose“.")));
  circles.querySelector(".card-b")?.classList.add("clabels");
  const hist = (await GET(`/entities/${id}/history?limit=60`)).filter((x) => !["role_a", "role_b"].includes(x.attr));
  const histBox = h("div.timeline");
  const drawHist = (n) => clear(histBox, hist.slice(0, n).map((x) => h("div.ev", h("span.dot"), h("div", h("div.mono.t3", x.at.slice(0, 10)), h("div", historyText(x)), x.source && x.source !== "manual" ? h("div.tiny.t3", SOURCE(x.source)) : null))),
    hist.length > n ? h("button.btn.sm.ghost", { style: { alignSelf: "flex-start" }, on: { click: () => drawHist(999) } }, "Ganzen Verlauf zeigen") : null);
  drawHist(6);
  const timeAt = dateInput("", { placeholder: "Datum wählen" });
  timeAt.addEventListener("change", async () => {
    const day = timeAt.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return toast("Für den Stand ein vollständiges Datum wählen");
    const st = await GET(`/entities/${id}/at?date=${day}`);
    modal(`Stand am ${day}`, h("div.col", st.existed ? null : h("div.hint", "Damals noch nicht erfasst" + (st.approx ? " (ungefähr – ohne „Gültig von“ zählt das Erfasst-Datum)" : "")),
      Object.entries(st.fields).map(([fid, vals]) => h("div.row", h("span.t2", { style: { width: "160px" } }, S.fields[fid]?.name || fid), h("span", vals.map((v) => plain(S.fields[fid] || { type: "text" }, v.value, e.names)).join(", ")))),
      h("div.small.t2", "Kreise: " + (st.memberships.map((m) => S.circles[m.circle_id]?.name).join(", ") || "–"))), []);
  });
  const verlauf = h("div.card", h("div.card-h", h("h3", "Verlauf"), h("span.row.small.t2", "Stand am", timeAt)), h("div.card-b", hist.length ? histBox : h("div.t3", "Noch keine Änderungen.")));
  const routines = e.routines.length ? h("div.card", h("div.card-h", h("h3", "Routinen, die hier greifen")), h("div.card-b.col", e.routines.map((r) => h("div.row", h("span.tag", r.next ? r.next : "aktiv"), h("a", { href: "#/settings/routines?r=" + r.id }, r.name), h("span.small.t3", r.trigger_text))))) : null;
  const notes = e.notes?.length ? h("div.card", h("div.card-h", h("h3", "Notizen")), h("div.card-b.col", e.notes.map((n) => h("div", h("span.mono.t3", n.day + " "), h("span.tag", n.role), " ", n.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1").slice(0, 140))))) : null;
  const suggBox = sugg.length ? h("div.card", h("div.card-h", h("h3", "Vorschläge")), h("div.card-b.col", sugg.map((s) => h("div.row",
    h("div.grow.small", h("b", s.field_name || (s.kind === "name" ? "Name" : s.kind)), ": ", typeof s.payload.value === "object" ? JSON.stringify(s.payload.value) : s.payload.value, h("div.t3.tiny", (s.payload.why || "") + " · " + SOURCE(s.source))),
    h("button.btn.sm", { on: { click: async () => { await POST(`/suggestions/${s.id}/accept`); invalidate(); reload(); } } }, "Übernehmen"),
    h("button.btn.sm.ghost.icon", { on: { click: async () => { await POST(`/suggestions/${s.id}/reject`); reload(); } } }, icon("x")))))) : null;
  page.append(h("a.crumb", { href: "#/people" }, icon("left"), "Personen"), head, dupHint(e, { desktop: true, onChange: reload }),
    h("div.pgridx", h("div.col", { style: { gap: "16px" } }, ihr, fields, notes), h("div.col", { style: { gap: "16px" } }, suggBox, bunds, circles, knowsCard, verlauf, routines)));
}

function fieldCell(def, vals, path, e, reload, compact = false) {
  const live = vals.filter((v) => !v.deprecated);
  const p = primaryOf(vals);
  const ordered = p ? [p, ...live.filter((v) => v !== p)] : live;
  const quick = def.quick_routine_id && !e.is_self && def.scope !== "bund";
  const edit = async () => { if (await editField(def, vals, path)) reload(); };
  const valueLine = (v, isMain) => {
    const act = actionFor(def, v.value);
    const svc = def.type === "profile" ? service(v.value?.service) : null;
    const label = v.label && (!svc || v.label.toLowerCase() !== svc.name.toLowerCase()) ? v.label : null;
    const shown = def.type === "profile" ? h("span.fl-val" + (v.uncertain ? ".unsure-val" : ""), v.value?.handle || v.value?.id || v.value?.url || "") : valueEl(def, v, e.names);
    return h("div.fl-line" + (isMain ? ".first" : ""),
      svc ? h("span.fl-svc", svc.name) : null,
      h("span.fl-text", shown, def.id === "f_seen" ? h("span.t3.small", " · " + rel(v.value)) : null),
      label ? h("span.fl-lab", label) : null,
      act ? h("a.btn.sm.icon.fl-act", { href: act.href, title: act.label, target: act.href.startsWith("http") ? "_blank" : null, rel: "noopener", on: { click: (ev) => ev.stopPropagation() } }, icon(act.icon)) : null);
  };
  return h("div.fld", { on: { click: edit }, style: { cursor: "pointer" }, title: `${def.name} bearbeiten (${def.id})` },
    h("div.grow",
      h("div.k", def.name, live.length > 1 ? h("span.fl-count", live.length) : null, p?.source && p.source !== "manual" ? h("span.tiny.t3", SOURCE(p.source)) : null,
        quick ? h("button.btn.sm.icon.fl-quick", { title: "Schnellaktion", on: { click: async (ev) => { ev.stopPropagation(); await runQuick(e.id, def.quick_routine_id); reload(); } } }, icon(def.type === "number" ? "plus" : "refresh")) : null),
      ordered.length ? h("div.fl-lines", ordered.map((v, i) => valueLine(v, i === 0))) : h("div.v.empty-v", "–")));
}

// ---------------------------------------------------------------- Kreise
async function circlesPage(main, sub) {
  await reloadCircles();
  const page = h("div.page"); main.append(page);
  const mode = sub || LS("cview", "table"); SAVE("cview", mode);
  const cs = Object.values(S.circles);
  page.append(h("div.page-h", h("h1", "Kreise"), h("button.btn.primary", { on: { click: () => newCircle() } }, icon("plus"), "Kreis anlegen")),
    h("div.toolbar", h("div.seg", [["table", "Tabelle", "table"], ["areas", "Bereiche", "layers"]].map(([k, l, ic]) => h("button" + (mode === k ? ".on" : ""), { on: { click: () => (location.hash = "#/circles/" + k) } }, icon(ic), l))),
      h("span.grow"), h("a.btn.sm", { href: "#/settings/circle-kinds" }, "Kreis-Arten")));
  if (mode === "areas") return (await import("./viz.js")).areas(page, await rows());
  const tops = cs.filter((c) => !c.parent_id).sort((a, b) => a.name.localeCompare(b.name));
  const order = tops.flatMap((c) => [c, ...cs.filter((x) => x.parent_id === c.id).sort((a, b) => a.name.localeCompare(b.name))]);
  order.push(...cs.filter((c) => c.parent_id && !S.circles[c.parent_id]));
  const t = h("table.mtable", h("tr", h("th", "Name"), h("th", "Art"), h("th", "Liegt in"), h("th", "Mitglieder"), h("th", "Angelegt"), h("th")),
    order.map((c) => h("tr",
      h("td", { style: c.parent_id ? { paddingLeft: "34px" } : null }, h("a", { href: "#/c/" + c.id }, circleChip(c.id))),
      h("td", h("select.input", { style: { height: "28px" }, on: { change: async (e) => { await PATCH("/circles/" + c.id, { kind_id: e.target.value }); await reloadCircles(); invalidate(); } } },
        Object.values(S.kinds).map((k) => h("option", { value: k.id, selected: k.id === c.kind_id }, k.name)))),
      h("td", c.parent_id ? S.circles[c.parent_id]?.name : h("span.t3", "–")),
      h("td", c.count, c.children.length ? h("span.t3.small", ` (inkl. ${c.children.length} Unterkreis${c.children.length > 1 ? "e" : ""})`) : null),
      h("td.mono.t2", (c.created_at || "").slice(0, 10)),
      h("td", h("button.btn.sm.ghost.icon", { on: { click: (ev) => circleMenu(ev.currentTarget, c, () => rebuild(main, (m) => circlesPage(m, sub))) } }, icon("more"))))));
  page.append(h("div.card", cs.length ? t : h("div.empty", "Noch keine Kreise. Kreise sind Gruppen ohne Beziehungsbedeutung: Familie, Klasse, Firma, Verein …")));
}

function circleMenu(anchor, c, done) {
  menu(anchor, [
    { label: "Umbenennen", icon: "edit", action: async () => { const n = await promptDlg("Umbenennen", "Name", c.name); if (n) { await PATCH("/circles/" + c.id, { name: n }); await reloadCircles(); done(); } } },
    { label: "In anderen Kreis legen …", icon: "layers", action: () => pickCircle(anchor, { exclude: [c.id], allowNew: false, onPick: async (p) => { await PATCH("/circles/" + c.id, { parent_id: p.id }); await reloadCircles(); done(); } }) },
    c.parent_id ? { label: "Aus Oberkreis lösen", action: async () => { await PATCH("/circles/" + c.id, { parent_id: null }); await reloadCircles(); done(); } } : null,
    { label: "Löschen", icon: "trash", action: async () => { if (await confirmDlg("Kreis löschen?", `„${c.name}“ und alle Mitgliedschaften löschen? Personen bleiben.`, "Löschen", true)) { await DEL("/circles/" + c.id); await reloadCircles(); invalidate(); done(); } } }], { align: "right" });
}

export async function newCircle(prefill = {}) {
  const n = h("input.input", { placeholder: "Name", value: prefill.name || "" });
  const k = h("select.input", Object.values(S.kinds).map((x) => h("option", { value: x.id }, x.name)));
  const p = h("select.input", h("option", { value: "" }, "– (oberste Ebene)"), Object.values(S.circles).filter((c) => !c.parent_id).map((c) => h("option", { value: c.id }, c.name)));
  const r = await modal("Kreis anlegen", h("div.col", h("label.f", "Name", n), h("label.f", "Kreis-Art (bestimmt Farbe und Sektor)", k), h("label.f", "Liegt in (eine Ebene tief, z.B. Schule → Klasse)", p)),
    [{ label: "Abbrechen" }, { label: "Anlegen", primary: true, action: () => POST("/circles", { name: n.value, kind_id: k.value, parent_id: p.value || null, members: prefill.members || [] }).catch(() => false) }]);
  if (r) { await reloadCircles(); invalidate(); location.hash = "#/c/" + r.id; }
}

async function circlePage(main, id) {
  const c = await GET("/circles/" + id);
  const page = h("div.page"); main.append(page);
  const reload = () => rebuild(main, (m) => circlePage(m, id));
  const all = await rows();
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const showPast = LS("past", false);
  const mem = c.members.filter((m) => showPast || m.active);
  const t = h("table.mtable", h("tr", h("th", "Person"), h("th", "Rolle"), h("th", "Von"), h("th", "Bis"), h("th", "Kreis"), h("th")),
    mem.map((m) => { const r = byId[m.entity_id] || { display: m.name, name: m.name };
      const edit = (k) => k === "role" ? h("input.input", { value: m[k] || "", style: { width: "150px" }, on: { change: async (e) => { await PATCH("/memberships/" + m.id, { [k]: e.target.value || null }); invalidate(); } } })
        : dateInput(m[k] || "", { placeholder: k === "valid_from" ? "≈ " + (m.created_at || "").slice(0, 10) : "", onChange: async (v) => { await PATCH("/memberships/" + m.id, { [k]: v || null }); invalidate(); } });
      return h("tr" + (m.active ? "" : ".t3"), h("td", h("a.row", { href: "#/p/" + m.entity_id }, avatar(r, 24), nameEl(r))), h("td", edit("role")), h("td", edit("valid_from")), h("td", edit("valid_to")),
        h("td", m.inherited ? circleChip(m.circle_id) : h("span.t3", "direkt")),
        h("td", m.active ? h("button.btn.sm", { title: "Rausziehen setzt „bis heute“ und löscht nichts", on: { click: async () => { await POST(`/memberships/${m.id}/end`); invalidate(); reload(); } } }, "Austragen") : null)); }));
  page.append(h("a.crumb", { href: "#/circles" }, icon("left"), "Kreise"),
    h("div.page-h", h("h1", c.name), circleChip(id), c.parent_id ? h("span.small.t2", "in ", h("a", { href: "#/c/" + c.parent_id }, S.circles[c.parent_id]?.name)) : null,
      h("button.btn", { on: { click: (ev) => pickPerson(ev.currentTarget, { onPick: async (r) => { await POST(`/circles/${id}/members`, { entity_id: r.id }); invalidate(); reload(); } }) } }, icon("plus"), "Mitglied"),
      h("button.btn.icon", { on: { click: (ev) => circleMenu(ev.currentTarget, c, () => { location.hash = "#/circles"; }) } }, icon("more"))),
    h("div.toolbar", h("span.t2", `${c.count} Mitglieder`), c.children.length ? h("span.row", "Unterkreise:", c.children.map((x) => h("a", { href: "#/c/" + x }, circleChip(x)))) : null,
      h("span.grow"), h("label.check.small", h("input", { type: "checkbox", checked: showPast, on: { change: (e) => { SAVE("past", e.target.checked); reload(); } } }), "Ehemalige zeigen")),
    h("div.card", mem.length ? t : h("div.empty", "Noch niemand in diesem Kreis.")),
    h("div.card", h("div.card-h", h("h3", "Kreis-Felder")), h("div.card-b.fields2", S.fieldList.filter((f) => f.scope === "kreis").map((d) => fieldCell(d, c.fields[d.id] || [], `/circles/${id}/fields/${d.id}`, { id, names: {}, is_self: true }, reload)))));
}

// ---------------------------------------------------------------- Heute & Notizen
async function todayPage(main) {
  const page = h("div.page", { style: { maxWidth: "720px" } }); main.append(page);
  const m = await import("./mobile.js");
  const inner = h("div.col.mob", { style: { minHeight: 0, background: "transparent" } });
  page.append(inner); await m.todayPage(inner);
  inner.querySelector(".mtop")?.remove();
}

async function notesPage(main) {
  const page = h("div.page"); main.append(page);
  const { noteEditor } = await import("./notes.js");
  const q = h("input.input", { placeholder: "Notizen durchsuchen", style: { width: "240px" } });
  const list = h("div.col");
  const draw = async () => {
    const notes = await GET("/notes" + qs({ q: q.value }));
    clear(list, notes.length ? notes.map((n) => h("div.card.pad.col", { style: { cursor: "pointer" }, on: { click: async () => { if (await noteEditor(n)) draw(); } } },
      h("div.row.small", h("span.mono.t2", n.day), h("span.t2", "Dabei:"), n.links.filter((l) => l.role === "dabei").map((l) => h("a.chip.sel", { href: "#/p/" + l.entity_id, on: { click: (e) => e.stopPropagation() } }, l.display)),
        n.links.filter((l) => l.role !== "dabei").length ? h("span.t3", "erwähnt: " + n.links.filter((l) => l.role !== "dabei").map((l) => l.display).join(", ")) : null),
      h("div", { style: { whiteSpace: "pre-wrap" } }, n.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")))) : h("div.card.empty", "Noch keine Notizen."));
  };
  q.addEventListener("input", debounce(draw, 200));
  page.append(h("div.page-h", h("h1", "Notizen"), q, h("button.btn.primary", { on: { click: async () => { if (await noteEditor()) draw(); } } }, icon("plus"), "Notiz")), list);
  draw();
}

// Ring auf der Personenseite per Ziehen: Abstand vom Mittelpunkt = Ring
function ringDrag(level, onSet) {
  const size = 96, c = size / 2, band = 11;
  const svg = h("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: { cursor: "grab", touchAction: "none" } });
  for (let i = 4; i >= 1; i--) svg.append(h("circle", { cx: c, cy: c, r: band * i, fill: i === +level ? V("--yellow-light") : i <= 2 ? V("--bg") : V("--white"), stroke: i === +level ? V("--yellow-line") : V("--line") }));
  svg.append(h("circle", { cx: c, cy: c, r: 3, fill: V("--ink") }));
  const dot = h("circle", { cx: c + (level ? band * (level - 0.5) : band * 4.3), cy: c, r: 6, fill: V("--white"), stroke: V("--ink"), "stroke-width": 2 });
  svg.append(dot);
  let drag = false;
  const pos = (e) => { const r = svg.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * size, y: ((e.clientY - r.top) / r.height) * size }; };
  svg.addEventListener("pointerdown", (e) => { drag = true; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => { if (!drag) return; const p = pos(e); dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); });
  svg.addEventListener("pointerup", (e) => {
    if (!drag) return; drag = false; const p = pos(e); const d = Math.hypot(p.x - c, p.y - c);
    const l = d > band * 4.2 ? null : Math.min(4, Math.max(1, Math.ceil(d / band)));
    if (l !== level) onSet(l);
  });
  svg.append(h("title", "Ziehen setzt den Ring"));
  return svg;
}
