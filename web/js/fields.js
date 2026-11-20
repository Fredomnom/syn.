// Felder: Anzeige und Bearbeitung aller Feldtypen (Text, Notiz, Zahl, Datum, Auswahl, Checkbox, Person, Verweis,
// Telefon, E-Mail, Adresse, Profil, Bild). Jeder Wert: Label, Hauptwert ★, veraltet, unsicher, Quelle, gültig von/bis.
import { dateInput } from "./date.js";
import { pickAndCrop } from "./crop.js";
import { S, h, icon, api, PUT, POST, clear, modal, rows, invalidate, avatar, circleChip, pickPerson, pickCircle, toast, menu } from "./core.js";

export const TYPE_NAMES = { text: "Text", note: "Notiz", number: "Zahl", date: "Datum", choice: "Auswahl", checkbox: "Checkbox",
  person: "Person", ref: "Verweis", phone: "Telefon", email: "E-Mail", address: "Adresse", profile: "Profil", image: "Bild" };
export const SOURCE = (s) => (!s || s === "manual" ? "von Hand" : s === "Zusammenführen" ? "zusammengeführt" : "aus " + (S.me?.importers_available?.includes(s) ? importerName(s) : s));
function importerName(id) { return ({ google: "Google Kontakte", vcard: "Handy-Kontakte", carddav: "CardDAV", imap: "E-Mail", kalender: "Kalender" })[id] || id[0].toUpperCase() + id.slice(1); }

export function fieldsFor(kind) {
  return S.fieldList.filter((f) => f.scope === "both" || f.scope === kind);
}
export const bundFields = () => S.fieldList.filter((f) => f.scope === "bund");

// Quellen für „Kennengelernt über“: Profil-Dienste und Import-Quellen
const EXTRA_SOURCES = { imap: "E-Mail", kalender: "Kalender", vcard: "Handy-Kontakte", android: "Anrufe & SMS", carddav: "Adressbuch (CardDAV)", google: "Google Kontakte" };
export function sources() {
  const out = { ...EXTRA_SOURCES };
  for (const s of S.settings.services || []) out[s.id] = s.name;
  return out;
}
export const sourceName = (id) => sources()[id] || id;

// Logos der Dienste (Simple Icons, CC0) – einfarbig in der Textfarbe; Import-Quellen mit eigenen Symbolen
const LOGOS = new Set(["instagram", "discord", "steam", "telegram", "whatsapp", "signal", "matrix", "github", "mastodon", "bluesky", "twitch",
  "psn", "linkedin", "facebook", "snapchat", "anilist", "lastfm", "google"]);
const SOURCE_ICONS = { imap: "mail", kalender: "calendar", vcard: "smartphone", android: "phone", carddav: "users" };
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
    case "ref": return typeof v === "object" ? (v.type === "service" ? sourceName(v.id) : nameOf(v.id, names)) : String(v);
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
  if (def.type === "address") return { icon: "pin", label: "Karte", href: "https://www.openstreetmap.org/search?query=" + encodeURIComponent(v) };
  if (def.type === "profile") { const l = profileLink(v); return l ? { icon: "ext", label: "Öffnen", href: l } : null; }
  return null;
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
    const show = () => clear(lab, cur ? (t === "ref" && cur.type === "circle" ? circleChip(cur.id) : t === "ref" && cur.type === "service" ? h("span.chip.plain.src-chip", serviceIcon(cur.id, 14), sourceName(cur.id)) : h("span.chip.plain", nameOf(t === "person" ? cur : cur.id))) : h("span.t3", "nichts gewählt"));
    const bP = h("button.btn.sm", { type: "button", on: { click: (e) => pickPerson(e.currentTarget, { onPick: (r) => { cur = t === "person" ? r.id : { type: "entity", id: r.id }; show(); } }) } }, icon("user"), "Person");
    const bC = t === "ref" ? h("button.btn.sm", { type: "button", on: { click: (e) => pickCircle(e.currentTarget, { onPick: (c) => { cur = { type: "circle", id: c.id }; show(); } }) } }, icon("circles"), "Kreis") : null;
    const bS = t === "ref" ? h("button.btn.sm", { type: "button", on: { click: (e) => menu(e.currentTarget, [{ label: "Quelle – Plattform oder Import" },
      ...Object.entries(sources()).sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ label: name, on: cur?.type === "service" && cur.id === id, action: () => { cur = { type: "service", id }; show(); } }))]) } }, icon("link"), "Quelle") : null;
    const bX = h("button.btn.sm.ghost", { type: "button", on: { click: () => { cur = null; show(); } } }, icon("x"));
    show(); el = h("div.row.wrap", lab, bP, bC, bS, bX); get = () => cur;
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
export async function editField(def, values, path, { title } = {}) {
  const list = h("div.col.fv-list");
  const items = (values || []).map((v) => ({ ...v }));
  if (!items.length) items.push({ value: null, primary: true, label: null });
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
  setTimeout(() => list.querySelector(".fv-body input, .fv-body textarea, .fv-body select")?.focus(), 80);
  const note = h("p.small.t3", def.multi ? "Alte Werte lieber als „veraltet“ markieren statt löschen: Importe und die Erkennung von Doppelten finden die Person weiter darüber." : "Unsichere Werte erscheinen gestrichelt mit „?“.");
  const titleEl = h("span.row", { style: { gap: "10px" } }, title || def.name, h("span.tag", TYPE_NAMES[def.type]), h("span.tag.t3", def.id));
  const res = await modal(titleEl, h("div.col", list, note),
    [{ label: "Abbrechen", value: null }, { label: "Speichern", primary: true, action: async () => {
      sync();
      const values = items.filter((it) => it.value !== null && it.value !== "" && !(Array.isArray(it.value) && !it.value.length))
        .map(({ _get, _range, ...rest }) => rest);
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
