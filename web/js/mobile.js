// Ist kein Knopf der Hauptknopf (z.B. ohne „Heute gesehen“), wird der erste benutzbare es
const primaryFirst = (box) => { if (!box.querySelector(".btn.primary")) box.querySelector(".btn:not([disabled])")?.classList.add("primary"); return box; };
// Handy (PWA): schnell erfassen und finden. Untere Leiste: Personen, Kreise, Plus, Suche, Ich.
import { S, h, icon, GET, POST, PATCH, DEL, clear, rebuild, optimistic, hasSeen, rows, themePref, setTheme, invalidate, avatar, circleChip, nameEl, rel, ringName, today, debounce,
  postOrQueue, getOrBack, toast, modal, logo, qs, queued, fmtDate, menu, pickPerson } from "./core.js";
import { primaryOf, valueEl, actionFor, editField, entityFieldList, runQuick, plain, bundFields, fieldSections, humanDate } from "./fields.js";
import { LOCALE } from "./i18n.js";
import { sourceName } from "./fields.js";
import { guideAttach } from "./guide.js";
import { editPerson, addField, dupHint, ringPopup, setRing, editIhrZwei, bundKindName, historyText, deletePerson } from "./shared.js";

let search = "";

let lastPath = null;
export async function render(app, route) {
  const [p0, p1] = route.parts;
  const path = route.parts.join("/");
  const same = path === lastPath; lastPath = path;
  const page = h("div.mpage");
  const tab = !p0 || p0 === "v" ? (p0 === "v" ? "me" : "people") : ["settings", "notes", "today", "suggestions"].includes(p0) ? "me" : p0 === "c" ? "circles" : p0 === "p" ? "people" : p0;
  if (!p0 || p0 === "people" || p0 === "new") await people(page);
  else if (p0 === "p") await profile(page, p1);
  else if (p0 === "circles") await circles(page);
  else if (p0 === "c") await circle(page, p1);
  else if (p0 === "search") await searchPage(page);
  else if (p0 === "me") await mePage(page);
  else if (p0 === "today") await todayPage(page);
  else if (p0 === "suggestions") await suggestionsPage(page);
  else if (p0 === "notes") await notesPage(page);
  else if (p0 === "settings") await settingsMobile(page, p1, route);
  else if (p0 === "v") await savedViewMobile(page, p1);
  else if (p0 === "merge") { page.append(h("div.mtop", h("a.back", { href: "#/p/" + p1 }, icon("left"), "Zurück"))); const box = h("div.col.m-embed"); page.append(box); await (await import("./merge.js")).mergePage(box, p1, route.parts[2]); }
  else if (p0 === "api") await (await import("./apidocs.js")).apiDocs(page, route);
  else await people(page);
  const old = app.querySelector(".mpage");
  const scroll = same ? scrollY : 0;
  clear(app, h("div.mob", page, tabbar(tab)));
  scrollTo(0, scroll);
  if (!same && old) page.classList.add("enter");
  if (p0 === "new") capture(app);
}

async function settingsMobile(page, tab, route) {
  const { settingsPage } = await import("./settings.js");
  if (!tab) page.append(h("div.mtop", h("a.back", { href: "#/me" }, icon("left"), "Ich")));
  const box = h("div.msettings");
  await settingsPage(box, tab || null, route);
  page.append(box);
}

function tabbar(on) {
  const a = (id, ic, label) => h("a" + (on === id ? ".on" : ""), { href: "#/" + (id === "people" ? "" : id) }, icon(ic, "lg"), label);
  return h("nav.tabbar", a("people", "users", "Personen"), a("circles", "circles", "Kreise"),
    h("a", { href: "#/new", "aria-label": "Neue Person" }, h("span.plus", icon("plus"))), a("search", "search", "Suche"), a("me", "user", "Ich"));
}

function sub(r) {
  const seen = r.v.f_seen?.raw;
  return h("div.sub", r.main_circle_id ? circleChip(r.main_circle_id) : h("span.chip", "Lose"),
    r.kind === "pet" ? h("span", "Haustier") : null,
    seen ? h("span", rel(seen)) : h("span.t3", "erfasst " + rel(r.created_at?.slice(0, 10))));
}

export function personRow(r, onSeen) {
  const done = r.v.f_seen?.raw === today();
  return h("a.prow", { href: "#/p/" + r.id }, avatar(r, 38),
    h("div.grow", h("div.nm", nameEl(r)), sub(r)),
    r.is_self || !hasSeen() ? null : h("button.seen" + (done ? ".done" : ""), { title: "Heute gesehen", "aria-label": "Heute gesehen", on: { click: async (e) => {
      e.preventDefault(); e.stopPropagation();
      const res = await postOrQueue(`/seen-today/${r.id}`, {}, `${r.display} gesehen`);
      e.currentTarget?.classList.add("done");
      if (res) { invalidate(); onSeen?.(); toast(`${r.display}: heute gesehen`); }
    } } }, icon("eye")));
}

// Personenliste: dieselben Filter wie am Desktop (Zustand VS wird geteilt), dazu „zuletzt aktiv“ als Sortierung
let msort = "active";
const activity = (r) => [r.v.f_seen?.raw || "", (r.created_at || "").slice(0, 10)].sort().pop();
async function people(page, saved = null) {
  const D = await import("./desktop.js");
  const VS = D.VS;
  if (!saved && VS.fromSaved) Object.assign(VS, { fromSaved: false, savedId: null, hideSources: D.DEFAULT_HIDE, filter: "", circle: "", max_level: "", via: "", q: "", kind: "all", colFilters: {} });
  VS.view = "list";
  const all = await rows();
  const listBox = h("div.list");
  const nFilters = () => [VS.filter, VS.circle, VS.max_level, VS.via, VS.kind !== "all" ? VS.kind : ""].filter(Boolean).length
    + ((VS.hideSources || []).slice().sort().join() === (saved ? [] : D.DEFAULT_HIDE).slice().sort().join() ? 0 : 1);
  const draw = () => {
    let list = D.filterRows(all);
    if (msort === "active") list.sort((a, b) => activity(b).localeCompare(activity(a)) || a.display.localeCompare(b.display, LOCALE()));
    count.textContent = `${list.length} von ${all.filter((r) => !r.is_self).length}`;
    clear(listBox, list.length ? list.slice(0, 400).map((r) => personRow(r, () => rebuild(page, (p) => people(p, saved))))
      : h("div.empty", VS.filter === "lose" ? "Niemand unter „Lose“ – alles einsortiert." : nFilters() || VS.q ? "Keine Personen für diese Auswahl." : "Noch niemand hier. Tippe auf +."));
    if (list.length > 400) listBox.append(h("div.empty.small", `… und ${list.length - 400} weitere – Suche oder Filter grenzen ein.`));
    fbtn.lastChild.textContent = "Filter" + (nFilters() ? " · " + nFilters() : "");
  };
  const count = h("span.t2.small");
  const quick = (id, label) => h("span.chip" + (VS.filter === id ? ".dark" : ".plain"), { on: { click: () => { VS.filter = VS.filter === id ? "" : id; rebuild(page, (p) => people(p, saved)); } } }, label);
  const fbtn = h("span.chip.plain.m-fbtn", { on: { click: () => filterSheet(all, saved, () => rebuild(page, (p) => people(p, saved))) } }, icon("filter", "xs"), h("span", "Filter"));
  const q = h("input.input", { type: "search", placeholder: "Name, Kreis, Feld …", value: VS.q || "", on: { input: debounce((e) => { VS.q = e.target.value; draw(); }, 120) } });
  const todayN = (await GET("/today")).items.length;
  const pending = queued();
  const lose = all.filter((r) => !r.is_self && !r.circles.length).length;
  page.append(
    h("div.mtop", saved ? h("a.back", { href: "#/me" }, icon("left"), "Ich") : h("h1", "Personen"),
      h("div.row", todayN ? h("a.btn.sm", { href: "#/today" }, icon("bell"), `Heute · ${todayN}`) : null, count)),
    saved ? h("h1", saved.name) : null,
    pending ? h("div.hint", icon("upload"), h("div.grow", `${pending} Erfassung(en) warten auf Netz.`)) : null,
    q,
    h("div.filters", fbtn, quick("new", "Neu"), quick("lose", `Lose · ${lose}`), S.settings.use_ist ? quick("long_unseen", "Lange nicht gesehen") : null, quick("uncertain", "Unsicher")),
    h("div.small.t2", sortText()), listBox);
  draw();
}
function sortText() {
  if (msort === "active") return "Zuletzt aktiv";
  const k = msort.replace("-", "");
  const n = ({ name: "Name", created: "Erfasst", level: "Ring", seen: "Zuletzt gesehen" })[k] || S.fields[k]?.name || k;
  return `Sortiert: ${n} ${msort.startsWith("-") ? "↓" : "↑"}`;
}

// Unteres Blatt (Handy): Titel, Inhalt, Fertig
export function sheet(title, content, { onClose } = {}) {
  const close = () => { bd.remove(); sh.remove(); onClose?.(); };
  const sh = h("div.sheet-m", h("div.grab"), h("div.row.between", h("h2", title), h("button.btn.ghost.icon", { "aria-label": "Schließen", on: { click: close } }, icon("x"))), content);
  const bd = h("div.backdrop", { style: { alignItems: "flex-end", padding: 0 }, on: { click: close } });
  (document.querySelector(".mob") || document.body).append(bd, sh);
  return close;
}

async function filterSheet(all, saved, done) {
  const { VS, DEFAULT_HIDE } = await import("./desktop.js");
  const box = h("div.col.m-fsheet");
  const chips = (items, on, set) => h("div.sugg", items.map(([k, l]) => h("span.chip" + (on(k) ? ".sel" : ".plain"), { on: { click: () => { set(k); draw(); } } }, on(k) ? icon("check", "xs") : null, l)));
  const sel = (value, opts, set, empty) => h("select.input", { on: { change: (e) => { set(e.target.value); draw(); } } }, h("option", { value: "" }, empty), opts.map(([k, l]) => h("option", { value: k, selected: value === k }, l)));
  const vias = new Map(); for (const r of all) { const x = r.v.f_via; if (x?.raw?.type) vias.set(`${x.raw.type}:${x.raw.id}`, x.d); }
  const origins = new Map(); for (const r of all) if (!r.is_self) origins.set(r.origin || "manual", (origins.get(r.origin || "manual") || 0) + 1);
  if (!origins.has("card")) origins.set("card", 0);
  const oname = (o) => (o === "manual" ? "Von Hand angelegt" : sourceName(o));
  const sorts = [["active", "Zuletzt aktiv"], ["name", "Name"], ["created", "Erfasst"], ...(S.settings.use_levels ? [["level", "Ring"]] : []), ["seen", "Zuletzt gesehen"],
    ...S.fieldList.filter((f) => !["note", "image"].includes(f.type) && f.scope !== "kreis" && !["f_seen", "f_level"].includes(f.id)).map((f) => [f.id, f.name])];
  const draw = () => clear(box,
    h("div.lbl", "Zeigen"),
    chips([["new", "Neue Personen"], ["lose", "Lose (ohne Kreis)"], ...(S.settings.use_levels ? [["no_ring", "Ohne Ring"]] : []), ["uncertain", "Unsichere Angaben"],
      ...(S.settings.use_ist ? [["long_unseen", "Lange nicht gesehen"]] : [])], (k) => VS.filter === k, (k) => (VS.filter = VS.filter === k ? "" : k)),
    h("div.lbl", "Art"),
    chips([["all", "Alle"], ["person", "Menschen"], ["pet", "Haustiere"]], (k) => (VS.kind || "all") === k, (k) => (VS.kind = k)),
    S.settings.use_levels ? [h("div.lbl", "Ring höchstens"), chips([1, 2, 3, 4].map((n) => [String(n), ringName(n)]), (k) => VS.max_level === k, (k) => (VS.max_level = VS.max_level === k ? "" : k))] : null,
    h("label.f", "Kreis", sel(VS.circle, Object.values(S.circles).sort((a, b) => a.name.localeCompare(b.name, LOCALE())).map((c) => [c.id, c.name]), (v) => (VS.circle = v), "alle Kreise")),
    vias.size ? h("label.f", "Kennengelernt über", sel(VS.via, [...vias].sort((a, b) => a[1].localeCompare(b[1], LOCALE())), (v) => (VS.via = v), "egal")) : null,
    h("div.lbl", "Quelle (abgehakt = wird gezeigt)"),
    chips([...origins].sort((a, b) => oname(a[0]).localeCompare(oname(b[0]), LOCALE())).map(([o, n]) => [o, `${oname(o)} · ${n}`]),
      (o) => !(VS.hideSources || []).includes(o), (o) => { const s = new Set(VS.hideSources || []); s.has(o) ? s.delete(o) : s.add(o); VS.hideSources = [...s]; }),
    h("div.lbl", "Sortieren"),
    h("div.row", sel(msort.replace(/^-/, ""), sorts, (v) => (msort = v || "active"), "Zuletzt aktiv"),
      msort !== "active" ? h("button.btn", { on: { click: () => { msort = msort.startsWith("-") ? msort.slice(1) : "-" + msort; VS.sort = msort; draw(); } } }, msort.startsWith("-") ? "↓ absteigend" : "↑ aufsteigend") : null),
    h("div.row.wrap", { style: { marginTop: "6px" } },
      h("button.btn.primary.grow", { on: { click: () => close() } }, "Fertig"),
      h("button.btn", { on: { click: () => { Object.assign(VS, { filter: "", kind: "all", circle: "", max_level: "", via: "", q: "", hideSources: saved ? [] : DEFAULT_HIDE }); msort = "active"; draw(); } } }, "Zurücksetzen"),
      h("button.btn", { on: { click: () => saveViewMobile(saved, close) } }, icon("download"), saved ? "Ansicht speichern" : "Als Ansicht speichern")));
  draw();
  const close = sheet("Filter & Sortierung", box, { onClose: () => { if (msort !== "active") VS.sort = msort; done(); } });
}
async function saveViewMobile(saved, close) {
  const { VS } = await import("./desktop.js");
  const cfg = { hideSources: VS.hideSources || [], filter: VS.filter, kind: VS.kind, q: VS.q, sort: msort === "active" ? VS.sort : msort, circle: VS.circle, max_level: VS.max_level, via: VS.via, colFilters: {} };
  const { PUT, promptDlg } = await import("./core.js");
  if (saved) { await PUT("/views/" + saved.id, { view: saved.view, config: { ...saved.config, ...cfg } }); toast("Ansicht gespeichert"); close(); return; }
  const name = await promptDlg("Ansicht speichern", "Name", "");
  if (!name) return;
  const r = await POST("/views", { name, view: "list", tab: "people", config: cfg });
  S.views = await GET("/views"); close(); location.hash = "#/v/" + r.id;
}

// Gespeicherte Ansicht: Filter übernehmen; „Mögliche Doppelte“ hat eine eigene Seite
async function savedViewMobile(page, id) {
  const v = (S.views || []).find((x) => x.id === id);
  if (!v) return people(page);
  if (v.view === "duplicates") {
    page.append(h("div.mtop", h("a.back", { href: "#/me" }, icon("left"), "Ich")));
    const box = h("div.col.m-embed"); page.append(box);
    return (await import("./merge.js")).duplicatesPage(box, v);
  }
  const { VS } = await import("./desktop.js");
  Object.assign(VS, { filter: "", kind: "all", q: "", sort: "name", circle: "", max_level: "", via: "", colFilters: {}, hideSources: [], cfg: {} }, v.config, { savedId: v.id, fromSaved: true });
  msort = v.config?.sort || "name";
  return people(page, v);
}

// ---------------------------------------------------------------- Schnell erfassen
function capture(app) {
  let kind = "person", unknown = false, sugg = null;
  const accepted = { circle: true, met: true, seen: true };
  const inp = h("input.input", { placeholder: "z.B. Lisa oder „Typ aus dem Fitnessstudio“", autocomplete: "off" });
  const unk = h("input", { type: "checkbox" });
  const sbox = h("div.col");
  const close = () => { bd.remove(); sh.remove(); history.length > 1 ? history.back() : (location.hash = "#/"); };
  const drawSugg = () => {
    if (!sugg || !inp.value.trim()) return clear(sbox);
    const c = sugg.circle;
    const chip = (key, label) => h("span.chip" + (accepted[key] ? ".sel" : ".plain"), { on: { click: () => { accepted[key] = !accepted[key]; drawSugg(); } } }, accepted[key] ? icon("check", "xs") : null, label);
    clear(sbox,
      sugg.duplicates?.length ? h("div.hint", h("div.grow", h("b", "Schon da? "), sugg.duplicates.map((d, i) => h("a", { href: "#/p/" + d.id, on: { click: () => { bd.remove(); sh.remove(); } } }, (i ? ", " : "") + d.display + (d.circle ? " · " + d.circle : ""))))) : null,
      h("div.small.t2", "Vorschläge, antippen zum Übernehmen"),
      h("div.sugg", c ? chip("circle", `Kreis: ${c.name}${c.new ? " (neu)" : ""}`) : null, chip("met", "Kennengelernt: heute"), chip("seen", "Zuletzt gesehen: heute")),
      h("p.small.t3", "Alles Weitere kannst du später am Desktop ergänzen. " + (!c || !accepted.circle ? "Die Person landet bis dahin unter „Lose“." : "")));
  };
  const fetchSugg = debounce(async () => { const t = inp.value.trim(); if (!t) { sugg = null; return drawSugg(); } try { sugg = await GET("/capture/suggest" + qs({ text: t })); } catch (_) { sugg = { circle: null, duplicates: [] }; } drawSugg(); }, 200);
  inp.addEventListener("input", fetchSugg);
  const seg = h("div.seg");
  const drawSeg = () => clear(seg, [["person", "Mensch"], ["pet", "Haustier"]].map(([k, l]) => h("button" + (kind === k ? ".on" : ""), { on: { click: () => { kind = k; drawSeg(); } } }, l)));
  drawSeg();
  const save = async () => {
    const text = inp.value.trim(); if (!text) return inp.focus();
    const body = { text, kind, name_unknown: unk.checked, met_today: accepted.met, seen_today: accepted.seen,
      circle: sugg?.circle && accepted.circle ? (sugg.circle.new ? { name: sugg.circle.name, kind_id: sugg.circle.kind_id, new: true } : { id: sugg.circle.id }) : null };
    const e = await postOrQueue("/entities/quick", body, text);
    bd.remove(); sh.remove(); invalidate();
    if (e) { if (sugg?.circle?.new) { const { reloadCircles } = await import("./core.js"); await reloadCircles(); } location.hash = "#/p/" + e.id; }
    else location.hash = "#/";
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") save(); });
  const sh = h("div.sheet-m", h("div.grab"), h("div.row.between", h("h2", "Neue Person"), seg),
    h("label.f", "Wer ist das? Name oder Beschreibung", inp),
    h("label.check", unk, "Name noch unbekannt, als unsicher markieren"), sbox,
    h("button.btn.primary", { on: { click: save } }, "Speichern"), h("button.btn.ghost", { on: { click: close } }, "Abbrechen"));
  const bd = h("div.backdrop", { style: { alignItems: "flex-end", padding: 0 }, on: { click: close } });
  app.querySelector(".mob").append(bd, sh);
  setTimeout(() => inp.focus(), 50);
}

// ---------------------------------------------------------------- Profil
// Gleiche Karten wie am Desktop (Kreise, Bünde, Verlauf, Vorschläge, Notizen …), nur untereinander
async function profile(page, id) {
  const e = await getOrBack("/entities/" + id, "#/", "Person");
  if (!e) return;
  const reload = () => rebuild(page, (p) => profile(p, id));
  const { personCards } = await import("./desktop.js");
  const cards = await personCards(e, reload, { mobile: true });
  const phone = primaryOf(e.fields.f_phone), mail = primaryOf(e.fields.f_email);
  const iz = e.ihr_zwei?.fields || {};
  const ring = e.level;
  const tel = phone ? phone.value : null;
  const more = (ev) => menu(ev.currentTarget, [
    { label: "Bearbeiten", icon: "edit", action: async () => { if (await editPerson(e)) reload(); } },
    { label: "Feld hinzufügen", icon: "plus", action: () => addField(e, { onDone: reload }) },
      e.is_self ? null : { label: "Angaben prüfen lassen …", icon: "link", action: async () => { await (await import("./shared.js")).updateLinkDialog(e); reload(); } },
    e.is_self ? null : { label: "Zusammenführen mit …", icon: "merge", action: () => pickPerson(ev.target, { exclude: [id], allowNew: false, onPick: (r) => (location.hash = `#/merge/${id}/${r.id}`) }) },
    e.is_self ? null : { label: e.on_phone ? "Nicht mehr mit Handy synchronisieren" : "Mit Handy synchronisieren", icon: "smartphone", action: async () => { await PATCH("/entities/" + id, { on_phone: !e.on_phone }); invalidate(); reload(); } },
    e.is_self ? null : { label: "Person löschen", icon: "trash", action: () => deletePerson(e) },
  ], { align: "right" });
  page.append(
    cards.banner ? h("div.m-banner", cards.banner) : null, // Foto bis ganz nach oben, die Kopfzeile liegt darüber
    h("div.mtop" + (cards.banner ? ".m-top-over" : ""), h("a.back", { href: e.is_self ? "#/me" : "#/" }, icon("left"), e.is_self ? "Ich" : "Personen"),
      h("div.row", h("button.btn.ghost.sm", { on: { click: async () => { const r = await editPerson(e); if (r) reload(); } } }, "Bearbeiten"),
        h("button.btn.ghost.sm.icon", { "aria-label": "Mehr", on: { click: more } }, icon("more")))),
    h("div.col" + (cards.banner ? ".m-hero-over" : ""), { style: { alignItems: "center", gap: "6px", textAlign: "center" } },
      avatar(e, 72),
      h("h1", { style: { fontSize: "24px" } }, e.name || e.description || "Ohne Namen", " ", !e.name ? h("span.qmark", "ohne Namen") : e.name_uncertain ? h("span.qmark", "Name ?") : null),
      e.aliases?.length ? h("div.small.t2", "auch: " + e.aliases.join(", ")) : null,
      h("div.row.wrap", { style: { justifyContent: "center" } }, e.memberships.filter((m) => m.active).map((m) => circleChip(m.circle_id, { star: m.circle_id === e.main_circle_id })),
        e.kind === "pet" ? h("span.chip.plain", icon("paw"), "Haustier") : null,
        e.on_phone_effective ? h("span.chip.plain", icon("smartphone"), "Handy") : null)),
    dupHint(e, { onChange: reload }),
    e.is_self ? null : primaryFirst(h("div.qa",
      hasSeen() ? h("button.btn.primary.guide-seen", { on: { click: async () => { await postOrQueue(`/seen-today/${e.id}`, {}, e.display); invalidate(); reload(); } } }, icon("eye"), "Heute gesehen") : null,
      tel ? h("a.btn", { href: "tel:" + tel.replace(/[^\d+]/g, "") }, icon("phone"), "Anrufen") : h("button.btn", { on: { click: async () => { if (await editField(S.fields.f_phone, [], `/entities/${e.id}/fields/f_phone`)) reload(); } } }, icon("plus"), "Nummer"),
      tel ? h("a.btn", { href: "sms:" + tel.replace(/[^\d+]/g, "") }, icon("message"), "Schreiben") : mail ? h("a.btn", { href: "mailto:" + mail.value }, icon("mail"), "Schreiben") : h("button.btn", { disabled: true }, icon("message"), "Schreiben"))),
    e.is_self ? null : h("div.list",
      h("div.kv", { style: { background: "var(--bg)" } }, h("span.small.t2", "Ihr zwei"), h("a.small", { href: "#", on: { click: async (ev) => { ev.preventDefault(); if (await editIhrZwei(e)) reload(); } } }, bundKindName(e.ihr_zwei?.kind_id))),
      S.settings.use_levels ? h("div.kv.guide-ring", { on: { click: (ev) => ringPopup(ev.currentTarget, ring, async (l) => { await setRing(e.id, l); reload(); }) } }, h("span.k", "Ring"), h("span.v", ringName(ring),
        e.ist ? h("span.tag", `Ist ${e.ist.ring}`) : null)) : null,
      bundFields().filter((d) => d.id !== "f_level").map((d) => {
        const p = primaryOf(iz[d.id]);
        return h("div.kv", { "data-fid": d.id, on: { click: async () => { if (await editField(d, iz[d.id] || [], `/entities/${e.id}/fields/${d.id}`)) reload(); } } }, h("span.k", d.name), h("span.v", p ? (d.type === "date" ? humanDate(p.value) : valueEl(d, p, e.names)) : h("span.t3", "–")));
      })),
    h("div.m-cards", cards.self, cards.suggBox, cards.photos, cards.fields, cards.circles, cards.bunds, cards.notes, cards.verlauf, cards.knowsCard, cards.routines));
  guideAttach(e, { mobile: true });
}

// ---------------------------------------------------------------- Kreise
async function circles(page) {
  const { reloadCircles } = await import("./core.js"); await reloadCircles();
  const D = await import("./desktop.js");
  const cs = Object.values(S.circles).sort((a, b) => a.name.localeCompare(b.name, LOCALE()));
  const tops = cs.filter((c) => !c.parent_id);
  const order = [...tops.flatMap((c) => [c, ...cs.filter((x) => x.parent_id === c.id)]), ...cs.filter((c) => c.parent_id && !S.circles[c.parent_id])];
  page.append(h("div.mtop", h("h1", "Kreise"), h("button.btn.sm.primary", { on: { click: () => D.newCircle() } }, icon("plus"), "Kreis")),
    h("div.list", order.length ? order.map((c) =>
      h("a.prow", { href: "#/c/" + c.id, style: c.parent_id ? { paddingLeft: "34px" } : null }, circleChip(c.id), h("span.grow"), h("span.t2.small", c.count), icon("right"))) : h("div.empty", "Noch keine Kreise. Kreise sind Gruppen: Familie, Klasse, Firma, Verein …")),
    h("a.prow.m-link", { href: "#/settings/circle-kinds" }, icon("circles"), h("span.grow", "Kreis-Arten"), icon("right")));
}

let showPast = false;
async function circle(page, id) {
  const c = await getOrBack("/circles/" + id, "#/circles", "Kreis");
  if (!c) return;
  const D = await import("./desktop.js");
  const { fieldRow } = await import("./fields.js");
  const reload = () => rebuild(page, (p) => circle(p, id));
  const all = await rows();
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const mem = c.members.filter((m) => showPast || m.active);
  const editMembership = async (m) => {
    const { dateInput } = await import("./date.js");
    const role = h("input.input", { value: m.role || "" }), vf = dateInput(m.valid_from || ""), vt = dateInput(m.valid_to || "");
    if (await modal("Mitgliedschaft", h("div.col", h("label.f", "Rolle", role), h("label.f", "Von (leer = Erfasst-Datum, ungefähr)", vf), h("label.f", "Bis", vt)),
      [{ label: "Abbrechen" }, { label: "Speichern", primary: true, action: () => PATCH("/memberships/" + m.id, { role: role.value || null, valid_from: vf.value || null, valid_to: vt.value || null }) }])) { invalidate(); reload(); }
  };
  const row = (m) => {
    const r = byId[m.entity_id] || { display: m.name, name: m.name };
    const when = m.active ? (m.valid_from ? "seit " + m.valid_from : "seit ≈ " + (m.created_at || "").slice(0, 10)) : "bis " + m.valid_to;
    return h("div.prow" + (m.active ? "" : ".past"), h("a.row.grow", { href: "#/p/" + m.entity_id, style: { minWidth: 0, textDecoration: "none" } }, avatar(r, 36),
      h("div.grow", { style: { minWidth: 0 } }, h("div.nm", nameEl(r)), h("div.sub", [m.role, when].filter(Boolean).join(" · "), m.inherited ? circleChip(m.circle_id) : null))),
      m.inherited ? null : h("button.btn.sm.ghost.icon", { "aria-label": "Mehr", on: { click: (ev) => menu(ev.currentTarget, [
        { label: "Rolle, von, bis …", icon: "edit", action: () => editMembership(m) },
        m.active ? { label: "Austragen (bis heute)", icon: "x", action: async () => { await POST(`/memberships/${m.id}/end`); invalidate(); reload(); } } : null,
        { label: "Mitgliedschaft löschen", icon: "trash", action: async () => { await DEL("/memberships/" + m.id); invalidate(); reload(); } }], { align: "right" }) } }, icon("more")));
  };
  const kreisFelder = S.fieldList.filter((f) => f.scope === "kreis");
  page.append(
    h("div.mtop", h("a.back", { href: "#/circles" }, icon("left"), "Kreise"),
      h("button.btn.ghost.sm.icon", { "aria-label": "Mehr", on: { click: (ev) => D.circleMenu(ev.currentTarget, c, () => { location.hash = "#/circles"; }) } }, icon("more"))),
    h("div.col", { style: { gap: "6px" } }, h("h1", c.name),
      h("div.row.wrap", circleChip(id), c.parent_id ? h("span.small.t2", "in ", h("a", { href: "#/c/" + c.parent_id }, S.circles[c.parent_id]?.name)) : null, h("span.t2.small", `${c.count} Mitglieder`)),
      c.children.length ? h("div.row.wrap", h("span.small.t2", "Unterkreise:"), c.children.map((x) => h("a", { href: "#/c/" + x }, circleChip(x)))) : null),
    h("div.row", h("button.btn.primary.grow", { on: { click: (ev) => pickPerson(ev.currentTarget, { onPick: async (r) => { await POST(`/circles/${id}/members`, { entity_id: r.id }); invalidate(); reload(); } }) } }, icon("plus"), "Mitglied"),
      h("label.check.small", h("input", { type: "checkbox", checked: showPast, on: { change: (e) => { showPast = e.target.checked; reload(); } } }), "Ehemalige")),
    h("div.list", mem.length ? mem.map(row) : h("div.empty", "Noch niemand in diesem Kreis.")),
    kreisFelder.length ? h("div.card", h("div.card-h", h("h3", "Kreis-Felder")), h("div.card-b.fs-rows", kreisFelder.map((d) => fieldRow(d, c.fields[d.id] || [], `/circles/${id}/fields/${d.id}`, { id, names: {}, is_self: true }, reload)))) : null);
}

// ---------------------------------------------------------------- Suche
async function searchPage(page) {
  const box = h("div.list");
  const inp = h("input.input", { placeholder: "Suchen in Namen, Aliasen, Kreisen und Feldern", value: search });
  const run = debounce(async () => {
    const q = inp.value.trim(); search = q;
    if (!q) return clear(box, h("div.empty", "Tippe, um zu suchen."));
    const res = await GET("/entities" + qs({ q }));
    clear(box, res.length ? res.map((r) => personRow(r)) : h("div.empty", "Nichts gefunden."));
  }, 150);
  inp.addEventListener("input", run);
  page.append(h("div.mtop", h("h1", "Suche")), inp, box); run(); setTimeout(() => inp.focus(), 30);
}

// ---------------------------------------------------------------- Ich
async function mePage(page) {
  const me = await GET("/entities/" + S.me.self_id);
  const [sugg, card] = await Promise.all([GET("/suggestions"), GET("/card").catch(() => null)]);
  const cardUrl = card?.enabled ? location.origin + card.path : null;
  const showQr = async () => { const { qrDialog } = await import("./qr.js"); qrDialog("Meine Visitenkarte", cardUrl, { hint: "Gegenüber scannt den Code mit der Kamera und sieht deine Angaben.", book: true }); };
  page.append(h("div.mtop", h("h1", "Ich"), logo()),
    h("div.list", h("a.prow", { href: "#/p/" + me.id }, avatar({ ...me, is_self: true }, 42), h("div.grow", h("div.nm", me.display), h("div.sub", "Mein Profil")), icon("right")),
      cardUrl ? h("button.prow.m-qr", { on: { click: showQr } }, h("span.m-qr-ic", icon("qr")), h("div.grow", h("div.nm", "Visitenkarte zeigen"), h("div.sub.mono", location.host + card.path)), icon("right"))
        : h("a.prow", { href: "#/settings/card" }, h("span.m-qr-ic", icon("idcard")), h("div.grow", h("div.nm", "Visitenkarte"), h("div.sub", "Aus – einschalten, um sie per QR-Code zu teilen")), icon("right"))),
    h("div.list",
      h("a.prow", { href: "#/today" }, icon("bell"), h("span.grow", "Heute")),
      S.settings.notes_enabled ? h("a.prow", { href: "#/notes" }, icon("note"), h("span.grow", "Notizen")) : null,
      h("a.prow", { href: "#/", on: { click: async () => { const { VS } = await import("./desktop.js"); VS.filter = "lose"; } } }, icon("layers"), h("span.grow", "Lose aufräumen"))),
    (S.views || []).length ? h("div.list", h("div.kv", h("span.small.t2", "Gespeicherte Ansichten")),
      S.views.map((v) => h("a.prow", { href: "#/v/" + v.id }, icon(v.view === "duplicates" ? "merge" : "list"), h("span.grow", v.name), icon("right")))) : null,
    sugg.length ? h("div.list", h("a.prow", { href: "#/suggestions" }, icon("merge"), h("span.grow", "Vorschläge"), h("span.tag.yellow", String(sugg.length)), icon("right"))) : null,
    h("div.list",
      h("div.kv", h("span.k", "Angemeldet als"), h("span.v", S.me.username)),
      h("div.kv", h("span.k", "Mit Handy synchronisiert"), h("span.v", ({ all: "Jeder", rule: "Nach Regel", none: "Niemand" })[S.settings.sync?.mode])),
      h("div.kv", h("span.k", "CardDAV"), h("span.v.mono.small", location.origin + "/dav/"))),
    h("div.list",
      h("div.kv", h("span.k", "Darstellung"), h("div.seg", [["system", "System"], ["light", "Hell"], ["dark", "Dunkel"]].map(([k, l]) =>
        h("button" + (themePref() === k ? ".on" : ""), { on: { click: () => { setTheme(k); rebuild(page, mePage); } } }, l)))),
      h("button.prow", { style: { width: "100%", border: 0, textAlign: "left", font: "inherit", color: "inherit" }, on: { click: () => dispatchEvent(new CustomEvent("syn-undo", { detail: "undo" })) } }, icon("undo"), h("span.grow", "Letzte Änderung rückgängig")),
      h("button.prow", { style: { width: "100%", border: 0, textAlign: "left", font: "inherit", color: "inherit" }, on: { click: () => dispatchEvent(new CustomEvent("syn-undo", { detail: "redo" })) } }, icon("redo"), h("span.grow", "Wiederholen")),
      h("a.prow", { href: "#/settings" }, icon("settings"), h("span.grow", "Einstellungen"), icon("right")),
      h("a.prow", { href: "#/settings/routines" }, icon("zap"), h("span.grow", "Routinen"), icon("right")),
      h("a.prow", { href: "#/settings/importers" }, icon("download"), h("span.grow", "Importe"), icon("right")),
      h("a.prow", { href: "#/settings/sync" }, icon("smartphone"), h("span.grow", "Sync aufs Handy"), icon("right"))),
    h("p.small.t3", "Ringe, Achsen, Netz und die Tabelle gibt es am Desktop."),
    h("button.btn", { on: { click: async () => { await POST("/auth/logout"); location.hash = "#/login"; } } }, icon("logout"), "Abmelden"));
}

// ---------------------------------------------------------------- Vorschläge (eigene Seite statt im Ich-Tab)
async function suggestionsPage(page) {
  const sugg = await GET("/suggestions");
  const reload = () => rebuild(page, suggestionsPage);
  page.append(h("div.mtop", h("a.back", { href: "#/me" }, icon("left"), "Ich")), h("h1", "Vorschläge"),
    h("p.small.t2", "Werte aus Importen und Daten, die syn nicht ungefragt übernimmt."),
    sugg.length ? h("div.list", sugg.map((s) => h("div.prow",
      s.payload.img ? h("img.sugg-img", { src: s.payload.img, alt: "" }) : null,
      h("a.grow", { href: s.entity_id ? "#/p/" + s.entity_id : "#/suggestions", style: { textDecoration: "none", color: "inherit", minWidth: 0 } },
        h("div.nm", s.entity_name || ""), h("div.sub", { style: { whiteSpace: "normal" } }, `${s.field_name || (s.kind === "name" ? "Name" : s.kind === "avatar" ? "Profilbild" : s.kind)}: ${typeof s.payload.value === "object" ? JSON.stringify(s.payload.value) : s.payload.value} · ${s.payload.why || s.source}`)),
      h("button.btn.sm", { on: { click: async () => { await POST(`/suggestions/${s.id}/accept`); invalidate(); reload(); } } }, "Übernehmen"),
      h("button.btn.sm.ghost.icon", { "aria-label": "Ablehnen", on: { click: async () => { await POST(`/suggestions/${s.id}/reject`); reload(); } } }, icon("x"))))) : h("div.card.pad.empty", "Keine offenen Vorschläge."));
}

// ---------------------------------------------------------------- Heute
export async function todayPage(page, { withUpcoming = true } = {}) {
  const t = await GET("/today");
  const d = new Date();
  const reload = () => rebuild(page, (p) => todayPage(p, { withUpcoming }));
  if (withUpcoming) page.append(h("div.mtop", h("a.back", { href: "#/" }, icon("left"), "Personen")),
    h("div.small.t2", d.toLocaleDateString(LOCALE(), { weekday: "long", day: "numeric", month: "long" })), h("h1", "Heute"));
  if (!t.items.length) page.append(h("div.card.pad.empty", "Nichts Neues. Routinen melden sich hier."));
  for (const it of t.items) {
    if (it.kind === "card") {
      const e = it.entity || {};
      page.append(h("div.card.pad.col.today-card",
        h("div.row", e.id ? h("a.today-av", { href: "#/p/" + e.id, title: "Profil öffnen" }, avatar(e, 40)) : null, h("div.grow", e.id ? h("a.today-title", { href: "#/p/" + e.id }, h("b", it.title)) : h("b", it.title), h("div.small.t2", [e.level ? ringName(e.level) : null, e.bund_kind ? bundKindName(e.bund_kind) : null].filter(Boolean).join(" · "), " ", it.body ? h("span.qmark", it.body) : null)), h("button.btn.sm.ghost.icon", { title: "Erledigt", on: { click: (ev) => { const card = ev.currentTarget.closest(".card"); card?.classList.add("gone"); setTimeout(() => card?.remove(), 220); optimistic(() => POST(`/today/${it.id}/dismiss`), { onFail: reload }); } } }, icon("x"))),
        e.id ? h("div.qa",
          e.phone ? h("a.btn.primary", { href: "sms:" + e.phone.replace(/[^\d+]/g, "") }, "Schreiben") : e.email ? h("a.btn.primary", { href: "mailto:" + e.email }, "Schreiben") : h("a.btn.primary", { href: "#/p/" + e.id }, "Öffnen"),
          e.phone ? h("a.btn", { href: "tel:" + e.phone.replace(/[^\d+]/g, "") }, "Anrufen") : h("button.btn", { disabled: true }, "Anrufen"),
          hasSeen() ? h("button.btn", { on: { click: () => { toast("Gesehen"); optimistic(() => POST(`/seen-today/${e.id}`)); } } }, "Gesehen") : null) : null,
        h("div.small.t3", h("span.tag", "routine"), " ", it.day)));
    } else if (it.kind === "list") {
      page.append(h("div.card.col", { style: { gap: 0 } }, h("div.card-h", h("div", h("b", it.title), h("div.small.t2", it.day)), h("button.btn.sm.ghost.icon", { on: { click: (ev) => { const card = ev.currentTarget.closest(".card"); card?.classList.add("gone"); setTimeout(() => card?.remove(), 220); optimistic(() => POST(`/today/${it.id}/dismiss`), { onFail: reload }); } } }, icon("x"))),
        (it.data.items || []).map((x) => h("a.prow", { href: "#/p/" + x.id }, avatar({ display: x.name, name: x.name, ...(x.row || {}) }, 32), h("div.grow", h("div.nm", x.name), h("div.sub", x.text)),
          !hasSeen() ? null : h("button.btn.sm.icon", { title: "Heute gesehen", on: { click: (ev) => { ev.preventDefault(); const b = ev.currentTarget; b.classList.add("active"); optimistic(() => POST(`/seen-today/${x.id}`), { onFail: () => b.classList.remove("active") }); } } }, icon("eye"))))));
    }
  }
  if (withUpcoming) {
    const C = await import("./calendar.js");
    const box = h("div.col", { style: { gap: "12px" } });
    page.append(h("h2.m-sect", "Zeitleiste"), C.fieldPicker(() => C.upcoming(box)), box);
    await C.upcoming(box);
  }
}

// ---------------------------------------------------------------- Notizen (Modul)
async function notesPage(page) {
  const { noteEditor } = await import("./notes.js");
  const q = h("input.input", { type: "search", placeholder: "Notizen durchsuchen" });
  const list = h("div.col");
  const draw = async () => {
    const notes = await GET("/notes" + qs({ q: q.value }));
    clear(list, notes.length ? notes.map((n) => h("div.card.pad.col", { on: { click: async () => { if (await noteEditor(n)) draw(); } } },
      h("div.row.wrap.small.t2", h("span.mono", n.day), n.links.filter((l) => l.role === "dabei").map((l) => h("a.chip.sel", { href: "#/p/" + l.entity_id, on: { click: (e) => e.stopPropagation() } }, l.display))),
      h("div", { style: { whiteSpace: "pre-wrap" } }, n.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")))) : h("div.card.pad.empty", q.value ? "Nichts gefunden." : "Noch keine Notizen."));
  };
  q.addEventListener("input", debounce(draw, 200));
  page.append(h("div.mtop", h("a.back", { href: "#/me" }, icon("left"), "Ich"), h("button.btn.sm.primary", { on: { click: async () => { if (await noteEditor()) draw(); } } }, icon("plus"), "Notiz")),
    h("h1", "Notizen"), q, list);
  await draw();
}
