// Handy (PWA): schnell erfassen und finden. Untere Leiste: Personen, Kreise, Plus, Suche, Ich.
import { S, h, icon, GET, POST, PATCH, clear, rebuild, rows, themePref, setTheme, invalidate, avatar, circleChip, nameEl, rel, ringName, today, debounce,
  postOrQueue, toast, modal, logo, qs, queued, fmtDate } from "./core.js";
import { primaryOf, valueEl, actionFor, editField, entityFieldList, runQuick, plain, bundFields, fieldSections, humanDate } from "./fields.js";
import { editPerson, addField, dupHint, ringPopup, setRing, editIhrZwei, bundKindName, historyText } from "./shared.js";

let filt = "all", search = "";

let lastPath = null;
export async function render(app, route) {
  const [p0, p1] = route.parts;
  const path = route.parts.join("/");
  const same = path === lastPath; lastPath = path;
  const page = h("div.mpage");
  const tab = !p0 ? "people" : ["settings"].includes(p0) ? "me" : p0;
  if (!p0 || p0 === "people" || p0 === "new") await people(page);
  else if (p0 === "p") await profile(page, p1);
  else if (p0 === "circles") await circles(page);
  else if (p0 === "c") await circle(page, p1);
  else if (p0 === "search") await searchPage(page);
  else if (p0 === "me") await mePage(page);
  else if (p0 === "today") await todayPage(page);
  else if (p0 === "notes") await notesPage(page);
  else if (p0 === "settings") await settingsMobile(page, p1, route);
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
  page.append(h("div.mtop", h("a.back", { href: "#/me" }, icon("left"), "Ich")));
  const box = h("div.msettings");
  await settingsPage(box, tab || "account", route);
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
    r.is_self ? null : h("button.seen" + (done ? ".done" : ""), { title: "Heute gesehen", "aria-label": "Heute gesehen", on: { click: async (e) => {
      e.preventDefault(); e.stopPropagation();
      const res = await postOrQueue(`/seen-today/${r.id}`, {}, `${r.display} gesehen`);
      e.currentTarget?.classList.add("done");
      if (res) { invalidate(); onSeen?.(); toast(`${r.display}: heute gesehen`); }
    } } }, icon("eye")));
}

async function people(page) {
  const all = (await rows()).filter((r) => !r.is_self);
  const counts = { lose: all.filter((r) => !r.circles.length).length };
  const listBox = h("div.list");
  const draw = () => {
    let list = all.filter((r) => filt === "all" || (filt === "person" && r.kind === "person") || (filt === "pet" && r.kind === "pet") || (filt === "lose" && !r.circles.length));
    if (search) { const q = search.toLowerCase(); list = list.filter((r) => [r.display, r.description, ...(r.aliases || [])].join(" ").toLowerCase().includes(q)); }
    const act = (r) => [r.v.f_seen?.raw || "", (r.created_at || "").slice(0, 10)].sort().pop(); list.sort((a, b) => act(b).localeCompare(act(a)) || a.display.localeCompare(b.display));
    clear(listBox, list.length ? list.map((r) => personRow(r, () => rebuild(page, people))) : h("div.empty", filt === "lose" ? "Niemand unter „Lose“ – alles einsortiert." : "Noch niemand hier. Tippe auf +."));
  };
  const chip = (id, label) => h("span.chip" + (filt === id ? ".dark" : ".plain"), { on: { click: () => { filt = id; rebuild(page, people); } } }, label);
  const q = h("input.input", { placeholder: "Name, Kreis oder Beschreibung", value: search, on: { input: debounce((e) => { search = e.target.value; draw(); }, 100) } });
  const todayN = (await GET("/today")).items.length;
  const pending = queued();
  page.append(
    h("div.mtop", h("h1", "Personen"), h("div.row", todayN ? h("a.btn.sm", { href: "#/today" }, icon("bell"), `Heute · ${todayN}`) : null, h("span.t2.small", `${all.length} Einträge`))),
    pending ? h("div.hint", icon("upload"), h("div.grow", `${pending} Erfassung(en) warten auf Netz.`)) : null,
    q,
    h("div.filters", chip("all", "Alle"), chip("person", "Menschen"), chip("pet", "Haustiere"), chip("lose", `Lose · ${counts.lose}`)),
    h("div.small.t2", "Zuletzt aktiv"), listBox);
  draw();
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
async function profile(page, id) {
  const e = await GET("/entities/" + id);
  const reload = () => rebuild(page, (p) => profile(p, id));
  const phone = primaryOf(e.fields.f_phone), mail = primaryOf(e.fields.f_email);
  const iz = e.ihr_zwei?.fields || {};
  const ring = e.level;
  const fieldRows = entityFieldList(e).filter(({ def }) => !["f_note"].includes(def.id));
  const tel = phone ? phone.value : null;
  page.append(
    h("div.mtop", h("a.back", { href: "#/" }, icon("left"), "Personen"), h("button.btn.ghost.sm", { on: { click: async () => { const r = await editPerson(e); if (r) reload(); } } }, "Bearbeiten")),
    h("div.col", { style: { alignItems: "center", gap: "6px", textAlign: "center" } },
      avatar(e, 72),
      h("h1", { style: { fontSize: "24px" } }, e.name || e.description || "Ohne Namen", " ", !e.name ? h("span.qmark", "ohne Namen") : e.name_uncertain ? h("span.qmark", "Name ?") : null),
      e.aliases?.length ? h("div.small.t2", "auch: " + e.aliases.join(", ")) : null,
      h("div.row.wrap", { style: { justifyContent: "center" } }, e.memberships.filter((m) => m.active).map((m) => circleChip(m.circle_id, { star: m.circle_id === e.main_circle_id })),
        e.kind === "pet" ? h("span.chip.plain", icon("paw"), "Haustier") : null)),
    dupHint(e, { onChange: reload }),
    e.is_self ? null : h("div.qa",
      h("button.btn.primary", { on: { click: async () => { await postOrQueue(`/seen-today/${e.id}`, {}, e.display); invalidate(); reload(); } } }, icon("eye"), "Heute gesehen"),
      tel ? h("a.btn", { href: "tel:" + tel.replace(/[^\d+]/g, "") }, icon("phone"), "Anrufen") : h("button.btn", { on: { click: async () => { if (await editField(S.fields.f_phone, [], `/entities/${e.id}/fields/f_phone`)) reload(); } } }, icon("plus"), "Nummer"),
      tel ? h("a.btn", { href: "sms:" + tel.replace(/[^\d+]/g, "") }, icon("message"), "Schreiben") : mail ? h("a.btn", { href: "mailto:" + mail.value }, icon("mail"), "Schreiben") : h("button.btn", { disabled: true }, icon("message"), "Schreiben")),
    e.is_self ? null : h("div.list",
      h("div.kv", { style: { background: "var(--bg)" } }, h("span.small.t2", "Ihr zwei"), h("a.small", { href: "#", on: { click: async (ev) => { ev.preventDefault(); if (await editIhrZwei(e)) reload(); } } }, bundKindName(e.ihr_zwei?.kind_id))),
      S.settings.use_levels ? h("div.kv", { on: { click: (ev) => ringPopup(ev.currentTarget, ring, async (l) => { await setRing(e.id, l); reload(); }) } }, h("span.k", "Ring"), h("span.v", ringName(ring),
        e.ist ? h("span.tag", `Ist ${e.ist.ring}`) : null)) : null,
      bundFields().filter((d) => d.id !== "f_level").map((d) => {
        const p = primaryOf(iz[d.id]);
        return h("div.kv", { on: { click: async () => { if (await editField(d, iz[d.id] || [], `/entities/${e.id}/fields/${d.id}`)) reload(); } } }, h("span.k", d.name), h("span.v", p ? (d.type === "date" ? humanDate(p.value) : valueEl(d, p, e.names)) : h("span.t3", "–")));
      })),
    (() => { const sec = fieldSections(e, reload, { mobile: true }); return sec.length ? h("div.card.m-fields", sec) : null; })(),
    h("button.btn", { on: { click: () => addField(e, { onDone: reload }) } }, icon("plus"), "Feld hinzufügen"),
    e.routines?.length ? h("div.small.t2", "Routinen: " + e.routines.map((r) => r.name + (r.next ? ` (${r.next})` : "")).join(", ")) : null);
  const hist = await GET(`/entities/${e.id}/history?limit=3`);
  if (hist.length) page.append(h("p.small.t3", { style: { textAlign: "center" } }, "Verlauf: " + hist.map((x) => `${historyText(x)} (${rel(x.at.slice(0, 10))})`).join(" · ")));
}

// ---------------------------------------------------------------- Kreise
async function circles(page) {
  const { reloadCircles } = await import("./core.js"); await reloadCircles();
  const cs = Object.values(S.circles).sort((a, b) => a.name.localeCompare(b.name));
  const tops = cs.filter((c) => !c.parent_id);
  page.append(h("div.mtop", h("h1", "Kreise"), h("span.t2.small", `${cs.length} Kreise`)),
    h("div.list", tops.length ? tops.flatMap((c) => [c, ...cs.filter((x) => x.parent_id === c.id)]).map((c) =>
      h("a.prow", { href: "#/c/" + c.id, style: c.parent_id ? { paddingLeft: "34px" } : null }, circleChip(c.id), h("span.grow"), h("span.t2.small", c.count), icon("right"))) : h("div.empty", "Noch keine Kreise.")));
}

async function circle(page, id) {
  const c = await GET("/circles/" + id);
  const all = await rows();
  const members = all.filter((r) => r.circles_all.includes(id));
  page.append(h("div.mtop", h("a.back", { href: "#/circles" }, icon("left"), "Kreise")),
    h("div.row", circleChip(id), h("span.t2.small", `${members.length} Mitglieder`)),
    h("div.list", members.length ? members.map((r) => personRow(r)) : h("div.empty", "Noch niemand in diesem Kreis.")));
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
  const sugg = await GET("/suggestions");
  page.append(h("div.mtop", h("h1", "Ich"), logo()),
    h("div.list", h("a.prow", { href: "#/p/" + me.id }, avatar({ ...me, is_self: true }, 42), h("div.grow", h("div.nm", me.display), h("div.sub", "Mein Profil")), icon("right"))),
    h("div.list",
      h("a.prow", { href: "#/today" }, icon("bell"), h("span.grow", "Heute")),
      S.settings.notes_enabled ? h("a.prow", { href: "#/notes" }, icon("note"), h("span.grow", "Notizen")) : null,
      h("a.prow", { href: "#/", on: { click: () => { filt = "lose"; } } }, icon("layers"), h("span.grow", "Lose aufräumen"))),
    sugg.length ? h("div.list", h("div.kv", h("span.small.t2", "Vorschläge")), sugg.map((s) => h("div.prow",
      h("div.grow", h("div.nm", s.entity_name || ""), h("div.sub", `${s.field_name || (s.kind === "name" ? "Name" : s.kind)}: ${typeof s.payload.value === "object" ? JSON.stringify(s.payload.value) : s.payload.value} · ${s.payload.why || s.source}`)),
      h("button.btn.sm", { on: { click: async () => { await POST(`/suggestions/${s.id}/accept`); invalidate(); rebuild(page, mePage); } } }, "Übernehmen"),
      h("button.btn.sm.ghost.icon", { on: { click: async () => { await POST(`/suggestions/${s.id}/reject`); rebuild(page, mePage); } } }, icon("x"))))) : null,
    h("div.list",
      h("div.kv", h("span.k", "Angemeldet als"), h("span.v", S.me.username)),
      h("div.kv", h("span.k", "Mit Handy synchronisiert"), h("span.v", ({ all: "Jeder", rule: "Nach Regel", none: "Niemand" })[S.settings.sync?.mode])),
      h("div.kv", h("span.k", "CardDAV"), h("span.v.mono.small", location.origin + "/dav/"))),
    h("div.list",
      h("div.kv", h("span.k", "Darstellung"), h("div.seg", [["system", "System"], ["light", "Hell"], ["dark", "Dunkel"]].map(([k, l]) =>
        h("button" + (themePref() === k ? ".on" : ""), { on: { click: () => { setTheme(k); rebuild(page, mePage); } } }, l)))),
      h("button.prow", { style: { width: "100%", border: 0, textAlign: "left", font: "inherit", color: "inherit" }, on: { click: () => dispatchEvent(new CustomEvent("syn-undo", { detail: "undo" })) } }, icon("undo"), h("span.grow", "Letzte Änderung rückgängig")),
      h("a.prow", { href: "#/settings/account" }, icon("settings"), h("span.grow", "Einstellungen"), icon("right")),
      h("a.prow", { href: "#/settings/routines" }, icon("zap"), h("span.grow", "Routinen"), icon("right")),
      h("a.prow", { href: "#/settings/importers" }, icon("download"), h("span.grow", "Importe"), icon("right")),
      h("a.prow", { href: "#/settings/sync" }, icon("smartphone"), h("span.grow", "Sync aufs Handy"), icon("right"))),
    h("p.small.t3", "Ringe, Achsen, Netz und die Tabelle gibt es am Desktop."),
    h("button.btn", { on: { click: async () => { await POST("/auth/logout"); location.hash = "#/login"; } } }, icon("logout"), "Abmelden"));
}

// ---------------------------------------------------------------- Heute
export async function todayPage(page) {
  const t = await GET("/today");
  const d = new Date();
  const reload = () => rebuild(page, todayPage);
  page.append(h("div.mtop", h("a.back", { href: "#/" }, icon("left"), "Personen")),
    h("div.small.t2", d.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" })), h("h1", "Heute"));
  if (!t.items.length) page.append(h("div.card.pad.empty", "Nichts Neues. Routinen melden sich hier."));
  for (const it of t.items) {
    if (it.kind === "card") {
      const e = it.entity || {};
      page.append(h("div.card.pad.col.today-card",
        h("div.row", e.id ? avatar(e, 40) : null, h("div.grow", h("b", it.title), h("div.small.t2", [e.level ? ringName(e.level) : null, e.bund_kind ? bundKindName(e.bund_kind) : null].filter(Boolean).join(" · "), " ", it.body ? h("span.qmark", it.body) : null)), h("button.btn.sm.ghost.icon", { title: "Erledigt", on: { click: async () => { await POST(`/today/${it.id}/dismiss`); reload(); } } }, icon("x"))),
        e.id ? h("div.qa",
          e.phone ? h("a.btn.primary", { href: "sms:" + e.phone.replace(/[^\d+]/g, "") }, "Schreiben") : e.email ? h("a.btn.primary", { href: "mailto:" + e.email }, "Schreiben") : h("a.btn.primary", { href: "#/p/" + e.id }, "Öffnen"),
          e.phone ? h("a.btn", { href: "tel:" + e.phone.replace(/[^\d+]/g, "") }, "Anrufen") : h("button.btn", { disabled: true }, "Anrufen"),
          h("button.btn", { on: { click: async () => { await POST(`/seen-today/${e.id}`); toast("Gesehen"); } } }, "Gesehen")) : null,
        h("div.small.t3", h("span.tag", "routine"), " ", it.day)));
    } else if (it.kind === "list") {
      page.append(h("div.card.col", { style: { gap: 0 } }, h("div.card-h", h("div", h("b", it.title), h("div.small.t2", it.day)), h("button.btn.sm.ghost.icon", { on: { click: async () => { await POST(`/today/${it.id}/dismiss`); reload(); } } }, icon("x"))),
        (it.data.items || []).map((x) => h("a.prow", { href: "#/p/" + x.id }, avatar({ display: x.name, name: x.name, ...(x.row || {}) }, 32), h("div.grow", h("div.nm", x.name), h("div.sub", x.text)),
          h("button.btn.sm.icon", { title: "Heute gesehen", on: { click: async (ev) => { ev.preventDefault(); await POST(`/seen-today/${x.id}`); ev.currentTarget.classList.add("active"); } } }, icon("eye"))))));
    }
  }
}

// ---------------------------------------------------------------- Notizen (Modul)
async function notesPage(page) {
  const { noteEditor } = await import("./notes.js");
  const notes = await GET("/notes");
  page.append(h("div.mtop", h("a.back", { href: "#/me" }, icon("left"), "Ich"), h("button.btn.sm.primary", { on: { click: async () => { if (await noteEditor()) rebuild(page, notesPage); } } }, icon("plus"), "Notiz")),
    h("h1", "Notizen"),
    notes.map((n) => h("div.card.pad.col", { on: { click: async () => { if (await noteEditor(n)) rebuild(page, notesPage); } } },
      h("div.row.small.t2", h("span.mono", n.day), n.links.filter((l) => l.role === "dabei").map((l) => h("span.chip.sel", l.display))),
      h("div", { style: { whiteSpace: "pre-wrap" } }, n.text.replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")))));
}
