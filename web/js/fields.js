// Felder: Anzeige und Bearbeitung aller Feldtypen (Text, Notiz, Zahl, Datum, Auswahl, Checkbox, Person, Verweis,
// Telefon, E-Mail, Adresse, Profil, Bild). Jeder Wert: Label, Hauptwert ★, veraltet, unsicher, Quelle, gültig von/bis.
import { dateInput } from "./date.js";
import { LOCALE } from "./i18n.js";
import { pickAndCrop } from "./crop.js";
import { S, h, icon, api, PUT, POST, clear, modal, rows, invalidate, avatar, circleChip, pickPerson, pickCircle, toast, menu, popover, closePop } from "./core.js";

export const TYPE_NAMES = { text: "Text", note: "Notiz", number: "Zahl", date: "Datum", choice: "Auswahl", checkbox: "Checkbox",
  person: "Person", ref: "Verweis", phone: "Telefon", email: "E-Mail", address: "Adresse", profile: "Profil", image: "Bild" };
export const SOURCE = (s) => (!s || s === "manual" ? "von Hand" : s === "Zusammenführen" ? "zusammengeführt" : s === "card" ? "über deine Visitenkarte" : "aus " + (S.me?.importers_available?.includes(s) ? importerName(s) : s));
function importerName(id) { return ({ card: "Visitenkarte", google: "Google Kontakte", vcard: "Handy-Kontakte", carddav: "CardDAV", imap: "E-Mail", kalender: "Kalender", playstation: "PlayStation", instagram_api: "Instagram" })[id] || sources()[id] || id[0].toUpperCase() + id.slice(1); }

export function fieldsFor(kind) {
  return S.fieldList.filter((f) => f.scope === "both" || f.scope === kind);
}
export const bundFields = () => S.fieldList.filter((f) => f.scope === "bund");

// Quellen für „Kennengelernt über“: Profil-Dienste und Import-Quellen
const EXTRA_SOURCES = { card: "Visitenkarte", imap: "E-Mail", kalender: "Kalender", vcard: "Handy-Kontakte", android: "Anrufe & SMS", carddav: "Adressbuch (CardDAV)", google: "Google Kontakte" };
export function sources() {
  const out = { ...EXTRA_SOURCES };
  for (const s of S.settings.services || []) out[s.id] = s.name;
  return out;
}
export const sourceName = (id) => sources()[id] || id;

// Logos der Dienste (Simple Icons, CC0) – einfarbig in der Textfarbe; Import-Quellen mit eigenen Symbolen
const LOGOS = new Set(["instagram", "discord", "steam", "telegram", "whatsapp", "signal", "matrix", "github", "mastodon", "bluesky", "twitch",
  "psn", "linkedin", "facebook", "snapchat", "anilist", "lastfm", "google", "prate", "xbox", "vrchat", "immich"]);
const SOURCE_ICONS = { card: "idcard", imap: "mail", kalender: "calendar", vcard: "smartphone", android: "phone", carddav: "users" };
export function serviceIcon(id, size = 16) {
  if (LOGOS.has(id)) return h("span.svc-ic", { style: { "--src": `url(/static/icons/services/${id}.svg)`, width: size + "px", height: size + "px" } });
  if (SOURCE_ICONS[id]) return icon(SOURCE_ICONS[id], "svc-sym");
  const n = sourceName(id) || id || "?";
  return h("span.svc-letter", { style: { width: size + "px", height: size + "px", fontSize: Math.round(size * 0.62) + "px" } }, n[0].toUpperCase());
}

export function service(id) { return (S.settings.services || []).find((s) => s.id === id); }
export function profileLink(v) {
  if (!v || typeof v !== "object") return null;
  if (v.url) return v.url;
  const s = service(v.service); if (!s || !s.link) return null;
  if (s.link.includes("{url}")) return null;
  if (s.link.includes("{id}") && !v.id) return null;
  if (s.link.includes("{handle}") && !v.handle) return null;
  return s.link.replace("{handle}", encodeURIComponent((v.handle || "").replace(/^@/, ""))).replace("{id}", encodeURIComponent(v.id || ""));
}

export function nameOf(id, names) {
  if (names && names[id]) return names[id];
  if (S.circles[id]) return S.circles[id].name;
  const r = (S.rows || []).find((x) => x.id === id); return r ? r.display : id;
}

// Text-Darstellung eines Rohwerts
export function plain(def, v, names) {
  if (v === null || v === undefined) return "";
  switch (def.type) {
    case "choice": return Array.isArray(v) ? v.join(", ") : String(v);
    case "checkbox": return v ? "Ja" : "Nein";
    case "profile": return typeof v === "object" ? (v.handle || v.id || v.url || "") : String(v);
    case "person": return nameOf(v, names);
    case "ref": return typeof v === "object" ? (v.type === "service" ? sourceName(v.id) : v.type === "place" ? v.id : nameOf(v.id, names)) : String(v);
    case "number": return def.options?.ring ? `${v} · ${(S.settings.ring_names || {})[v] || ""}` : String(v);
    default: return String(v);
  }
}

// Element für einen Wert (unsicher = gestrichelt mit ?)
export function valueEl(def, val, names) {
  const v = val.value;
  let el;
  if (def.type === "date") el = h("span.mono", v);
  else if (def.type === "phone") el = h("span.mono", v);
  else if (def.type === "choice") el = h("span.row.wrap", { style: { gap: "4px" } }, (Array.isArray(v) ? v : [v]).map((x) => h("span.chip.plain", x)));
  else if (def.type === "ref" && v?.type === "circle") el = circleChip(v.id);
  else if (def.type === "ref" && v?.type === "place") el = placeChip(v.id);
  else if (def.type === "ref" && v?.type === "service") el = h("span.chip.plain.src-chip", serviceIcon(v.id, 14), sourceName(v.id));
  else if (def.type === "ref" || def.type === "person") { const id = def.type === "person" ? v : v.id; el = h("a", { href: "#/p/" + id }, nameOf(id, names)); }
  else if (def.type === "profile") { const s = service(v.service); el = h("span", s ? h("span.t3", s.name + " ") : null, v.handle || v.id || v.url); }
  else if (def.type === "image") el = h("img", { src: v, style: { maxWidth: "120px", borderRadius: "8px" } });
  else if (def.type === "note" || def.type === "address") el = h("span", { style: { whiteSpace: "pre-wrap" } }, v);
  else if (def.type === "checkbox") el = h("span", v ? "Ja" : "Nein");
  else el = h("span", plain(def, v, names));
  if (val.uncertain) el = h("span.unsure-val", el);
  return el;
}

// Aktion zu einem Kontaktweg: anrufen, schreiben, Karte, Link
export function actionFor(def, v) {
  if (v === null || v === undefined) return null;
  if (def.type === "phone") return { icon: "phone", label: "Anrufen", href: "tel:" + String(v).replace(/[^\d+]/g, "") };
  if (def.type === "email") return { icon: "mail", label: "Schreiben", href: "mailto:" + v };
  if (def.type === "address") return { icon: "pin", label: "Auf der Karte zeigen", href: mapLink(v) };
  if (def.type === "profile") { const l = profileLink(v); return l ? { icon: "ext", label: "Öffnen", href: l } : null; }
  return null;
}

export const MAPS = [["osm", "OpenStreetMap"], ["google", "Google Maps"], ["apple", "Apple Karten"]];
export function mapLink(addr) {
  const q = encodeURIComponent(String(addr).replace(/\n/g, ", "));
  const p = S.settings.map_provider || "osm";
  if (p === "google") return "https://www.google.com/maps/search/?api=1&query=" + q;
  if (p === "apple") return "https://maps.apple.com/?q=" + q;
  return "https://www.openstreetmap.org/search?query=" + q;
}
export const primaryOf = (vals) => { const live = (vals || []).filter((v) => !v.deprecated); return live.find((v) => v.primary) || live[0] || null; };

// ---------------------------------------------------------------- Eingaben
export function inputFor(def, value, { onEnter } = {}) {
  const t = def.type;
  let el, get;
  if (t === "note" || t === "address") { el = h("textarea.input", { rows: 3, value: value ?? "" }); get = () => el.value; }
  else if (t === "number") { el = h("input.input", { type: "number", value: value ?? "", min: def.options?.min, max: def.options?.max, step: "any" }); get = () => (el.value === "" ? null : +el.value); }
  else if (t === "checkbox") { const c = h("input", { type: "checkbox", checked: !!value }); el = h("label.check", c, "Ja"); get = () => c.checked; }
  else if (t === "date") {
    el = dateInput(value ?? ""); get = () => el.value;
  } else if (t === "choice") {
    const multi = def.options?.multiple; const sel = new Set(Array.isArray(value) ? value : value ? [value] : []);
    const box = h("div.row.wrap", { style: { gap: "6px" } });
    const extra = h("input.input", { placeholder: "Neue Option …", style: { width: "160px", height: "26px" } });
    const render = () => clear(box, (def.options?.choices || []).map((c) => h("span.chip" + (sel.has(c) ? ".sel" : ".plain"), { style: { cursor: "pointer" }, on: { click: () => { if (sel.has(c)) sel.delete(c); else { if (!multi) sel.clear(); sel.add(c); } render(); } } }, c)), extra);
    extra.addEventListener("keydown", (e) => { if (e.key === "Enter" && extra.value.trim()) { e.preventDefault(); def.options.choices = [...(def.options.choices || []), extra.value.trim()]; if (!multi) sel.clear(); sel.add(extra.value.trim()); extra.value = ""; render(); } });
    render(); el = box; get = () => { const a = [...sel]; if (extra.value.trim()) a.push(extra.value.trim()); return multi ? a : a[0] ?? null; };
  } else if (t === "person" || t === "ref") {
    let cur = value; const lab = h("span");
    const show = () => clear(lab, cur ? (t === "ref" && cur.type === "circle" ? circleChip(cur.id) : t === "ref" && cur.type === "service" ? h("span.chip.plain.src-chip", serviceIcon(cur.id, 14), sourceName(cur.id)) : t === "ref" && cur.type === "place" ? placeChip(cur.id) : h("span.chip.plain", nameOf(t === "person" ? cur : cur.id))) : h("span.t3", "nichts gewählt"));
    const bP = h("button.btn.sm", { type: "button", on: { click: (e) => pickPerson(e.currentTarget, { onPick: (r) => { cur = t === "person" ? r.id : { type: "entity", id: r.id }; show(); } }) } }, icon("user"), "Person");
    const bC = t === "ref" ? h("button.btn.sm", { type: "button", on: { click: (e) => pickCircle(e.currentTarget, { onPick: (c) => { cur = { type: "circle", id: c.id }; show(); } }) } }, icon("circles"), "Kreis") : null;
    const bS = t === "ref" ? h("button.btn.sm", { type: "button", on: { click: (e) => menu(e.currentTarget, [{ label: "Quelle – Plattform oder Import" },
      ...Object.entries(sources()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ label: name, on: cur?.type === "service" && cur.id === id, action: () => { cur = { type: "service", id }; show(); } }))]) } }, icon("link"), "Quelle") : null;
    const bX = h("button.btn.sm.ghost", { type: "button", on: { click: () => { cur = null; show(); } } }, icon("x"));
    const bO = t === "ref" ? h("button.btn.sm", { type: "button", on: { click: (e) => pickPlace(e.currentTarget, (name) => { cur = { type: "place", id: name }; show(); }) } }, icon("pin"), "Ort") : null;
    show(); el = h("div.row.wrap", lab, bP, bC, bO, bS, bX); get = () => cur;
  } else if (t === "profile") {
    const v = value || {};
    const sel = h("select.input", (S.settings.services || []).map((x) => h("option", { value: x.id, selected: x.id === v.service }, x.name)), h("option", { value: "", selected: !v.service }, "anderer Dienst"));
    const handle = h("input.input", { value: v.handle || "", placeholder: "@name" });
    const id = h("input.input.mono", { value: v.id || "", placeholder: "optional" });
    const url = h("input.input", { value: v.url || "", placeholder: "optional" });
    const lf = (label, el) => h("label.f.fv-field", label, el);
    el = h("div.fv-grid", lf("Dienst", sel), lf("Name / Handle", handle), lf("Dienst-ID", id), lf("Link", url));
    get = () => ({ service: sel.value, handle: handle.value.trim(), id: id.value.trim(), url: url.value.trim() });
  } else if (t === "image") {
    let cur = value; const img = h("img", { style: { maxWidth: "120px", borderRadius: "8px", display: cur ? "" : "none" }, src: cur || "" });
    const file = h("input", { type: "file", accept: "image/*", on: { change: async () => { const u = await pickAndCrop(file.files[0], { round: false, size: 1024 }); file.value = ""; if (u) { cur = u; img.src = cur; img.style.display = ""; } } } });
    el = h("div.row", img, file); get = () => cur;
  } else {
    el = h("input.input" + (t === "phone" ? ".mono" : ""), { value: value ?? "", type: t === "email" ? "email" : t === "phone" ? "tel" : "text" }); get = () => el.value;
  }
  if (onEnter && el.tagName === "INPUT") el.addEventListener("keydown", (e) => { if (e.key === "Enter") onEnter(); });
  return { el, get };
}

// ---------------------------------------------------------------- Bearbeiten-Dialog für ein Feld
// path: z.B. /entities/p_x/fields/f_phone  (Bund-Felder einer Person landen automatisch bei „Ihr zwei“)
export async function editField(def, values, path, { title, addNew = false } = {}) {
  const list = h("div.col.fv-list");
  const items = (values || []).map((v) => ({ ...v }));
  if (!items.length) items.push({ value: null, primary: true, label: null });
  else if (addNew && def.multi) items.push({ value: null, primary: false, label: null, _new: true });
  const labels = def.options?.labels || [];
  const sync = () => items.forEach((it) => { if (it._get) it.value = it._get(); });
  const pill = (on, ic, label, onClick, title) => h("button.pill" + (on ? ".on" : ""), { type: "button", title, on: { click: onClick } }, icon(ic, "xs"), label);
  const render = () => {
    clear(list, items.map((it, idx) => {
      const inp = inputFor(def, it.value);
      it._get = inp.get;
      const showRange = it._range || it.valid_from || it.valid_to;
      const labelIn = def.multi ? h("input.input.fv-label", { value: it.label || "", placeholder: "Label", list: "lbl-" + def.id, on: { input: (e) => (it.label = e.target.value) } }) : null;
      const wide = ["profile", "address", "note", "image", "choice"].includes(def.type);
      const top = labelIn && !wide ? h("div.fv-main", labelIn, h("div.fv-body", inp.el)) : h("div.col", { style: { gap: "8px" } }, labelIn, h("div.fv-body", inp.el));
      const head = h("div.fv-head", h("div.fv-tags",
        def.multi ? pill(it.primary, "star", "Hauptwert", () => { sync(); items.forEach((x) => (x.primary = false)); it.primary = true; render(); }, "Schnellaktionen benutzen den Hauptwert ohne Nachfrage") : null,
        pill(it.uncertain, "question", "unsicher", () => { sync(); it.uncertain = !it.uncertain; render(); }, "Wird gestrichelt mit „?“ angezeigt"),
        def.multi ? pill(it.deprecated, "history", "veraltet", () => { sync(); it.deprecated = !it.deprecated; render(); }, "Verschwindet aus der Anzeige, Importe finden die Person weiter") : null,
        showRange ? null : h("button.fv-more", { type: "button", on: { click: () => { sync(); it._range = true; render(); } } }, icon("calendar", "xs"), "Zeitraum")),
        h("div.fv-side", it.source ? h("span.fv-src", SOURCE(it.source)) : null,
          h("button.btn.sm.ghost.icon", { type: "button", title: "Wert löschen", on: { click: () => { sync(); items.splice(idx, 1); render(); } } }, icon("trash"))));
      let range = null;
      if (showRange) {
        const vf = dateInput(it.valid_from || "", { placeholder: "von", onChange: (v) => (it.valid_from = v) });
        const vt = dateInput(it.valid_to || "", { placeholder: "bis", onChange: (v) => (it.valid_to = v) });
        vf.addEventListener("input", () => (it.valid_from = vf.value)); vt.addEventListener("input", () => (it.valid_to = vt.value));
        range = h("div.fv-range", h("span.fv-cap", "Gültig"), vf, h("span.t3", "–"), vt);
      }
      return h("div.fv" + (it.deprecated ? ".deprecated" : "") + (it.uncertain ? ".uncertain" : ""), top, range, head);
    }), labels.length ? h("datalist#lbl-" + def.id, labels.map((l) => h("option", { value: l }))) : null,
    def.multi ? h("button.fv-add", { type: "button", on: { click: () => { sync(); items.push({ value: null, primary: !items.length }); render(); } } }, icon("plus"), "Weiteren Wert hinzufügen") : null);
  };
  render();
  setTimeout(() => { const cards = list.querySelectorAll(".fv"); const c = addNew ? cards[cards.length - 1] : cards[0]; c?.scrollIntoView({ block: "nearest" }); c?.querySelector(".fv-body input, .fv-body textarea, .fv-body select")?.focus(); }, 80);
  const note = h("p.small.t3", def.multi ? "Alte Werte lieber als „veraltet“ markieren statt löschen: Importe und die Erkennung von Doppelten finden die Person weiter darüber." : "Unsichere Werte erscheinen gestrichelt mit „?“.");
  const titleEl = h("span.row", { style: { gap: "10px" } }, title || def.name, h("span.tag", TYPE_NAMES[def.type]), h("span.tag.t3", def.id));
  const res = await modal(titleEl, h("div.col", list, note),
    [{ label: "Abbrechen", value: null }, { label: "Speichern", primary: true, action: async () => {
      sync();
      const values = items.filter((it) => it.value !== null && it.value !== "" && !(Array.isArray(it.value) && !it.value.length))
        .map(({ _get, _range, _new, ...rest }) => rest);
      try { return await PUT(path, { values }); } catch (_) { return false; }
    } }]);
  if (res) invalidate();
  return res;
}

// Felder einer Person als Liste: [{def, vals}] (nur mit Werten oder alle)
export function entityFieldList(e, { all = false } = {}) {
  const out = [];
  for (const d of fieldsFor(e.kind)) {
    const vals = (e.fields[d.id] || []);
    if (all || vals.some((v) => !v.deprecated)) out.push({ def: d, vals });
  }
  return out;
}

// Schnellaktion eines Feldes (Routine mit manuellem Auslöser)
export async function runQuick(eid, rid) {
  const r = await POST(`/entities/${eid}/actions/${rid}`);
  invalidate(); return r.entity;
}

// ---------------------------------------------------------------- Abschnitte und Zeilen-Darstellung
export const GROUPS = [["kontakt", "Kontakt"], ["persoenlich", "Persönliches"], ["gemeinsam", "Gemeinsam"], ["weitere", "Weitere"], ["notiz", "Notizen"]];
const BASE_GROUP = { f_phone: "kontakt", f_email: "kontakt", f_addr: "kontakt", f_profile: "kontakt",
  f_bday: "persoenlich", f_city: "persoenlich", f_company: "persoenlich", f_position: "persoenlich", f_study: "persoenlich",
  f_food: "persoenlich", f_train: "persoenlich", f_traits: "persoenlich", f_species: "persoenlich", f_breed: "persoenlich",
  f_seen: "gemeinsam", f_meet: "gemeinsam", f_intro: "gemeinsam", f_note: "notiz" };
export function groupOf(d) {
  if (d.options?.group) return d.options.group;
  if (BASE_GROUP[d.id]) return BASE_GROUP[d.id];
  if (d.type === "note") return "notiz";
  if (["phone", "email", "address", "profile"].includes(d.type)) return "kontakt";
  return "weitere";
}

const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
// „10. September 2009 · 17 Jahre“, „14. März“, „Herbst 2025“, „Mai 2025“
export function humanDate(s, { age = false } = {}) {
  const m = /^(\d{4}|\?{4})-(\d{2}|\?{2})-(\d{2}|\?{2})$/.exec(s || "");
  const ms = /^(\d{4}|\?{4})-(Frühling|Sommer|Herbst|Winter)$/.exec(s || "");
  if (ms) return `${ms[2]}${ms[1].includes("?") ? "" : " " + ms[1]}`;
  if (!m) return s || "";
  const y = m[1].includes("?") ? null : +m[1], mo = m[2].includes("?") ? null : +m[2], d = m[3].includes("?") ? null : +m[3];
  let out = d && mo ? `${d}. ${MONTHS_LONG[mo - 1]}${y ? " " + y : ""}` : mo ? `${MONTHS_LONG[mo - 1]}${y ? " " + y : ""}` : y ? String(y) : "?";
  if (age && y && mo && d) {
    const t = new Date(); let a = t.getFullYear() - y; if (t.getMonth() + 1 < mo || (t.getMonth() + 1 === mo && t.getDate() < d)) a--;
    out += ` · ${a} Jahre`;
  }
  return out;
}

const INLINE_TYPES = new Set(["text", "number", "date", "phone", "email"]);
// Eine Feldzeile: Label links, Werte rechts, Aktionen beim Überfahren. Klick auf einen einfachen Wert bearbeitet ihn direkt.
export function fieldRow(def, vals, path, e, reload, { extra = null, label = null } = {}) {
  const live = (vals || []).filter((v) => !v.deprecated);
  const p = primaryOf(vals);
  const ordered = p ? [p, ...live.filter((v) => v !== p)] : live;
  const dialog = async () => { if (await editField(def, vals || [], path)) reload(); };
  const inline = !def.multi && INLINE_TYPES.has(def.type) && path.startsWith("/entities/");
  const svcCount = {};
  if (def.type === "profile") for (const v of live) svcCount[v.value?.service] = (svcCount[v.value?.service] || 0) + 1;

  const srcDot = (v) => (v.source && v.source !== "manual" ? h("span.src-dot", { title: SOURCE(v.source) }) : null);
  const human = (v) => {
    if (def.type === "date") {
      const t = h("span", { title: v.value }, humanDate(v.value, { age: def.id === "f_bday" }), def.id === "f_seen" ? h("span.t3", ` · ${relDays(v.value)}`) : null);
      return v.uncertain ? h("span.unsure-val", t) : t;
    }
    return valueEl(def, v, e.names);
  };
  const line = (v) => {
    const act = actionFor(def, v.value);
    if (def.type === "profile") {
      const s = service(v.value?.service);
      const href = profileLink(v.value);
      const chip = h(href ? "a.pchip" : "span.pchip", href ? { href, target: "_blank", rel: "noopener", on: { click: (ev) => ev.stopPropagation() } } : {},
        s ? serviceIcon(s.id, 15) : null, h("span", v.value?.handle || v.value?.id || v.value?.url || ""),
        svcCount[v.value?.service] > 1 && v.label ? h("span.t3", v.label) : null, href ? icon("ext", "xs") : null, srcDot(v));
      return v.uncertain ? h("span.unsure-val", chip) : chip;
    }
    return h("div.fr-line", h("span.fr-text", human(v)), def.multi && live.length > 1 && v.label ? h("span.fr-lab", v.label) : null, srcDot(v),
      act ? h("a.fr-act", { href: act.href, title: act.label, target: act.href.startsWith("http") ? "_blank" : null, rel: "noopener", on: { click: (ev) => ev.stopPropagation() } }, icon(act.icon)) : null);
  };
  const valueBox = h("div.fr-val" + (def.type === "profile" ? ".chips" : ""),
    ordered.length ? ordered.map(line) : h("span.t3", "–"), extra);
  const startInline = () => {
    if (!inline) return dialog();
    const inp = inputFor(def, p?.value ?? "");
    const ed = h("div.fr-edit", inp.el);
    let done = false;
    const save = async () => {
      if (done) return; done = true;
      const v = inp.get();
      if ((v ?? "") === (p?.value ?? "")) return reload();
      try { await api("PATCH", path, { value: v === "" ? null : v }); invalidate(); } catch (_) {}
      reload();
    };
    const cancel = () => { if (done) return; done = true; valueBox.replaceWith(valueBoxOrig); };
    const valueBoxOrig = valueBox;
    valueBox.replaceWith(ed);
    const field = ed.querySelector("input");
    field?.focus(); field?.select?.();
    ed.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); save(); } if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cancel(); } });
    if (def.type === "date") { ed.querySelector("syn-date")?.addEventListener("change", save); requestAnimationFrame(() => ed.querySelector("syn-date")?.open?.()); }
    else field?.addEventListener("blur", () => setTimeout(() => { if (!ed.contains(document.activeElement) && !document.querySelector(".date-pop")) save(); }, 120));
  };
  const quick = def.quick_routine_id && !e.is_self && def.scope !== "bund"
    ? h("button.btn.sm.icon.fr-btn", { title: S.fieldList.length && def.type === "number" ? "+1" : "Schnellaktion", on: { click: async (ev) => { ev.stopPropagation(); await runQuick(e.id, def.quick_routine_id); reload(); } } }, icon(def.type === "number" ? "plus" : "refresh")) : null;
  return h("div.fr" + (inline ? ".inline" : ""), { "data-fid": def.id },
    h("div.fr-key", label || def.name, live.length > 1 && def.type !== "profile" ? h("span.fl-count", live.length) : null),
    h("div.fr-main", { on: { click: (ev) => { if (ev.target.closest("a, button")) return; startInline(); } } }, valueBox),
    h("div.fr-tools", quick, h("button.btn.sm.icon.fr-btn", { title: "Mehr: Werte, Label, unsicher, Zeitraum", on: { click: (ev) => { ev.stopPropagation(); dialog(); } } }, icon("more"))));
}
function relDays(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!m) return "";
  const d = Math.round((Date.now() - new Date(+m[1], +m[2] - 1, +m[3], 12)) / 86400000);
  return d <= 0 ? "heute" : d === 1 ? "gestern" : d < 14 ? `vor ${d} Tagen` : d < 70 ? `vor ${Math.round(d / 7)} Wochen` : d < 600 ? `vor ${Math.round(d / 30)} Monaten` : `vor ${Math.round(d / 365)} Jahren`;
}

// Felder einer Person in Abschnitten
export function fieldSections(e, reload, { mobile = false } = {}) {
  const defs = fieldsFor(e.kind);
  const has = (d) => (e.fields[d.id] || []).some((v) => !v.deprecated);
  const out = [];
  for (const [g, title] of GROUPS) {
    const rows = [];
    for (const d of defs.filter((x) => groupOf(x) === g && has(x))) {
      if (d.id === "f_meet_prev") continue; // zählt bei „N Treffen“ mit
      let extra = null;
      const meetN = (e.fields.f_meet || []).filter((v) => !v.deprecated).length + Number(primaryOf(e.fields.f_meet_prev)?.value || 0);
      if (d.id === "f_seen" && meetN) {
        const md = S.fields.f_meet;
        extra = h("span.fr-meet", `${meetN} Treffen`,
          md?.quick_routine_id && !e.is_self ? h("button.btn.sm.icon.fr-btn.show", { title: "+1 Treffen", on: { click: async (ev) => { ev.stopPropagation(); await runQuick(e.id, md.quick_routine_id); reload(); } } }, icon("plus")) : null);
      }
      rows.push(fieldRow(d, e.fields[d.id], `/entities/${e.id}/fields/${d.id}`, e, reload, { extra }));
    }
    if (rows.length) out.push(h("section.fs", h("h4.fs-title", title), h("div.fs-rows", rows)));
  }
  return out;
}

// Kennlernort: ein Ort als Verweis, z.B. „Uni Leipzig“ oder „Sommercamp 2019“
export const placeChip = (name) => h("span.chip.plain", icon("pin", "xs"), name);
function knownPlaces() {
  const n = new Map();
  for (const r of S.rows || []) for (const x of Object.values(r.v || {})) {
    const raw = x?.raw;
    if (raw && typeof raw === "object" && raw.type === "place" && raw.id) n.set(raw.id, (n.get(raw.id) || 0) + 1);
  }
  for (const r of S.rows || []) { const c = r.v?.f_city?.d; if (c && !n.has(c)) n.set(c, 0); }
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], LOCALE())).map(([k]) => k);
}
export function pickPlace(anchor, onPick) {
  const inp = h("input.input", { placeholder: "Ort, z.B. Uni Leipzig …", style: { width: "100%" } });
  const list = h("div.menu", { style: { marginTop: "6px", maxHeight: "260px", overflow: "auto" } });
  const places = knownPlaces();
  const done = (n) => { if (!n) return; closePop(); onPick(n); };
  const render = () => {
    const q = inp.value.trim(), ql = q.toLowerCase();
    const hits = places.filter((p) => !ql || p.toLowerCase().includes(ql)).slice(0, 30);
    clear(list, hits.map((p) => h("button", { type: "button", on: { click: () => done(p) } }, icon("pin"), h("span.grow", p))),
      q && !places.some((p) => p.toLowerCase() === ql) ? h("button", { type: "button", on: { click: () => done(q) } }, icon("plus"), h("span.grow", "Neuer Ort: ", h("b", `„${q}“`))) : null,
      !hits.length && !q ? h("div.lbl", "Noch keine Orte – tippe einen ein") : null);
  };
  inp.addEventListener("input", render);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && !list.querySelector(".kfocus") && inp.value.trim()) { e.preventDefault(); done(inp.value.trim()); } });
  popover(anchor, h("div", { style: { width: "280px" } }, inp, list));
  render(); inp.focus();
}
