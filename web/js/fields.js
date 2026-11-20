// Felder: Anzeige und Bearbeitung aller Feldtypen (Text, Notiz, Zahl, Datum, Auswahl, Checkbox, Person, Verweis,
// Telefon, E-Mail, Adresse, Profil, Bild). Jeder Wert: Label, Hauptwert ★, veraltet, unsicher, Quelle, gültig von/bis.
import { S, h, icon, api, PUT, POST, clear, modal, rows, invalidate, avatar, circleChip, pickPerson, pickCircle, toast } from "./core.js";

export const TYPE_NAMES = { text: "Text", note: "Notiz", number: "Zahl", date: "Datum", choice: "Auswahl", checkbox: "Checkbox",
  person: "Person", ref: "Verweis", phone: "Telefon", email: "E-Mail", address: "Adresse", profile: "Profil", image: "Bild" };
export const SOURCE = (s) => (!s || s === "manual" ? "von Hand" : s === "Zusammenführen" ? "zusammengeführt" : "aus " + (S.me?.importers_available?.includes(s) ? importerName(s) : s));
function importerName(id) { return ({ google: "Google Kontakte", vcard: "Handy-Kontakte", carddav: "CardDAV", imap: "E-Mail", kalender: "Kalender" })[id] || id[0].toUpperCase() + id.slice(1); }

export function fieldsFor(kind) {
  return S.fieldList.filter((f) => f.scope === "both" || f.scope === kind);
}
export const bundFields = () => S.fieldList.filter((f) => f.scope === "bund");

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
    case "ref": return typeof v === "object" ? nameOf(v.id, names) : String(v);
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
    el = h("input.input.mono", { value: value ?? "", placeholder: "JJJJ-MM-TT, ????-03-14, Herbst 2025, 14.3." }); get = () => el.value;
  } else if (t === "choice") {
    const multi = def.options?.multiple; const sel = new Set(Array.isArray(value) ? value : value ? [value] : []);
    const box = h("div.row.wrap", { style: { gap: "6px" } });
    const extra = h("input.input", { placeholder: "Neue Option …", style: { width: "160px", height: "26px" } });
    const render = () => clear(box, (def.options?.choices || []).map((c) => h("span.chip" + (sel.has(c) ? ".sel" : ".plain"), { style: { cursor: "pointer" }, on: { click: () => { if (sel.has(c)) sel.delete(c); else { if (!multi) sel.clear(); sel.add(c); } render(); } } }, c)), extra);
    extra.addEventListener("keydown", (e) => { if (e.key === "Enter" && extra.value.trim()) { e.preventDefault(); def.options.choices = [...(def.options.choices || []), extra.value.trim()]; if (!multi) sel.clear(); sel.add(extra.value.trim()); extra.value = ""; render(); } });
    render(); el = box; get = () => { const a = [...sel]; if (extra.value.trim()) a.push(extra.value.trim()); return multi ? a : a[0] ?? null; };
  } else if (t === "person" || t === "ref") {
    let cur = value; const lab = h("span");
    const show = () => clear(lab, cur ? (t === "ref" && cur.type === "circle" ? circleChip(cur.id) : h("span.chip.plain", nameOf(t === "person" ? cur : cur.id))) : h("span.t3", "nichts gewählt"));
    const bP = h("button.btn.sm", { type: "button", on: { click: (e) => pickPerson(e.currentTarget, { onPick: (r) => { cur = t === "person" ? r.id : { type: "entity", id: r.id }; show(); } }) } }, icon("user"), "Person");
    const bC = t === "ref" ? h("button.btn.sm", { type: "button", on: { click: (e) => pickCircle(e.currentTarget, { onPick: (c) => { cur = { type: "circle", id: c.id }; show(); } }) } }, icon("circles"), "Kreis") : null;
    const bX = h("button.btn.sm.ghost", { type: "button", on: { click: () => { cur = null; show(); } } }, icon("x"));
    show(); el = h("div.row.wrap", lab, bP, bC, bX); get = () => cur;
  } else if (t === "profile") {
    const v = value || {};
    const sel = h("select.input", (S.settings.services || []).map((s) => h("option", { value: s.id, selected: s.id === v.service }, s.name)), h("option", { value: "", selected: !v.service }, "anderer"));
    const handle = h("input.input", { value: v.handle || "", placeholder: "@name" });
    const id = h("input.input.mono", { value: v.id || "", placeholder: "Dienst-ID (optional)" });
    const url = h("input.input", { value: v.url || "", placeholder: "Link (optional)" });
    el = h("div.col", h("div.row", sel, handle), h("div.row", id, url));
    get = () => ({ service: sel.value, handle: handle.value.trim(), id: id.value.trim(), url: url.value.trim() });
  } else if (t === "image") {
    let cur = value; const img = h("img", { style: { maxWidth: "120px", borderRadius: "8px", display: cur ? "" : "none" }, src: cur || "" });
    const file = h("input", { type: "file", accept: "image/*", on: { change: async () => { const fd = new FormData(); fd.append("file", file.files[0]); const r = await api("POST", "/files", fd); cur = r.url; img.src = cur; img.style.display = ""; } } });
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
  const list = h("div.col");
  const items = (values || []).map((v) => ({ ...v }));
  if (!items.length) items.push({ value: null, primary: true, label: null });
  const labels = def.options?.labels || [];
  const render = () => {
    clear(list, items.map((it, idx) => {
      const inp = inputFor(def, it.value);
      it._get = inp.get;
      const unsure = h("input", { type: "checkbox", checked: !!it.uncertain, on: { change: (e) => (it.uncertain = e.target.checked) } });
      const depr = h("input", { type: "checkbox", checked: !!it.deprecated, on: { change: (e) => (it.deprecated = e.target.checked) } });
      const lab = def.multi ? h("input.input", { value: it.label || "", placeholder: "Label", list: "lbl-" + def.id, style: { width: "120px" }, on: { input: (e) => (it.label = e.target.value) } }) : null;
      const star = def.multi ? h("button.btn.sm.icon" + (it.primary ? ".active" : ""), { type: "button", title: "Hauptwert ★ – Schnellaktionen benutzen ihn ohne Nachfrage", on: { click: () => { items.forEach((x) => (x.primary = false)); it.primary = true; sync(); render(); } } }, icon("star")) : null;
      const vf = h("input.input.mono", { value: it.valid_from || "", placeholder: "gültig von", style: { width: "120px" }, on: { input: (e) => (it.valid_from = e.target.value) } });
      const vt = h("input.input.mono", { value: it.valid_to || "", placeholder: "bis", style: { width: "120px" }, on: { input: (e) => (it.valid_to = e.target.value) } });
      const del = h("button.btn.sm.ghost.icon", { type: "button", title: "Wert löschen", on: { click: () => { sync(); items.splice(idx, 1); render(); } } }, icon("trash"));
      return h("div.rblock" + (it.deprecated ? ".t3" : ""),
        h("div.row", star, lab, h("div.grow", inp.el), del),
        h("div.row.wrap.small.t2", { style: { gap: "14px" } },
          h("label.check", unsure, "unsicher"), def.multi ? h("label.check", depr, "veraltet") : null,
          h("span.row", "gültig", vf, vt),
          it.source ? h("span.tag", SOURCE(it.source)) : null));
    }), labels.length ? h("datalist#lbl-" + def.id, labels.map((l) => h("option", { value: l }))) : null,
    def.multi ? h("button.btn.sm", { type: "button", style: { alignSelf: "flex-start" }, on: { click: () => { sync(); items.push({ value: null, primary: !items.length }); render(); } } }, icon("plus"), "Wert") : null);
  };
  const sync = () => items.forEach((it) => { if (it._get) it.value = it._get(); });
  render();
  const note = h("p.small.t3", def.multi ? "Alte Werte als „veraltet“ markieren statt löschen: Sie verschwinden aus der Anzeige, aber Importe und Doppelte finden die Person weiter." : "Unsichere Werte werden gestrichelt mit „?“ angezeigt.");
  const res = await modal(title || def.name, h("div.col", h("div.row.small.t3", h("span.tag", def.id), TYPE_NAMES[def.type]), list, note),
    [{ label: "Abbrechen", value: null }, { label: "Speichern", primary: true, action: async () => {
      sync();
      const values = items.filter((it) => it.value !== null && it.value !== "" && !(Array.isArray(it.value) && !it.value.length))
        .map(({ _get, ...rest }) => rest);
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
