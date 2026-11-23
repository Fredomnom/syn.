// Einstellungen: Felder, Kreis-Arten, Bund-Arten, Ringe, Routinen, Importe, Sync, Vorschläge, Module, Konto, Admin.
import { S, h, icon, iconButton, api, GET, POST, PUT, PATCH, DEL, clear, invalidate, toast, modal, confirmDlg, promptDlg, rows, reloadFields, reloadCircles,
  loadBase, circleChip, avatar, fmtTs, rel, RING, download, rebuild, isMobile, themePref, setTheme } from "./core.js";
import { TYPE_NAMES, serviceIcon, GROUPS, groupOf, MAPS } from "./fields.js";
import { LOCALE } from "./i18n.js";
import { hueInput, hueOf } from "./color.js";
import { runImport, stepsEl } from "./importstatus.js";
import { LANGS, langPref, setLang } from "./i18n.js";
import { ACTIONS, binding, pretty, saveBinding, recordCombo, keys } from "./shortcuts.js";
import { loadQr, qrBox, qrDialog } from "./qr.js";

// Navigation: gruppiert, mit Symbol und kurzer Erklärung je Seite
const NAV = [
  ["Allgemein", [["account", "Konto", "user", "Name, Passwort und angemeldete Geräte"], ["appearance", "Darstellung", "sun", "Hell oder dunkel, Karten-Anbieter"],
    ["shortcuts", "Tastenkürzel", "key", "Alle Kürzel ansehen und neu belegen"], ["card", "Visitenkarte", "idcard", "Deine Angaben als kurzer Link zum Teilen"]]],
  ["Daten", [["fields", "Felder", "list", "Welche Angaben es zu Personen gibt"], ["circle-kinds", "Kreis-Arten", "circles", "Arten von Kreisen und ihre Farben"],
    ["bund-kinds", "Bund-Arten", "bund", "Arten von Beziehungen und ihre Rollen"], ["rings", "Ringe & Ist", "rings", "Ringe benennen, „Ist“ berechnen"]]],
  ["Automatisierung", [["routines", "Routinen", "zap", "Erinnerungen, Webhooks und Schnellaktionen"], ["importers", "Importe", "download", "Leute aus Diensten und Dateien holen"],
    ["suggestions", "Vorschläge", "merge", "Offene Vorschläge aus Importen und Daten"]]],
  ["Verbindungen", [["sync", "Handy & Sync", "smartphone", "Wer aufs Handy kommt, CardDAV und Google"], ["calendars", "Kalender", "calendar", "Geburtstage und andere Daten zum Abonnieren"], ["tokens", "API-Tokens", "link", "Zugänge für Skripte, n8n und Home Assistant"]]],
  ["System", [["modules", "Module & Daten", "layers", "Notizen-Modul, Export und API"], ["admin", "Konten", "users", "Konten anlegen und verwalten (Admin)"]]],
];
const ALL = NAV.flatMap(([, items]) => items);

export async function settingsPage(main, tab, route) {
  const mobile = isMobile();
  const page = h("div.page.settings"); main.append(page);
  const visible = (k) => k !== "admin" || S.me.is_admin;
  if (mobile && !tab) {
    page.append(h("h1", "Einstellungen"), ...NAV.map(([g, items]) => h("div.set-group", h("div.set-gtitle", g),
      h("div.list", items.filter(([k]) => visible(k)).map(([k, l, ic, d]) => h("a.prow.set-link", { href: "#/settings/" + k }, h("span.set-ic", icon(ic)), h("div.grow", h("div.nm", l), h("div.sub", d)), icon("right")))))));
    return;
  }
  tab = tab || "account";
  const cur = ALL.find(([k]) => k === tab) || ALL[0];
  const body = h("div.col.set-body", { style: { gap: "16px" } });
  const nav = mobile ? null : h("nav.set-nav", { "data-seg": "settings" }, NAV.map(([g, items]) => h("div.set-group", h("div.set-gtitle", g),
    items.filter(([k]) => visible(k)).map(([k, l, ic]) => h("a.set-item" + (k === tab ? ".on" : ""), { href: "#/settings/" + k }, h("span.set-ic", icon(ic)), l)))));
  const head = h("div.set-head", mobile ? h("a.back", { href: "#/settings" }, icon("left"), "Einstellungen") : null, h("h1", cur[1]), h("p.t2", cur[3]));
  page.append(h("div.set-layout", nav, h("div.set-main.slide-zone", head, body)));
  const fn = { calendars, card: cardTab, fields, "circle-kinds": circleKinds, "bund-kinds": bundKinds, rings: ringsTab, routines, importers, sync, suggestions, modules, shortcuts, account, appearance, tokens, admin }[tab] || account;
  await fn(body, route);
}
const reloadTab = (body, fn, route) => rebuild(body, (b) => fn(b, route));
const card = (title, ...kids) => h("div.card", h("div.card-h", h("h3", title)), h("div.card-b.col", kids));
// Ruhige Einstellungs-Zeilen: links Titel und Hinweis, rechts das Bedienelement
const panel = (title, ...rows) => h("section.set-panel", title ? h("h3.set-ptitle", title) : null, h("div.set-rows", rows));
const srow = (title, hint, control) => h("div.srow", h("div.srow-text", h("div.srow-title", title), hint ? h("div.srow-hint", hint) : null), control ? h("div.srow-ctl", control) : null);
const sw = (checked, onChange) => h("input.switch", { type: "checkbox", checked, role: "switch", on: { change: (e) => onChange(e.target.checked) } });
const segc = (options, value, onPick) => h("div.seg", options.map(([k, l]) => h("button" + (value === k ? ".on" : ""), { type: "button", on: { click: () => onPick(k) } }, l)));
const saveSettings = async (patch) => { S.settings = await PATCH("/me/settings", patch); S.me.settings = S.settings; toast("Gespeichert"); };

// ---------------------------------------------------------------- Felder
async function fields(body) {
  await reloadFields();
  const routines = await GET("/routines");
  const manual = routines.filter((r) => r.trigger.type === "manual");
  const scopes = [["both", "Mensch & Haustier"], ["person", "Mensch"], ["pet", "Haustier"], ["bund", "Bund (z.B. Ihr zwei)"], ["kreis", "Kreis"]];
  const table = h("table.mtable", h("tr", h("th", "Name"), h("th", "ID"), h("th", "Typ"), h("th", "Abschnitt"), h("th", "Gilt für"), h("th", "Mehrere Werte"), h("th", "Schnellaktion"), h("th")),
    S.fieldList.map((f, i) => h("tr",
      h("td", h("input.input", { value: f.name, style: { height: "28px" }, on: { change: async (e) => { await PATCH("/fields/" + f.id, { name: e.target.value }); await reloadFields(); toast("Umbenannt – Regeln nutzen die ID, nichts bricht"); } } })),
      h("td", h("span.tag", f.id), f.is_base ? h("span.tiny.t3", " Basis") : null),
      h("td", TYPE_NAMES[f.type]),
      h("td", ["bund", "kreis"].includes(f.scope) ? h("span.t3", f.scope === "bund" ? "Ihr zwei" : "Kreis") : h("select.input", { on: { change: async (e) => { await PATCH("/fields/" + f.id, { options: { ...f.options, group: e.target.value } }); await reloadFields(); } } },
        GROUPS.map(([k, l]) => h("option", { value: k, selected: groupOf(f) === k }, l)))),
      h("td", h("select.input", { style: { height: "28px" }, on: { change: async (e) => { try { await PATCH("/fields/" + f.id, { scope: e.target.value }); await reloadFields(); } catch (_) { e.target.value = f.scope; } } } }, scopes.map(([k, l]) => h("option", { value: k, selected: f.scope === k }, l)))),
      h("td", h("input", { type: "checkbox", checked: f.multi, on: { change: async (e) => { await PATCH("/fields/" + f.id, { multi: e.target.checked }); await reloadFields(); } } })),
      h("td", ["date", "number"].includes(f.type) ? h("select.input", { style: { height: "28px" }, on: { change: async (e) => { await PATCH("/fields/" + f.id, { quick_action: e.target.value }); await reloadFields(); reloadTab(body, fields); } } },
        h("option", { value: "" }, "–"), !f.quick_routine_id ? h("option", { value: f.type === "date" ? "today" : "plus1" }, f.type === "date" ? "Auf heute setzen (neu)" : "+1 (neu)") : null,
        manual.map((r) => h("option", { value: r.id, selected: f.quick_routine_id === r.id }, r.name))) : h("span.t3", "–")),
      h("td.row", { style: { gap: "2px" } },
        f.type === "choice" || f.multi ? h("button.btn.sm", { on: { click: () => editOptions(f, body) } }, f.type === "choice" ? "Optionen" : "Labels") : null,
        h("button.btn.sm.ghost.icon", { title: "Nach oben", disabled: i === 0, on: { click: async () => { const ids = S.fieldList.map((x) => x.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; await POST("/fields/order", { ids }); reloadTab(body, fields); } } }, icon("up")),
        h("button.btn.sm.ghost.icon", { title: "Löschen", on: { click: async () => { if (await confirmDlg("Feld löschen?", `„${f.name}“ und alle Werte löschen? Der Verlauf bleibt.`, "Löschen", true)) { await DEL("/fields/" + f.id); reloadTab(body, fields); } } } }, icon("trash"))))));
  const nn = h("input.input", { placeholder: "Name des Feldes" });
  const nt = h("select.input", Object.entries(TYPE_NAMES).map(([k, v]) => h("option", { value: k }, v)));
  const ns = h("select.input", scopes.map(([k, l]) => h("option", { value: k }, l)));
  const nm = h("input", { type: "checkbox" });
  body.append(card("Neues Feld", h("div.row.wrap", nn, nt, ns, h("label.check", nm, "mehrere Werte"), h("button.btn.primary", { on: { click: async () => {
    if (!nn.value.trim()) return; await POST("/fields", { name: nn.value, type: nt.value, scope: ns.value, multi: nm.checked, options: nt.value === "choice" ? { choices: [], multiple: false } : {} }); reloadTab(body, fields); } } }, icon("plus"), "Anlegen")),
    h("p.small.t3", "Basisfelder lassen sich frei bearbeiten und löschen. Jedes Feld kann mehrfach mit Label vorkommen, unsicher markiert sein und eine Schnellaktion tragen.")),
    h("div.card", table), await missingStandardCard(body), await servicesCard());
}
// Gelöschte Standardfelder wiederherstellen – samt der Werte aus der letzten Löschung (stehen im Verlauf)
async function missingStandardCard(body) {
  const miss = await GET("/fields/standard/missing");
  if (!miss.length) return null;
  return card("Gelöschte Standardfelder",
    h("p.small.t2", "Mitgelieferte Felder, die du gelöscht hast. Beim Wiederherstellen kommen auch die Werte aus der letzten Löschung zurück."),
    h("div.col", { style: { gap: "6px" } }, miss.map((m) => h("div.row.rs-row", { style: { padding: "6px 0" } },
      h("span.grow", h("b", m.name), " ", h("span.tiny.t3", TYPE_NAMES[m.type] + (m.group === "freundebuch" ? " · Freundebuch" : ""))),
      h("span.small.t2", m.values ? `${m.values} ${m.values === 1 ? "Wert" : "Werte"} wiederherstellbar` : "keine Werte"),
      h("button.btn.sm", { on: { click: async () => { const r = await POST(`/fields/${m.id}/restore`); toast(`„${m.name}“ ist wieder da` + (r.values ? ` – ${r.values} ${r.values === 1 ? "Wert" : "Werte"} zurückgeholt` : "")); await reloadFields(); reloadTab(body, fields); } } }, icon("undo"), "Wiederherstellen")))));
}
async function editOptions(f, body) {
  const choices = h("textarea.input", { rows: 6, value: (f.options.choices || []).join("\n") });
  const multiple = h("input", { type: "checkbox", checked: !!f.options.multiple });
  const labels = h("input.input", { value: (f.options.labels || []).join(", ") });
  const ok = await modal(f.name, h("div.col", f.type === "choice" ? [h("label.f", "Optionen (eine pro Zeile)", choices), h("label.check", multiple, "Mehrfachauswahl")] : null,
    f.multi ? h("label.f", "Vorgeschlagene Labels (kommagetrennt)", labels) : null), [{ label: "Abbrechen" }, { label: "Speichern", primary: true, value: true }]);
  if (!ok) return;
  const options = { ...f.options };
  if (f.type === "choice") { options.choices = choices.value.split("\n").map((s) => s.trim()).filter(Boolean); options.multiple = multiple.checked; }
  if (f.multi) options.labels = labels.value.split(",").map((s) => s.trim()).filter(Boolean);
  await PATCH("/fields/" + f.id, { options }); reloadTab(body, fields);
}
async function servicesCard() {
  const list = (await GET("/services")).map((s) => ({ ...s }));
  const box = h("div.col");
  const draw = () => clear(box, list.map((s, i) => h("div.row", h("span.svc-tile", serviceIcon(s.id, 18)), h("input.input.mono", { value: s.id, style: { width: "110px" }, on: { input: (e) => (s.id = e.target.value) } }),
    h("input.input", { value: s.name, style: { width: "150px" }, on: { input: (e) => (s.name = e.target.value) } }),
    h("input.input.mono.grow", { value: s.link || "", placeholder: "https://…/{handle}", on: { input: (e) => (s.link = e.target.value) } }),
    h("button.btn.sm.ghost.icon", { on: { click: () => { list.splice(i, 1); draw(); } } }, icon("trash")))),
    h("div.row", h("button.btn.sm", { on: { click: () => { list.push({ id: "", name: "", link: "" }); draw(); } } }, icon("plus"), "Dienst"),
      h("button.btn.sm.primary", { on: { click: async () => { await PUT("/services", list.filter((s) => s.id && s.name)); S.settings.services = list; toast("Dienste gespeichert"); } } }, "Speichern")));
  draw();
  return card("Dienste fürs Profil-Feld", h("p.small.t3", "Ein Feldtyp für alle Dienste. Link-Vorlage mit {handle}, {id} oder {url}."), box);
}

// ---------------------------------------------------------------- Kreis-Arten, Bund-Arten
async function circleKinds(body) {
  const { kinds, lose } = await GET("/circle-kinds");
  body.append(card("Kreis-Arten", h("p.small.t3", "Jede Kreis-Art hat ein Paar aus heller Fläche und dunkler Schrift aus derselben Farbfamilie. Wählbar ist nur der Farbton, damit alles zur Marke passt. Die Paare färben Profilbilder, Chips und Sektoren."),
    h("table.mtable", h("tr", h("th", { colSpan: 2 }, "Vorschau"), h("th", "Symbol"), h("th", "Name"), h("th", "Kürzel"), h("th", "Farbton"), h("th")), kinds.map((k) => {
      const prev = h("span.chip", { style: { background: k.bg, color: k.fg } });
      const paint = () => { prev.style.background = k.bg; prev.style.color = k.fg; clear(prev, k.icon ? icon(k.icon, "xs") : null, k.name); };
      paint();
      const upd = async (patch) => { await PATCH("/circle-kinds/" + k.id, patch); Object.assign(k, patch); paint(); await loadBase(); };
      return h("tr", h("td", h("span.av", { style: { background: k.bg, color: k.fg } }, k.abbr)), h("td", prev),
        h("td", iconButton(k.icon, (n) => upd({ icon: n }))),
        h("td", h("input.input", { value: k.name, on: { change: (e) => upd({ name: e.target.value }) } })),
        h("td", h("input.input.mono", { value: k.abbr, style: { width: "60px" }, maxLength: 3, on: { change: (e) => upd({ abbr: e.target.value }) } })),
        h("td", hueInput(hueOf(k.fg), { label: k.name, onChange: (_h, pair) => upd({ bg: pair.bg, fg: pair.fg }) })),
        h("td", h("button.btn.sm.ghost.icon", { title: "Kreis-Art löschen", on: { click: async () => { if (await deleteKind(k, kinds)) { await loadBase(); reloadTab(body, circleKinds); } } } }, icon("trash"))));
    }), h("tr", h("td", h("span.av", { style: { background: lose.bg, color: lose.fg } }, "LO")), h("td", h("span.chip", "Lose")), h("td.t3", { colSpan: 4 }, "fest – für Personen ohne Kreis"))),
    h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: async () => { const n = await promptDlg("Neue Kreis-Art", "Name"); if (n) { const used = kinds.map((k) => hueOf(k.fg)); const free = [0, 30, 60, 95, 140, 175, 200, 230, 265, 300, 330].find((x) => used.every((u) => Math.abs(u - x) > 18)) ?? 200; const { pairForHue } = await import("./color.js"); await POST("/circle-kinds", { name: n, ...pairForHue(free) }); await loadBase(); reloadTab(body, circleKinds); } } } }, icon("plus"), "Kreis-Art")));
}
async function bundKinds(body) {
  const ks = await GET("/bund-kinds");
  body.append(card("Bund-Arten", h("p.small.t3", "Ein Bund ist eine Beziehung zwischen genau zwei Lebewesen. Jede Seite hat eine Rolle."),
    h("table.mtable", h("tr", h("th", "Symbol"), h("th", "Name"), h("th", "Rolle der einen Seite"), h("th", "Rolle der anderen Seite"), h("th")), ks.map((k) => h("tr",
      h("td", iconButton(k.icon, async (n) => { await PATCH("/bund-kinds/" + k.id, { icon: n }); await loadBase(); })),
      ...["name", "role_a", "role_b"].map((f) => h("td", h("input.input", { value: k[f] || "", on: { change: async (e) => { await PATCH("/bund-kinds/" + k.id, { [f]: e.target.value }); await loadBase(); } } }))),
      h("td", h("button.btn.sm.ghost.icon", { on: { click: async () => { await DEL("/bund-kinds/" + k.id); await loadBase(); reloadTab(body, bundKinds); } } }, icon("trash")))))),
    h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: async () => { const n = await promptDlg("Neue Bund-Art", "Name"); if (n) { await POST("/bund-kinds", { name: n }); await loadBase(); reloadTab(body, bundKinds); } } } }, icon("plus"), "Bund-Art")));
}

// ---------------------------------------------------------------- Ringe
async function ringsTab(body) {
  const st = S.settings;
  const names = { ...st.ring_names }, days = { ...st.unseen_days };
  const nameIns = h("div.ring-names", [1, 2, 3, 4].map((n) => h("label.ring-name", h("span.mono", n), h("input.input", { value: names[n], on: { change: (e) => { names[n] = e.target.value; saveSettings({ ring_names: names }); } } }))));
  const dayIns = h("div.ring-names", [1, 2, 3, 4].map((n) => h("label.ring-name", h("span.mono", n), h("input.input", { type: "number", value: days[n], on: { change: (e) => { days[n] = +e.target.value; saveSettings({ unseen_days: days }); } } }), h("span.t3.small", "Tage"))));
  body.append(
    panel("Ringe",
      srow("Mit Ringen arbeiten", "Jede Person bekommt von Hand einen Ring von 1 (Engste) bis 4 (Weit). Ohne Ringe fallen die Ringe-Ansicht und Ring-Bedingungen weg.", sw(st.use_levels, (v) => saveSettings({ use_levels: v }))),
      st.use_levels ? srow("Namen der Ringe", "So heißen die Ringe überall in syn.", null) : null,
      st.use_levels ? h("div.srow-full", nameIns) : null),
    panel("Berechnetes „Ist“",
      srow("„Ist“ berechnen", "Aus „Zuletzt gesehen“, Treffen und Importen (z.B. letzte Nachricht). Ring 1 bis 7 Tage, 2 bis 30, 3 bis 120, sonst 4; ab 25 Treffen einen Ring näher.", sw(st.use_ist, (v) => saveSettings({ use_ist: v }))),
      st.use_ist ? srow("„Lange nicht gesehen“ ab", "Je Ring: nach wie vielen Tagen ohne Kontakt jemand als „lange nicht gesehen“ gilt.", null) : null,
      st.use_ist ? h("div.srow-full", dayIns) : null));
}

// ---------------------------------------------------------------- Routinen
const SPECIAL = [["f_level", "Ring · Bund mit dir"], ["ist", "Ist (berechnet)"], ["kind", "Art"], ["circle", "Kreis"], ["circle_kind", "Kreis-Art"], ["lose", "Lose"], ["name_unknown", "Name unbekannt"], ["on_phone", "Mit Handy synchronisiert"]];
const OPS = [["<=", "≤"], ["<", "<"], [">=", "≥"], [">", ">"], ["=", "="], ["!=", "≠"], ["contains", "enthält"], ["in", "ist einer von"], ["not_in", "ist keiner von"], ["empty", "ist leer"], ["not_empty", "ist gesetzt"], ["days_since_gt", "vor mehr als … Tagen"], ["days_since_lt", "vor weniger als … Tagen"], ["is_true", "ist wahr"], ["is_false", "ist falsch"]];
const ACTS = [["webhook", "Webhook"], ["card", "In syn anzeigen: Karte unter „Heute“"], ["list", "In syn anzeigen: Liste unter „Heute“"], ["set_today", "Feld auf heute setzen"], ["add_today", "Heutiges Datum zur Liste hinzufügen (z.B. Treffen)"], ["increment", "Zahl erhöhen (+1)"], ["set_value", "Feld auf Wert setzen"], ["import", "Import ausführen"], ["google_sync", "Google-Sync ausführen"]];
const WD = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

async function routines(body, route) {
  const list = await GET("/routines");
  const all = await rows();
  let cur = list.find((r) => r.id === route?.query?.r) || list.find((r) => r.trigger.type !== "manual") || list[0];
  const left = h("div.col.rlist");
  const right = h("div.card.grow", { style: { minWidth: 0 } });
  body.append(h("div.rsplit", left, right));
  const drawList = () => clear(left, h("button.btn.primary", { on: { click: () => { cur = { id: null, name: "Neue Routine", enabled: true, trigger: { type: "date", field: "f_bday", repeat: "yearly", without_year: true, time: "08:00" }, conditions: [], actions: [{ type: "card", title: "{name} hat Geburtstag", text: "{alter}" }] }; drawList(); edit(); } } }, icon("plus"), "Neue Routine"),
    list.map((r) => h("div.card.pad", { style: { cursor: "pointer", padding: "10px 12px", borderColor: cur && cur.id === r.id ? "var(--ink)" : null }, on: { click: () => { cur = r; drawList(); edit(); } } },
      h("div.row.between", h("b.ellipsis", r.name), h("span.tag" + (r.enabled ? ".yellow" : ""), r.trigger.type === "manual" ? "Knopf" : r.enabled ? "aktiv" : "aus")),
      h("div.small.t2", r.trigger_text, r.conditions.length ? " · " + r.conditions.length + " Bedingung(en)" : "", " · ", r.actions.map((a) => ACTS.find((x) => x[0] === a.type)?.[1].split(":")[0]).join(", ")),
      r.used_by_fields?.length ? h("div.tiny.t3", "Schnellaktion an: " + r.used_by_fields.map((f) => S.fields[f]?.name).join(", ")) : null)));
  const fieldSel = (val, filter, onch) => h("select.input", { style: { height: "30px" }, on: { change: (e) => onch(e.target.value) } },
    S.fieldList.filter(filter).map((f) => h("option", { value: f.id, selected: f.id === val }, `${f.name} · ${f.id}`)));
  let testId = all.find((r) => !r.is_self && r.v.f_bday)?.id || all.find((r) => !r.is_self)?.id;
  const edit = () => {
    if (!cur) return clear(right, h("div.empty", "Keine Routine ausgewählt."));
    const r = JSON.parse(JSON.stringify(cur));
    const t = r.trigger;
    const out = h("div.col");
    const preview = h("div.col");
    const draw = () => {
      clear(out,
        h("div.row", h("input.input.grow", { value: r.name, style: { fontWeight: 600, fontSize: "16px" }, on: { input: (e) => (r.name = e.target.value) } }), h("label.check", h("input", { type: "checkbox", checked: r.enabled, on: { change: (e) => (r.enabled = e.target.checked) } }), "Aktiv")),
        // Wann
        h("div.row.small.t2", h("span.tag", "wann"), "Auslöser"),
        h("div.rblock", h("div.row.wrap",
          h("select.input", { style: { height: "30px" }, on: { change: (e) => { const nt = e.target.value === "date" ? { type: "date", field: "f_bday", repeat: "yearly", without_year: true, time: "08:00" } : e.target.value === "schedule" ? { type: "schedule", every: "weekly", weekday: 0, time: "08:00" } : { type: "manual", label: r.name }; for (const k in t) delete t[k]; Object.assign(t, nt); draw(); } } },
            [["date", "Datum erreicht"], ["schedule", "Zeitplan"], ["manual", "Knopf (Schnellaktion)"]].map(([k, l]) => h("option", { value: k, selected: t.type === k }, l))),
          t.type === "date" ? [h("span.small.t2", "Feld"), fieldSel(t.field, (f) => f.type === "date", (v) => (t.field = v)),
            h("div.seg", [["once", "Einmalig"], ["yearly", "Jährlich"], ["monthly", "Monatlich"]].map(([k, l]) => h("button" + ((t.repeat || "yearly") === k ? ".on" : ""), { on: { click: () => { t.repeat = k; draw(); } } }, l))),
            (t.repeat || "yearly") === "yearly" ? h("label.check.small", h("input", { type: "checkbox", checked: t.without_year !== false, on: { change: (e) => (t.without_year = e.target.checked) } }), "auch ohne Jahr") : null] : null,
          t.type === "schedule" ? [h("select.input", { style: { height: "30px" }, on: { change: (e) => { t.every = e.target.value; draw(); } } }, [["hourly", "stündlich"], ["daily", "täglich"], ["weekly", "wöchentlich"], ["monthly", "monatlich"]].map(([k, l]) => h("option", { value: k, selected: t.every === k }, l))),
            t.every === "weekly" ? h("select.input", { style: { height: "30px" }, on: { change: (e) => (t.weekday = +e.target.value) } }, WD.map((d, i) => h("option", { value: i, selected: +t.weekday === i }, d))) : null,
            t.every === "monthly" ? h("label.row.small", "am", h("input.input", { type: "number", min: 1, max: 31, value: t.day || 1, style: { width: "64px", height: "30px" }, on: { input: (e) => (t.day = +e.target.value) } }), ".") : null] : null,
          t.type === "manual" ? h("label.row.small", "Beschriftung", h("input.input", { value: t.label || "", style: { height: "30px" }, on: { input: (e) => (t.label = e.target.value) } })) : null,
          t.type !== "manual" && t.every !== "hourly" ? h("label.row.small", "um", h("input.input.mono", { type: "time", value: t.time || "08:00", style: { height: "30px" }, on: { input: (e) => (t.time = e.target.value) } })) : null),
          t.type === "date" ? h("div.row.wrap.small.t2", (t.repeat || "yearly") === "yearly" ? "Vergleicht Tag und Monat." : (t.repeat === "monthly" ? "Vergleicht den Tag." : "Braucht ein vollständiges Datum."),
            h("label.row", "Tage vorher", h("input.input", { type: "number", min: 0, value: t.offset_days || 0, style: { width: "64px", height: "28px" }, on: { input: (e) => (t.offset_days = +e.target.value) } })),
            h("label.row", "29.2. in normalen Jahren am", h("select.input", { style: { height: "28px" }, on: { change: (e) => (t.feb29 = e.target.value) } }, h("option", { value: "feb28", selected: t.feb29 !== "mar1" }, "28.2."), h("option", { value: "mar1", selected: t.feb29 === "mar1" }, "1.3.")))) : null),
        // Wenn
        h("div.row.small.t2", h("span.tag", "wenn"), "Bedingungen, alle müssen zutreffen"),
        r.conditions.map((c, i) => h("div.rblock", h("div.row.wrap",
          h("select.input", { style: { height: "30px" }, on: { change: (e) => { c.field = e.target.value; draw(); } } }, SPECIAL.filter(([k]) => (k !== "f_level" || S.settings.use_levels) && (k !== "ist" || S.settings.use_ist)).map(([k, l]) => h("option", { value: k, selected: c.field === k }, l)),
            S.fieldList.filter((f) => f.id !== "f_level" && f.scope !== "kreis").map((f) => h("option", { value: f.id, selected: c.field === f.id }, `${f.name} · ${f.id}`))),
          h("select.input", { style: { height: "30px" }, on: { change: (e) => { c.op = e.target.value; draw(); } } }, OPS.map(([k, l]) => h("option", { value: k, selected: c.op === k }, l))),
          ["empty", "not_empty", "is_true", "is_false"].includes(c.op) ? null : condValue(c),
          h("button.btn.sm.ghost.icon", { on: { click: () => { r.conditions.splice(i, 1); draw(); } } }, icon("x"))))),
        h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: () => { r.conditions.push({ field: S.settings.use_levels ? "f_level" : "kind", op: S.settings.use_levels ? "<=" : "=", value: S.settings.use_levels ? 2 : "person" }); draw(); } } }, icon("plus"), "Bedingung"),
        // Dann
        h("div.row.small.t2", h("span.tag", "dann"), "Aktionen"),
        r.actions.map((a, i) => h("div.rblock", h("div.row.wrap",
          h("select.input", { style: { height: "30px" }, on: { change: (e) => { r.actions[i] = { type: e.target.value }; draw(); } } }, ACTS.map(([k, l]) => h("option", { value: k, selected: a.type === k }, l))),
          a.type === "webhook" ? [h("select.input", { style: { height: "30px", width: "90px" }, on: { change: (e) => (a.method = e.target.value) } }, ["POST", "PUT", "GET"].map((m) => h("option", { selected: (a.method || "POST") === m }, m))),
            h("input.input.mono.grow", { value: a.url || "", placeholder: "https://n8n.home.lan/webhook/…", on: { input: (e) => (a.url = e.target.value) } })] : null,
          ["card", "list"].includes(a.type) ? h("input.input.grow", { value: a.title || "", placeholder: a.type === "card" ? "{name} hat Geburtstag" : "Lange nicht gesehen", on: { input: (e) => (a.title = e.target.value) } }) : null,
          a.type === "card" ? h("input.input.grow", { value: a.text || "", placeholder: "{alter}", on: { input: (e) => (a.text = e.target.value) } }) : null,
          ["set_today", "add_today", "increment", "set_value"].includes(a.type) ? fieldSel(a.field, (f) => (a.type === "set_today" || a.type === "add_today" ? f.type === "date" : a.type === "increment" ? f.type === "number" : f.scope !== "kreis"), (v) => (a.field = v)) : null,
          a.type === "set_value" ? h("input.input", { value: a.value ?? "", placeholder: "Wert", on: { input: (e) => (a.value = e.target.value) } }) : null,
          a.type === "import" ? h("input.input.mono", { value: a.importer || "", placeholder: "Importer-ID", on: { input: (e) => (a.importer = e.target.value) } }) : null,
          h("button.btn.sm.ghost.icon", { on: { click: () => { r.actions.splice(i, 1); draw(); } } }, icon("x"))),
          a.type === "webhook" ? h("details", h("summary.small.t2", "Header (JSON, z.B. Authorization)"), h("textarea.input.mono", { rows: 2, value: a.headers ? JSON.stringify(a.headers) : "", on: { change: (e) => { try { a.headers = e.target.value ? JSON.parse(e.target.value) : undefined; } catch (_) { toast("Header kein gültiges JSON", { err: true }); } } } })) : null,
          ["card", "list"].includes(a.type) ? h("div.tiny.t3", "Platzhalter: {name} {alter} {datum} {tage} {ring}") : null)),
        h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: () => { r.actions.push({ type: "webhook", url: "" }); draw(); } } }, icon("plus"), "Aktion"),
        preview,
        h("div.row.wrap", h("button.btn.primary", { on: { click: save } }, "Speichern"),
          r.id ? h("button.btn", { on: { click: async () => { const res = await POST(`/routines/${r.id}/run`); toast(`Ausgeführt: ${res.count} Person(en). ${res.result.join("; ")}`); } } }, icon("zap"), "Jetzt ausführen") : null,
          h("span.grow"), r.id ? h("button.btn.danger", { on: { click: async () => { if (await confirmDlg("Routine löschen?", r.name, "Löschen", true)) { await DEL("/routines/" + r.id); reloadTab(body, routines, {}); } } } }, icon("trash"), "Löschen") : null),
        cur.last_run_at ? h("div.small.t3", `Zuletzt: ${fmtTs(cur.last_run_at)} – ${cur.last_status || ""}`) : null,
        h("p.small.t3", "Felder werden über ihre ID angesprochen. Umbenennen bricht nichts."));
      runTest();
    };
    const condValue = (c) => {
      if (c.field === "kind") return h("select.input", { style: { height: "30px" }, on: { change: (e) => (c.value = e.target.value) } }, h("option", { value: "person", selected: c.value === "person" }, "Mensch"), h("option", { value: "pet", selected: c.value === "pet" }, "Haustier"));
      if (c.field === "f_level" || c.field === "ist") return h("select.input", { style: { height: "30px" }, on: { change: (e) => (c.value = +e.target.value) } }, [1, 2, 3, 4].map((n) => h("option", { value: n, selected: +c.value === n }, `${n} · ${RING()[n]}`)));
      if (c.field === "circle" || c.field === "circle_kind") {
        const opts = c.field === "circle" ? Object.values(S.circles).map((x) => [x.id, x.name]) : Object.values(S.kinds).map((x) => [x.id, x.name]);
        const vals = new Set(Array.isArray(c.value) ? c.value : c.value ? [c.value] : []);
        return h("select.input", { multiple: true, size: 3, on: { change: (e) => (c.value = [...e.target.selectedOptions].map((o) => o.value)) } }, opts.map(([k, l]) => h("option", { value: k, selected: vals.has(k) }, l)));
      }
      return h("input.input", { value: c.value ?? "", style: { width: "140px", height: "30px" }, on: { input: (e) => (c.value = isNaN(+e.target.value) || e.target.value === "" ? e.target.value : +e.target.value) } });
    };
    const runTest = async () => {
      const personSel = h("select.input", { style: { height: "30px" }, on: { change: (e) => { testId = e.target.value; runTest(); } } }, all.filter((x) => !x.is_self).map((x) => h("option", { value: x.id, selected: x.id === testId }, x.display)));
      let res = null;
      try { res = await api("POST", "/routines/test", { routine: { name: r.name, trigger: r.trigger, conditions: r.conditions, actions: r.actions }, entity_id: testId }, { quiet: true }); }
      catch (e) { clear(preview, h("div.small", { style: { color: "var(--danger)" } }, e.message)); return; }
      const hook = r.actions.find((a) => a.type === "webhook");
      const today = new Date().toISOString().slice(0, 10);
      const verdict = r.trigger.type === "manual" ? (res.matches ? "Knopf ist für diese Person verfügbar." : "Bedingungen nicht erfüllt.")
        : !res.matches ? "Würde nicht feuern: Bedingungen nicht erfüllt." : res.next === today ? "Würde heute feuern." : res.next ? `Würde heute nicht feuern. Nächster Termin: ${res.next}` : "Kein Termin (Datum fehlt oder unvollständig).";
      clear(preview,
        hook ? h("div.col", h("div.small.t2", "Vorschau der Daten, die der Webhook sendet:"), h("div.code", JSON.stringify(r.trigger.type === "schedule" ? res.payload_all : res.payload, null, 2))) : null,
        h("div.rblock", h("div.row.wrap", h("span.small", "Testen mit:"), personSel, h("span.small", verdict)),
          res.conditions?.length ? h("div.row.wrap.small", res.conditions.map((c) => h("span.chip" + (c.ok ? ".sel" : ".plain"), icon(c.ok ? "check" : "x", "xs"), (SPECIAL.find((x) => x[0] === c.field)?.[1] || S.fields[c.field]?.name || c.field) + ` (ist: ${c.actual === null || c.actual === undefined ? "–" : JSON.stringify(c.actual)})`))) : null,
          res.preview?.card ? h("div.small.t2", "Karte: " + res.preview.card) : null,
          h("div.small.t2", `Trifft auf ${res.match_count} Person(en) zu.`, res.upcoming?.length && r.trigger.type === "date" ? " Nächste: " + res.upcoming.slice(0, 5).map((u) => `${u.name} ${u.date.slice(5)}`).join(", ") : "")));
    };
    const save = async () => {
      try {
        const payload = { name: r.name, enabled: r.enabled, trigger: r.trigger, conditions: r.conditions, actions: r.actions };
        const saved = r.id ? await PUT("/routines/" + r.id, payload) : await POST("/routines", payload);
        toast("Routine gespeichert");
        const fresh = await GET("/routines"); list.splice(0, list.length, ...fresh); cur = list.find((x) => x.id === saved.id); drawList(); edit();
      } catch (_) {}
    };
    clear(right, h("div.card-b", out)); draw();
  };
  drawList(); edit();
}

// ---------------------------------------------------------------- Importe
async function importers(body) {
  const list = await GET("/importers");
  const on = list.filter((i) => i.enabled), off = list.filter((i) => !i.enabled);
  const reload = () => reloadTab(body, importers);
  const row = (imp) => {
    const det = h("div.imp-detail");
    const status = imp.last_status ? (imp.last_status.startsWith("Fehler") ? h("span.imp-st.err", "Fehler") : h("span.imp-st.ok", "zuletzt " + rel((imp.last_run_at || "").slice(0, 10)))) : imp.enabled ? h("span.imp-st", "eingeschaltet") : null;
    const item = h("div.imp" + (imp.enabled ? ".on" : ""),
      h("button.imp-head", { type: "button", on: { click: () => { const open = item.classList.toggle("open"); if (open && !det.firstChild) det.append(importerCard(imp, reload)); } } },
        h("span.svc-tile", serviceIcon(imp.service || imp.id, 20)),
        h("span.grow", h("b", imp.name), h("span.imp-sub", imp.brings)),
        imp.unofficial ? h("span.tag", "inoffiziell") : null, status, h("span.imp-chev", icon("down"))),
      det);
    return item;
  };
  const blocks = await GET("/import-blocks");
  body.append(h("p.small.t2", "Neue Leute landen unter „Lose“. Ein Importer schreibt nur Werte aus seiner eigenen Quelle und überschreibt nie, was du von Hand gesetzt hast."),
    on.length ? panel("Eingerichtet", ...on.map(row)) : null,
    panel(on.length ? "Weitere Dienste" : "Dienste", ...off.map(row)),
    blocks.length ? panel("Blockiert", ...blocks.map((b) => srow(b.label, `Gelöscht ${rel((b.created_at || "").slice(0, 10))} · wird aus ${b.sources.join(", ")} nicht wieder importiert`,
      h("button.btn.sm", { on: { click: async () => { await DEL("/import-blocks/" + b.id); toast(`${b.label} wird wieder importiert`); reload(); } } }, "Freigeben")))) : null);
}

function importerCard(imp, reload) {
  const cfg = {};
  const form = h("div.col", imp.config.map((c) => {
    const val = imp.configured[c.key] ?? "";
    const el = c.type === "select" ? h("select.input", { on: { change: (e) => (cfg[c.key] = e.target.value) } }, c.options.map((o) => h("option", { selected: val === o }, o)))
      : c.type === "textarea" ? h("textarea.input", { rows: 3, value: val, on: { input: (e) => (cfg[c.key] = e.target.value) } })
        : h("input.input" + (c.type === "secret" ? ".mono" : ""), { value: val, type: c.type === "number" ? "number" : "text", placeholder: c.placeholder || "", on: { input: (e) => (cfg[c.key] = e.target.value) } });
    return h("label.f", c.label + (c.required ? " *" : ""), el, c.help ? h("span.tiny.t3", c.help) : null);
  }));
  const files = imp.accepts_files ? h("input", { type: "file", multiple: true }) : null;
  const logBox = h("div.code.hidden", imp.last_log || "");
  const sched = h("select.input", { style: { height: "30px" } }, [["never", "nur von Hand"], ["hourly", "stündlich"], ["daily", "täglich"], ["weekly", "wöchentlich"], ["monthly", "monatlich"]].map(([k, l]) => h("option", { value: k, selected: (imp.schedule?.every || (imp.enabled && !imp.accepts_files ? "daily" : "never")) === k }, l)));
  const save = async (enable) => {
    const body = { config: cfg, schedule: { every: sched.value, time: "04:00" } };
    if (enable !== undefined) body.enabled = enable;
    try { return await api("PUT", "/importers/" + imp.id, body, { quiet: true }); }
    catch (e) {
      if (e.status === 409) {
        if (await confirmDlg("Inoffizieller Weg", e.message, "Verstanden, einschalten")) { await PUT("/importers/" + imp.id, { ...body, risk_ack: true }); return true; }
        return false;
      }
      toast(e.message, { err: true }); return false;
    }
  };
  const run = async (btn) => {
    if (!(await save(true))) return;
    let fd;
    if (files?.files.length) { fd = new FormData(); for (const f of files.files) fd.append("files", f); }
    btn.disabled = true;
    runImport(imp, fd)
      .then((r) => { logBox.textContent = r.log || ""; })
      .catch(() => {})
      .finally(() => { btn.disabled = false; });
  };

  return h("div.card", h("div.card-h", h("div.row", h("span.svc-tile", serviceIcon(imp.service || imp.id, 20)), h("div", h("h3", imp.name), h("div.small.t2", imp.way))),
    h("div.row", h("span.tag" + (imp.unofficial ? "" : ".yellow"), "offiziell: " + imp.official), h("label.check", h("input", { type: "checkbox", checked: imp.enabled, on: { change: async (e) => { if (!(await save(e.target.checked))) e.target.checked = !e.target.checked; else reload(); } } }), "an"))),
    h("div.card-b.col",
      h("div.small", h("span.t2", "Was reinkommt: "), imp.brings),
      imp.unofficial ? h("div.hint", icon("question"), h("div.grow.small", imp.risk)) : null,
      imp.missing_packages.length ? h("div.hint", h("div.grow.small", "Fehlende Pakete auf dem Server: ", h("span.mono", "pip install " + imp.missing_packages.join(" ")))) : null,
      imp.needs === "google" ? h("div.small.t2", "Nutzt die Google-Verbindung aus ", h("a", { href: "#/settings/sync" }, "Sync"), ".") : null,
      stepsEl(imp), form, files ? h("label.f", imp.file_hint, files) : null,
      h("div.row.wrap", imp.accepts_files && !imp.config.some((c) => c.required) ? null : h("label.row.small", "Zeitplan", sched),
        h("button.btn.sm", { on: { click: async () => { if (await save()) toast("Gespeichert"); } } }, "Speichern"),
        h("button.btn.sm.primary", { on: { click: (e) => run(e.currentTarget) } }, "Jetzt importieren"),
        imp.last_log ? h("button.btn.sm.ghost", { on: { click: () => logBox.classList.toggle("hidden") } }, "Log") : null,
        imp.enabled ? h("button.btn.sm.ghost", { on: { click: async () => { if (await confirmDlg("Zugangsdaten löschen?", "Importierte Werte bleiben.", "Löschen", true)) { await DEL("/importers/" + imp.id); reload(); } } } }, "Zurücksetzen") : null),
      imp.last_run_at ? h("div.small.t3", `Zuletzt ${fmtTs(imp.last_run_at)}: ${imp.last_status}`) : null, logBox));
}

// ---------------------------------------------------------------- Sync
async function sync(body, route) {
  const st = S.settings; const sy = JSON.parse(JSON.stringify(st.sync || { mode: "rule", rules: [] }));
  if (route?.query?.google === "ok") toast("Mit Google verbunden");
  if (route?.query?.google === "fehler") toast("Google-Verbindung fehlgeschlagen", { err: true });
  const rulesBox = h("div.col");
  const drawRules = () => clear(rulesBox, sy.mode !== "rule" ? null : [
    h("div.row.small", "Regeln kombinieren:", h("select.input", { style: { height: "28px" }, on: { change: (e) => (sy.match = e.target.value) } }, h("option", { value: "any", selected: sy.match !== "all" }, "eine reicht (oder)"), h("option", { value: "all", selected: sy.match === "all" }, "alle müssen passen (und)"))),
    ...(sy.rules || []).map((r, i) => h("div.row.wrap.rblock",
      h("select.input", { style: { height: "30px" }, on: { change: (e) => { sy.rules[i] = { type: e.target.value }; drawRules(); } } }, [["level", "Ring bis"], ["circles", "in Kreisen"], ["circle_kinds", "Kreis-Arten"], ["kind", "Art"], ["has_phone", "hat Telefonnummer"]].map(([k, l]) => h("option", { value: k, selected: r.type === k }, l))),
      r.type === "level" ? h("select.input", { style: { height: "30px" }, on: { change: (e) => (r.max = +e.target.value) } }, [1, 2, 3, 4].map((n) => h("option", { value: n, selected: +r.max === n }, `${n} · ${RING()[n]}`))) : null,
      r.type === "circles" || r.type === "circle_kinds" ? h("select.input", { multiple: true, size: 4, on: { change: (e) => (r.ids = [...e.target.selectedOptions].map((o) => o.value)) } },
        (r.type === "circles" ? Object.values(S.circles).map((c) => [c.id, c.name]) : Object.values(S.kinds).map((k) => [k.id, k.name])).map(([k, l]) => h("option", { value: k, selected: (r.ids || []).includes(k) }, l))) : null,
      r.type === "kind" ? h("select.input", { style: { height: "30px" }, on: { change: (e) => (r.value = e.target.value) } }, h("option", { value: "person", selected: r.value !== "pet" }, "Menschen"), h("option", { value: "pet", selected: r.value === "pet" }, "Haustiere")) : null,
      h("button.btn.sm.ghost.icon", { on: { click: () => { sy.rules.splice(i, 1); drawRules(); } } }, icon("x")))),
    h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: () => { (sy.rules ||= []).push({ type: S.settings.use_levels ? "level" : "has_phone", max: 2 }); drawRules(); } } }, icon("plus"), "Regel")]);
  drawRules();
  const host = h("input.input.mono", { value: st.public_host || "", placeholder: "syn.example.org", style: { width: "240px" } });
  const cc = h("input.input.mono", { value: st.country_code || "49", style: { width: "80px" } });
  const save = () => saveSettings({ sync: sy, public_host: host.value.trim(), country_code: cc.value.trim() || "49" });
  const copy = (text) => h("span.row", { style: { gap: "6px" } }, h("span.mono", text), h("button.btn.sm.icon.ghost", { title: "Kopieren", on: { click: () => { navigator.clipboard?.writeText(text); toast("Kopiert"); } } }, icon("copy")));
  body.append(
    panel("Wer aufs Handy kommt",
      srow("Synchronisieren", sy.mode === "all" ? "Alle Personen." : "Dazu jede Person, bei der „Mit Handy synchronisieren“ an ist.",
        segc([["all", "Jeder"], ["rule", "Nach Regel"], ["none", "Niemand"]], sy.mode, (k) => { sy.mode = k; S.settings.sync = sy; save(); reloadTab(body, sync); })),
      sy.mode === "rule" ? h("div.srow-full", rulesBox) : null,
      sy.mode === "rule" ? srow("", null, h("button.btn.primary", { on: { click: save } }, "Regeln speichern")) : null,
      srow("Was aufs Handy geht", "Nur, was ein Telefonbuch versteht: Name, Nummern, E-Mails, Geburtstag, Profilbild. Ein neuer Kontakt vom Handy landet unter „Lose“.", null)),
    panel("Adresse und Nummern",
      srow("Öffentlicher Hostname", "Damit Kontakte am Handy einen Link zur Personenseite tragen.", h("div.row", host, h("button.btn", { on: { click: save } }, "Speichern"))),
      srow("Ländervorwahl", "Für Nummern ohne Vorwahl, z.B. 0151 … → +49 151 …", h("div.row", cc, h("button.btn", { on: { click: save } }, "Speichern")))),
    panel("Handy direkt mit syn (CardDAV)",
      srow("Per QR-Code einrichten", "Scannen statt abtippen: syn legt dafür ein eigenes Token fürs Handy an. iPhone bekommt ein Profil, Android öffnet DAVx⁵.",
        h("button.btn.primary", { on: { click: () => davQr() } }, icon("qr"), "QR-Code zeigen")),
      srow("Server-Adresse", "Am iPhone: Einstellungen → Kontakte → Accounts → Andere → CardDAV. Android: DAVx⁵.", copy(location.origin + "/dav/")),
      srow("Benutzername", null, copy(S.me.username)),
      srow("Passwort", "Dein syn-Passwort – besser ein eigenes Token.", h("a.btn", { href: "#/settings/tokens" }, icon("key"), "Token erstellen")),
      srow("Löschen am Handy", "Entfernt den Kontakt nur vom Handy, nicht aus syn.", null)),
    await googleCard());
}
// CardDAV per QR: ein Token fürs Handy, für iPhone als Profil-Link, für Android als DAVx⁵-Link
async function davQr() {
  const r = await POST("/carddav/setup");
  const host = location.host, secure = location.protocol === "https:";
  const android = `${secure ? "carddavs" : "carddav"}://${encodeURIComponent(r.username)}:${encodeURIComponent(r.token)}@${host}/dav/`;
  const ios = location.origin + r.profile_path;
  let os = /android/i.test(navigator.userAgent) ? "android" : "ios";
  const box = h("div.qr-dlg");
  const seg = h("div.seg");
  const draw = async () => {
    clear(seg, [["ios", "iPhone"], ["android", "Android (DAVx⁵)"]].map(([k, l]) => h("button" + (os === k ? ".on" : ""), { type: "button", on: { click: () => { os = k; draw(); } } }, l)));
    const steps = os === "ios"
      ? ["Mit der Kamera-App scannen und den Link öffnen.", "Profil laden erlauben, dann Einstellungen → Profil geladen → Installieren.", "Fertig – die Kontakte erscheinen in der Kontakte-App."]
      : ["DAVx⁵ installieren (F-Droid oder Play Store).", "Code mit der Kamera scannen – DAVx⁵ öffnet sich mit allen Angaben.", "Konto anlegen und das Adressbuch „kontakte“ einschalten."];
    clear(box, await qrBox(os === "ios" ? ios : android, ".qr-big"),
      h("ol.imp-steps", steps.map((t, i) => h("li", h("span.imp-step-n", i + 1), h("span", t)))),
      os === "ios" ? h("p.small.t3", "Der Link gilt 15 Minuten. Das Profil ist nicht signiert – iOS weist darauf hin, das ist normal.")
        : h("p.small.t3", "Der Code enthält das Token als Passwort. Zeig ihn nur deinem eigenen Handy."));
  };
  await draw();
  await modal("Handy per QR-Code verbinden", h("div.col", { style: { gap: "14px", alignItems: "center" } }, seg, box), [], {});
  toast("Das Token findest du unter API-Tokens – dort kannst du es jederzeit widerrufen.");
}
async function googleCard() {
  const g = await GET("/google");
  const id = h("input.input.mono", { placeholder: g.configured ? "•••• gespeichert" : "Client-ID" });
  const sec = h("input.input.mono", { placeholder: g.configured ? "•••• gespeichert" : "Client-Secret" });
  return card("Alternative: Sync zu Google Kontakte",
    h("p.small", "Wer kein CardDAV am Handy einrichten will, synchronisiert nach Google Kontakte – Google bringt die Kontakte aufs Handy. Es gelten dieselben Regeln. Die Daten liegen dann auch bei Google. syn bleibt die führende Quelle: Änderungen aus Google kommen als Vorschlag zurück."),
    h("ol.small.t2", h("li", "In der Google Cloud Console ein Projekt anlegen, People API und Calendar API aktivieren."), h("li", "OAuth-Client vom Typ Webanwendung anlegen mit Weiterleitungs-URI: ", h("span.mono", g.redirect_uri)), h("li", "Client-ID und Secret hier eintragen, dann verbinden.")),
    h("div.row.wrap", id, sec, h("button.btn.sm", { on: { click: async () => { await PUT("/google", { client_id: id.value || undefined, client_secret: sec.value || undefined }); toast("Gespeichert"); } } }, "Speichern"),
      h("button.btn.sm.primary", { disabled: !g.configured && false, on: { click: async () => { if (id.value) await PUT("/google", { client_id: id.value, client_secret: sec.value }); const r = await GET("/google/auth-url"); location.href = r.url; } } }, g.connected ? "Neu verbinden" : "Mit Google verbinden")),
    g.connected ? h("div.row.wrap", h("label.check", h("input", { type: "checkbox", checked: g.sync_enabled, on: { change: async (e) => { await PUT("/google", { sync_enabled: e.target.checked }); toast(e.target.checked ? "Sync stündlich aktiv" : "Sync aus"); } } }), "Stündlich synchronisieren"),
      h("button.btn.sm", { on: { click: async (e) => { e.target.disabled = true; const r = await POST("/google/sync"); toast(r.status, { err: r.status.startsWith("Fehler") }); e.target.disabled = false; } } }, icon("refresh"), "Jetzt synchronisieren"),
      h("button.btn.sm.ghost.danger", { on: { click: async () => { if (await confirmDlg("Google trennen?", "Die Verbindung und die Zuordnungen werden gelöscht. Kontakte in Google bleiben.", "Trennen", true)) { await DEL("/google"); location.reload(); } } } }, "Trennen")) : null,
    g.last_sync ? h("div.small.t3", `Zuletzt ${fmtTs(g.last_sync)}: ${g.last_status} · ${g.mapped} Kontakte in Google`) : null);
}

// ---------------------------------------------------------------- Kalender (iCal-Feeds)
const REPEAT = [["yearly", "jährlich"], ["monthly", "monatlich"], ["once", "einmalig"]];
async function calendars(body) {
  const feeds = await GET("/calendars");
  const dateFields = S.fieldList.filter((f) => f.type === "date" && f.scope !== "kreis");
  const reload = () => reloadTab(body, calendars);
  const feedCard = (f) => {
    const url = location.origin + f.path;
    const webcal = url.replace(/^https?:/, "webcal:");
    const save = async (patch) => { try { Object.assign(f, await api("PATCH", "/calendars/" + f.id, patch, { quiet: true })); toast("Gespeichert"); } catch (e) { toast(e.message, { err: true }); } };
    const fieldsBox = h("div.col.cal-fields");
    const drawFields = () => clear(fieldsBox, dateFields.map((d) => {
      const cur = f.fields.find((x) => x.field === d.id);
      const set = (repeat) => { f.fields = f.fields.filter((x) => x.field !== d.id); if (repeat) f.fields.push({ field: d.id, repeat }); save({ fields: f.fields }); drawFields(); };
      return h("div.cal-field", h("label.check.grow", h("input", { type: "checkbox", checked: !!cur, on: { change: (e) => set(e.target.checked ? "yearly" : null) } }), d.name,
        d.scope === "bund" ? h("span.tiny.t3", " (Ihr zwei)") : null),
        cur ? h("div.seg.sm", REPEAT.map(([k, l]) => h("button" + (cur.repeat === k ? ".on" : ""), { type: "button", on: { click: () => set(k) } }, l))) : null);
    }));
    drawFields();
    const circleSel = h("select.input", { multiple: true, size: Math.min(6, Math.max(3, Object.keys(S.circles).length)), on: { change: (e) => save({ circles: [...e.target.selectedOptions].map((o) => o.value) }) } },
      Object.values(S.circles).sort((a, b) => a.name.localeCompare(b.name, LOCALE())).map((c) => h("option", { value: c.id, selected: f.circles.includes(c.id) }, c.name)));
    const ringSel = h("select.input", { on: { change: (e) => save({ max_level: e.target.value ? +e.target.value : null }) } },
      h("option", { value: "" }, "alle Ringe"), [1, 2, 3, 4].map((n) => h("option", { value: n, selected: f.max_level === n }, `bis ${n} · ${RING()[n]}`)));
    const name = h("input.input", { value: f.name, on: { change: (e) => save({ name: e.target.value }) } });
    const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast("Kopiert"); } catch (_) { toast(t); } };
    return panel(f.name,
      srow("Name", null, name),
      srow("Adresse zum Abonnieren", "Google Kalender: „Über URL hinzufügen“. Apple/Thunderbird: Abonnement. Android: ICSx⁵. Wer die Adresse kennt, sieht den Kalender.",
        h("div.row.wrap", h("button.btn.sm.primary", { on: { click: () => copy(url) } }, icon("copy"), "Adresse kopieren"),
          h("a.btn.sm", { href: webcal }, icon("calendar"), "Abonnieren"),
          h("button.btn.sm", { on: { click: async () => { const { qrDialog } = await import("./qr.js"); qrDialog(f.name, url, { hint: "Mit dem Handy scannen und in der Kalender-App abonnieren." }); } } }, icon("qr"), "QR-Code"))),
      h("div.srow-full", h("div.small.t2", { style: { margin: "4px 0 8px" } }, "Welche Daten, und wie oft sie wiederkehren:"), fieldsBox),
      srow("Nur Personen in diesen Kreisen", "Nichts gewählt = alle.", circleSel),
      S.settings.use_levels ? srow("Nur bis Ring", null, ringSel) : null,
      srow("Haustiere", null, sw(f.with_pets, (v) => save({ with_pets: v }))),
      srow("", null, h("div.row.wrap",
        h("button.btn.sm", { on: { click: async () => { if (await confirmDlg("Neue Adresse?", "Die alte Adresse funktioniert dann nicht mehr – überall neu abonnieren.", "Neue Adresse")) { await POST(`/calendars/${f.id}/new-link`); reload(); } } } }, icon("refresh"), "Neue Adresse"),
        h("button.btn.sm.danger", { on: { click: async () => { if (await confirmDlg("Kalender löschen?", f.name, "Löschen", true)) { await DEL("/calendars/" + f.id); reload(); } } } }, icon("trash"), "Löschen"))));
  };
  body.append(
    panel("", srow("Kalender zum Abonnieren", "Geburtstage, Jahrestage, „Kennengelernt“ … aus syn in deinem Kalender. Der Kalender aktualisiert sich selbst (alle paar Stunden).",
      h("button.btn.primary", { on: { click: async () => { await POST("/calendars", { name: feeds.length ? "Neuer Kalender" : "Geburtstage", fields: [{ field: "f_bday", repeat: "yearly" }] }); reload(); } } }, icon("plus"), "Kalender anlegen"))),
    ...feeds.map(feedCard));
}

// ---------------------------------------------------------------- Vorschläge
async function suggestions(body) {
  const list = await GET("/suggestions");
  const circ = await GET("/suggestions/circles");
  body.append(card("Werte aus Importen und Google", list.length ? list.map((s) => h("div.row", { style: { borderBottom: "1px solid var(--line)", padding: "6px 0" } },
    s.payload.img ? h("img.sugg-img", { src: s.payload.img, alt: "" }) : null, h("a", { href: "#/p/" + s.entity_id }, s.entity_name), h("span.grow.small", h("b", s.field_name || (s.kind === "name" ? "Name" : s.kind === "avatar" ? "Profilbild" : s.kind)), ": ", typeof s.payload.value === "object" ? JSON.stringify(s.payload.value) : String(s.payload.value), h("span.t3", ` · ${s.payload.why || ""} · ${s.source}`)),
    h("button.btn.sm", { on: { click: async (e) => { await POST(`/suggestions/${s.id}/accept`); invalidate(); e.target.closest(".row").remove(); } } }, "Übernehmen"),
    h("button.btn.sm.ghost", { on: { click: async (e) => { await POST(`/suggestions/${s.id}/reject`); e.target.closest(".row").remove(); } } }, "Ablehnen"))) : h("div.t3", "Keine offenen Vorschläge.")),
  card("Neue Kreise", circ.length ? circ.map((sg) => h("div.row", { style: { borderBottom: "1px solid var(--line)", padding: "6px 0" } },
    h("div.grow", h("b", sg.name), " – ", sg.member_names.join(", "), h("div.small.t3", sg.reason)),
    h("button.btn.sm", { on: { click: async (e) => { const n = await promptDlg("Kreis anlegen", "Name", sg.name); if (!n) return; await POST("/suggestions/circles/accept", { ...sg, name: n }); await reloadCircles(); invalidate(); e.target.closest(".row").remove(); } } }, "Anlegen"),
    h("button.btn.sm.ghost", { on: { click: async (e) => { await POST("/suggestions/circles/dismiss", sg); e.target.closest(".row").remove(); } } }, "Nein"))) : h("div.t3", "Keine Vorschläge. Vorschläge sind nie verpflichtend.")));
}

// ---------------------------------------------------------------- Module, Konto, Admin
async function modules(body) {
  body.append(
    panel("Module",
      srow("Notizen", "Datierte Notizen, in denen Namen automatisch erkannt werden. Mit „Dabei“-Zeile und Werte-Übernahme.", sw(S.settings.notes_enabled, async (v) => { await saveSettings({ notes_enabled: v }); location.reload(); }))),
    panel("Daten",
      srow("Alles exportieren", "Personen, Kreise, Bünde, Felder und Routinen als JSON.", h("button.btn", { on: { click: async () => download("syn-export.json", JSON.stringify({ entities: await GET("/entities"), circles: await GET("/circles"), bunds: await GET("/bunds"), fields: await GET("/fields"), routines: await GET("/routines") }, null, 2)) } }, icon("download"), "Exportieren")),
      srow("API", "Alles, was die Oberfläche kann, geht auch über die API.", h("a.btn", { href: "#/api" }, icon("ext"), "API-Dokumentation"))));
}

async function appearance(body) {
  body.append(
    panel("Darstellung",
      srow("Farbschema", "Gilt für dieses Gerät.", segc([["system", "Wie das System"], ["light", "Hell"], ["dark", "Dunkel"]], themePref(), (k) => setTheme(k))),
      srow("Sprache", "Gilt für dieses Gerät. „Automatisch“ folgt der Sprache des Browsers.", h("select.input", { style: { width: "200px" }, on: { change: (e) => setLang(e.target.value) } }, LANGS.map(([k, l]) => h("option", { value: k, selected: langPref() === k }, l))))),
    panel("Namen",
      srow("Reihenfolge", "Wie Namen in Listen, Tabelle und Suche erscheinen.", segc([["first", "Vorname Nachname"], ["last", "Nachname, Vorname"]], S.settings.name_order || "first", async (k) => { await saveSettings({ name_order: k }); S.rows = null; reloadTab(body, appearance); }))),
    panel("Karten",
      srow("Adressen öffnen mit", "Ein Klick auf eine Adresse öffnet die Karte.", segc(MAPS, S.settings.map_provider || "osm", async (k) => { await saveSettings({ map_provider: k }); reloadTab(body, appearance); }))));
}

async function account(body) {
  const ses = await GET("/sessions");
  const dn = h("input.input", { value: S.me.display_name, style: { width: "240px" }, on: { change: (e) => saveSettings({ display_name: e.target.value }) } });
  const o = h("input.input", { type: "password", placeholder: "Altes Passwort", autocomplete: "current-password" });
  const n = h("input.input", { type: "password", placeholder: "Neues Passwort", autocomplete: "new-password" });
  body.append(
    panel("Profil",
      srow("Anzeigename", "So nennt dich syn.", dn),
      srow("Benutzername", "Für die Anmeldung und CardDAV.", h("span.mono", S.me.username))),
    panel("Passwort",
      srow("Passwort ändern", "Mindestens 8 Zeichen.", h("div.row", o, n, h("button.btn", { on: { click: async () => { await POST("/me/password", { old: o.value, new: n.value }); o.value = n.value = ""; toast("Passwort geändert"); } } }, "Ändern")))),
    await twoFactorPanel(),
    panel("Angemeldete Geräte",
      ...ses.map((x) => srow(x.agent?.replace(/\(.*?\)/g, "").slice(0, 60) || "Unbekanntes Gerät", `Seit ${(x.created_at || "").slice(0, 10)} · läuft ab ${(x.expires_at || "").slice(0, 10)}`, null)),
      srow("Abmelden", "Auf diesem Gerät.", h("button.btn", { on: { click: async () => { await POST("/auth/logout"); location.hash = "#/login"; } } }, icon("logout"), "Abmelden"))));
}

async function tokens(body) {
  const toks = await GET("/tokens");
  const tn = h("input.input", { placeholder: "Name, z.B. n8n oder Türschild", style: { width: "260px" } });
  const ro = h("input.switch", { type: "checkbox", role: "switch" });
  body.append(
    panel("Neues Token",
      srow("Name", "Wofür das Token ist – damit du es später erkennst.", tn),
      srow("Nur lesen", "Das Token kann nichts ändern, z.B. für ein Türschild.", ro),
      srow("", null, h("button.btn.primary", { on: { click: async () => {
        const r = await POST("/tokens", { name: tn.value || "Token", read_only: ro.checked });
        await modal("Token erstellt", h("div.col", h("p", "Kopiere das Token jetzt – es wird nur einmal angezeigt."), h("div.code", r.token), h("button.btn.sm", { on: { click: () => { navigator.clipboard?.writeText(r.token); toast("Kopiert"); } } }, icon("copy"), "Kopieren")), [{ label: "Fertig", primary: true }]);
        reloadTab(body, tokens); } } }, icon("key"), "Token erstellen"))),
    panel("Deine Tokens", ...(toks.length ? toks.map((t) => srow(t.name, `${t.prefix}… · ${t.read_only ? "nur lesen" : "lesen & schreiben"} · erstellt ${(t.created_at || "").slice(0, 10)} · ${t.last_used_at ? "benutzt " + rel(t.last_used_at.slice(0, 10)) : "noch nie benutzt"}`,
      t.revoked_at ? h("span.t3", "widerrufen") : h("button.btn.sm", { on: { click: async () => { await DEL("/tokens/" + t.id); reloadTab(body, tokens); } } }, "Widerrufen"))) : [srow("Noch keine Tokens", "Jedes Token sieht nur deine Daten. Nutzbar auch als Passwort für CardDAV.", null)])));
}

async function admin(body) {
  if (!S.me.is_admin) return body.append(h("div.empty", "Nur für Admins."));
  const users = await GET("/admin/users");
  const imps = await GET("/admin/importers");
  const un = h("input.input", { placeholder: "Benutzername" }), pw = h("input.input", { type: "password", placeholder: "Passwort" }), adm = h("input", { type: "checkbox" });
  body.append(card("Konten", h("p.small.t3", "Konten legt der Admin an. Es gibt keine offene Registrierung und keine E-Mail-Bestätigung. Jeder Datensatz gehört genau einem Nutzer."),
    h("table.mtable", h("tr", h("th", "Benutzer"), h("th", "Name"), h("th", "Einträge"), h("th", "Admin"), h("th", "Angelegt"), h("th")),
      users.map((u) => h("tr", h("td.mono", u.username), h("td", u.display_name), h("td", u.entities), h("td", h("input", { type: "checkbox", checked: u.is_admin, disabled: u.id === S.me.id, on: { change: (e) => PATCH("/admin/users/" + u.id, { is_admin: e.target.checked }) } })),
        h("td.mono", (u.created_at || "").slice(0, 10)),
        h("td.row", h("button.btn.sm", { on: { click: async () => { const p = await promptDlg("Passwort zurücksetzen", `Neues Passwort für ${u.username}`); if (p) { await PATCH("/admin/users/" + u.id, { password: p }); toast("Passwort gesetzt"); } } } }, "Passwort"),
          u.id !== S.me.id ? h("button.btn.sm.danger", { on: { click: async () => { if (await confirmDlg("Konto löschen?", `${u.username} und alle Daten dieses Kontos werden gelöscht.`, "Löschen", true)) { await DEL("/admin/users/" + u.id); reloadTab(body, admin); } } } }, "Löschen") : null)))),
    h("div.row.wrap", un, pw, h("label.check", adm, "Admin"), h("button.btn.sm.primary", { on: { click: async () => { await POST("/admin/users", { username: un.value, password: pw.value, is_admin: adm.checked }); reloadTab(body, admin); } } }, icon("plus"), "Konto anlegen"))),
    card("Importer-Module (für alle Konten)", h("p.small.t3", "Jeder Importer ist ein eigenes Modul, das man an- und ausschalten kann."),
      h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: "6px" } }, imps.map((i) => h("label.check", h("input", { type: "checkbox", checked: i.enabled, on: { change: (e) => PUT("/admin/importers/" + i.id, { enabled: e.target.checked }) } }), i.name)))));
}

// ---------------------------------------------------------------- Tastenkürzel
async function shortcuts(body) {
  const groups = {};
  for (const a of ACTIONS) (groups[a[1]] ||= []).push(a);
  body.append(h("p.small.t2", "Einfache Tasten ohne Sondertaste wirken nicht, während du in ein Feld tippst. Shift+? zeigt alle Kürzel."),
    ...Object.entries(groups).map(([g, list]) => panel(g, ...list.map(([id, , label, def]) => {
      const cur = binding(id);
      return srow(label, cur !== def ? h("span", "Standard: ", keys(def)) : null, h("div.row",
        h("button.kbd-btn", { title: "Neu belegen", on: { click: async () => { const c = await recordCombo(); if (c) { await saveBinding(id, c); reloadTab(body, shortcuts); } } } }, keys(cur)),
        cur !== def ? h("button.btn.sm.ghost", { on: { click: async () => { await saveBinding(id, null); reloadTab(body, shortcuts); } } }, "Zurücksetzen")
          : h("button.btn.sm.ghost", { on: { click: async () => { await saveBinding(id, ""); reloadTab(body, shortcuts); } } }, "Aus")));
    }))),
    h("button.btn", { style: { alignSelf: "flex-start" }, on: { click: async () => { await saveSettings({ shortcuts: {} }); reloadTab(body, shortcuts); } } }, icon("refresh"), "Alle auf Standard"));
}

// ---------------------------------------------------------------- Visitenkarte
async function cardTab(body) {
  let c = await GET("/card");
  const origin = location.origin.replace(/^https?:\/\//, "");
  const url = () => location.origin + c.path;
  const save = async (patch) => { try { c = await api("PATCH", "/card", patch, { quiet: true }); refresh(); return true; } catch (e) { toast(e.message, { err: true }); return false; } };
  const linkTxt = h("span.mono");
  const openA = h("a.btn.sm", { target: "_blank", rel: "noopener" }, icon("ext"), "Öffnen");
  const refresh = () => { linkTxt.textContent = origin + c.path; openA.href = c.path; box.classList.toggle("off", !c.enabled); };
  const slug = h("input.input.mono.card-slug", { value: c.slug, spellcheck: false, on: { change: async (e) => { if (!(await save({ slug: e.target.value }))) e.target.value = c.slug; } } });
  const copy = h("button.btn.sm.primary", { on: { click: async () => { try { await navigator.clipboard.writeText(url()); toast("Link kopiert"); } catch (_) { toast(url()); } } } }, icon("copy"), "Link kopieren");
  const share = navigator.share ? h("button.btn.sm", { on: { click: () => navigator.share({ title: "Meine Visitenkarte", url: url() }).catch(() => {}) } }, icon("ext"), "Teilen") : null;
  const qrBtn = h("button.btn.sm", { on: { click: () => qrDialog("Deine Visitenkarte", url(), { hint: "Gegenüber scannt den Code mit der Kamera und sieht deine Angaben." }) } }, icon("qr"), "QR-Code");
  const box = h("div.card-link", h("div.card-link-url", icon("link"), linkTxt), h("div.row.wrap", copy, qrBtn, share, openA));
  const persons = S.fieldList.filter((f) => ["person", "both"].includes(f.scope) && !["note", "image", "ref", "person", "checkbox"].includes(f.type) && !["f_level", "f_seen", "f_via", "f_met"].includes(f.id));
  const mine = (await rows()).find((r) => r.is_self);
  const list = (key, hint) => h("div.card-fields", persons.map((f) => {
    const has = !!mine?.v?.[f.id];
    const cb = h("input", { type: "checkbox", checked: c[key].includes(f.id), on: { change: () => { const set = new Set(c[key]); cb.checked ? set.add(f.id) : set.delete(f.id); save({ [key]: persons.map((x) => x.id).filter((id) => set.has(id)) }); } } });
    return h("label.check.card-field", cb, h("span.grow", f.name), key === "fields" ? h("span.small.t3", has ? mine.v[f.id].d : "noch leer") : null);
  }), hint ? h("p.small.t3", hint) : null);
  const intro = h("textarea.input.card-intro", { rows: 3, maxLength: 280, placeholder: "z.B. Schön, dich kennenzulernen! Hier sind meine Kontaktdaten.", value: c.intro || "", on: { change: (e) => save({ intro: e.target.value }) } });
  body.append(
    panel("", srow("Visitenkarte teilen", "Wer den Link hat, sieht die Angaben unten und kann dir seine eigenen schicken. Ohne Freigabe ist der Link aus.", sw(c.enabled, (v) => save({ enabled: v })))),
    panel("Link", h("div.srow-full.col", { style: { gap: "10px" } },
      h("label.f", "Dein Link", h("div.card-slug-row", h("span.t3.mono", origin + "/@"), slug)),
      h("p.small.t3", "Kurz und frei wählbar: Kleinbuchstaben, Ziffern, Punkt, Strich und Unterstrich."), box)),
    panel("Was du teilst", h("div.srow-full", list("fields", "Die Werte kommen aus deinem eigenen Profil („Mein Profil“). Leere Felder bleiben unsichtbar."))),
    panel("Was andere dir schicken können", h("div.srow-full", list("ask", "Der Name ist immer dabei, dazu ein Feld für eine Nachricht. Antworten landen als neue Person mit der Quelle „Visitenkarte“ – und unter „Heute“."))),
    h("section.set-panel", h("h3.set-ptitle", "Begrüßung"), intro));
  refresh();
}

// Kreis-Art löschen: wird sie noch benutzt, erst zeigen, welche Kreise (mit wem) betroffen sind, und neu zuordnen
async function deleteKind(k, kinds) {
  const used = Object.values(S.circles).filter((c) => c.kind_id === k.id).sort((a, b) => a.name.localeCompare(b.name, LOCALE()));
  if (!used.length) { await DEL("/circle-kinds/" + k.id); return true; }
  const others = kinds.filter((x) => x.id !== k.id);
  const all = await rows();
  const opts = (sel) => [h("option", { value: "", selected: !sel }, "Ohne Art (Lose-Farben)"), ...others.map((x) => h("option", { value: x.id, selected: sel === x.id }, x.name))];
  const target = Object.fromEntries(used.map((c) => [c.id, others[0]?.id || ""]));
  const items = used.map((c) => {
    const members = all.filter((r) => r.circles_all?.includes(c.id) && !r.is_self);
    const sel = h("select.input.kd-sel", { on: { change: (e) => { target[c.id] = e.target.value; } } }, opts(target[c.id]));
    return { c, sel, el: h("div.kd-row",
      h("span.av.kd-av", { style: { background: k.bg, color: k.fg } }, k.icon ? icon(k.icon) : k.abbr),
      h("div.kd-main", h("b", c.name), h("div.kd-people", members.slice(0, 8).map((r) => avatar(r, 24, { exact: true })), members.length > 8 ? h("span.small.t3", `+${members.length - 8}`) : null,
        !members.length ? h("span.small.t3", "noch niemand") : h("span.small.t3", members.length === 1 ? "1 Person" : `${members.length} Personen`))),
      sel) };
  });
  const allSel = h("select.input", { on: { change: (e) => { for (const it of items) { target[it.c.id] = e.target.value; it.sel.value = e.target.value; it.sel.dispatchEvent(new Event("change")); } } } }, h("option", { value: "-", disabled: true, selected: true }, "Alle zuordnen zu …"), opts(null).map((o) => (o.selected = false, o)));
  const n = used.length;
  const ok = await modal(`„${k.name}“ löschen?`, h("div.col", { style: { gap: "12px" } },
    h("p.small.t2", `${n === 1 ? "Ein Kreis hat" : n + " Kreise haben"} diese Art. Wähle, welche Art ${n === 1 ? "er" : "sie"} stattdessen bekommen – die Personen bleiben in ihren Kreisen.`),
    h("div.kd-all", h("span.small.t2", "Für alle:"), allSel),
    h("div.kd-list", items.map((it) => it.el))),
    [{ label: "Abbrechen" }, { label: "Umziehen und löschen", danger: true, action: async () => {
      for (const it of items) await PATCH("/circles/" + it.c.id, { kind_id: target[it.c.id] || null });
      await DEL("/circle-kinds/" + k.id); return true;
    } }]);
  if (ok) { await reloadCircles(); toast(`„${k.name}“ gelöscht`); }
  return !!ok;
}

// ---------------------------------------------------------------- Zwei-Faktor
function codesBox(codes) {
  const txt = codes.join("\n");
  return h("div.tf-codes", h("p.small.t2", "Wiederherstellungscodes – jeder gilt einmal, falls du dein Handy nicht hast. Bewahre sie sicher auf, syn zeigt sie nur jetzt."),
    h("pre.code.tf-list", txt),
    h("div.row", h("button.btn.sm", { on: { click: async () => { try { await navigator.clipboard.writeText(txt); toast("Kopiert"); } catch (_) {} } } }, icon("copy"), "Kopieren"),
      h("button.btn.sm", { on: { click: () => download("syn-wiederherstellungscodes.txt", txt, "text/plain") } }, icon("download"), "Als Datei")));
}
async function twoFactorPanel() {
  const st = await GET("/me/2fa");
  const box = h("div.srow-full");
  const p = panel("Zwei-Faktor-Anmeldung",
    srow(st.enabled ? "Ist an" : "Ist aus", st.enabled ? `Beim Anmelden fragt syn zusätzlich nach einem Code aus deiner Authenticator-App. Noch ${st.recovery_left} Wiederherstellungscodes übrig.`
      : "Schützt dein Konto zusätzlich mit einem Code aus einer Authenticator-App (z.B. 2FAS, Aegis, Google Authenticator, 1Password).",
      st.enabled ? h("div.row", h("button.btn", { on: { click: () => renew() } }, "Neue Codes"), h("button.btn.danger", { on: { click: () => off() } }, "Ausschalten"))
        : h("button.btn.primary", { on: { click: () => setup() } }, icon("shield"), "Einrichten")), box);
  const again = async () => p.replaceWith(await twoFactorPanel());
  async function setup() {
    const s = await POST("/me/2fa/setup");
    const qr = await loadQr().catch(() => null);
    let img = null;
    if (qr) { const q = qr(0, "M"); q.addData(s.uri); q.make(); img = h("div.tf-qr"); img.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }
    const code = h("input.input.mono.tf-code", { placeholder: "123456", inputMode: "numeric", autocomplete: "one-time-code", maxLength: 6 });
    const err = h("p.small", { style: { color: "var(--danger)" } });
    const confirm = async () => {
      try { const r = await api("POST", "/me/2fa/enable", { code: code.value }, { quiet: true }); clear(box, h("div.hint", icon("check"), h("div.grow", h("b", "2FA ist an."))), codesBox(r.recovery_codes), h("button.btn.sm", { on: { click: again } }, "Fertig")); }
      catch (e) { err.textContent = e.message; code.select(); }
    };
    code.addEventListener("keydown", (e) => { if (e.key === "Enter") confirm(); });
    clear(box, h("div.tf-setup",
      img, h("div.col", { style: { gap: "10px" } },
        h("ol.imp-steps", h("li", h("span.imp-step-n", 1), h("span", "Öffne deine Authenticator-App und scanne den QR-Code.")),
          h("li", h("span.imp-step-n", 2), h("span", "Kein Scannen möglich? Gib diesen Schlüssel von Hand ein: ", h("code.tf-secret", s.secret.match(/.{1,4}/g).join(" ")))),
          h("li", h("span.imp-step-n", 3), h("span", "Tippe den 6-stelligen Code aus der App hier ein."))),
        h("div.row", code, h("button.btn.primary", { on: { click: confirm } }, "Bestätigen"), h("button.btn.ghost", { on: { click: () => clear(box) } }, "Abbrechen")), err)));
    code.focus();
  }
  async function off() {
    const pw = h("input.input", { type: "password", placeholder: "Passwort", autocomplete: "current-password" });
    const code = h("input.input.mono", { placeholder: "Code aus der App", inputMode: "numeric", autocomplete: "one-time-code" });
    const ok = await modal("2FA ausschalten?", h("div.col", h("p.small.t2", "Dann reicht wieder das Passwort zum Anmelden."), pw, code),
      [{ label: "Abbrechen" }, { label: "Ausschalten", danger: true, action: () => api("POST", "/me/2fa/disable", { password: pw.value, code: code.value }).catch(() => false) }]);
    if (ok) { toast("2FA ist aus"); again(); }
  }
  async function renew() {
    const code = h("input.input.mono", { placeholder: "Code aus der App", inputMode: "numeric", autocomplete: "one-time-code" });
    const r = await modal("Neue Wiederherstellungscodes", h("div.col", h("p.small.t2", "Die alten Codes verfallen dann."), code),
      [{ label: "Abbrechen" }, { label: "Neue Codes", primary: true, action: () => api("POST", "/me/2fa/recovery", { code: code.value }).catch(() => false) }]);
    if (r) clear(box, codesBox(r.recovery_codes), h("button.btn.sm", { on: { click: again } }, "Fertig"));
  }
  return p;
}
