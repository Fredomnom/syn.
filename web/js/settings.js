// Einstellungen: Felder, Kreis-Arten, Bund-Arten, Ringe, Routinen, Importe, Sync, Vorschläge, Module, Konto, Admin.
import { S, h, icon, api, GET, POST, PUT, PATCH, DEL, clear, invalidate, toast, modal, confirmDlg, promptDlg, rows, reloadFields, reloadCircles,
  loadBase, circleChip, avatar, fmtTs, rel, RING, download, rebuild, isMobile, themePref, setTheme } from "./core.js";
import { TYPE_NAMES } from "./fields.js";
import { hueInput, hueOf } from "./color.js";
import { ACTIONS, binding, pretty, saveBinding, recordCombo } from "./shortcuts.js";

const TABS = [["fields", "Felder"], ["circle-kinds", "Kreis-Arten"], ["bund-kinds", "Bund-Arten"], ["rings", "Ringe"], ["routines", "Routinen"],
  ["importers", "Importe"], ["sync", "Sync"], ["suggestions", "Vorschläge"], ["modules", "Module"], ["shortcuts", "Tastenkürzel"], ["account", "Konto"], ["admin", "Konten (Admin)"]];

export async function settingsPage(main, tab, route) {
  const page = h("div.page"); main.append(page);
  const body = h("div.col", { style: { gap: "16px" } });
  page.append(h("div.page-h", h("h1", "Einstellungen")),
    h("nav.tabs", TABS.filter(([k]) => k !== "admin" || S.me.is_admin).map(([k, l]) => h("a" + (k === tab ? ".on" : ""), { href: "#/settings/" + k }, l))), body);
  const fn = { fields, "circle-kinds": circleKinds, "bund-kinds": bundKinds, rings: ringsTab, routines, importers, sync, suggestions, modules, shortcuts, account, admin }[tab] || fields;
  await fn(body, route);
  requestAnimationFrame(() => page.querySelector(".tabs a.on")?.scrollIntoView({ inline: "center", block: "nearest" }));
}
const reloadTab = (body, fn, route) => rebuild(body, (b) => fn(b, route));
const card = (title, ...kids) => h("div.card", h("div.card-h", h("h3", title)), h("div.card-b.col", kids));
const saveSettings = async (patch) => { S.settings = await PATCH("/me/settings", patch); S.me.settings = S.settings; toast("Gespeichert"); };

// ---------------------------------------------------------------- Felder
async function fields(body) {
  await reloadFields();
  const routines = await GET("/routines");
  const manual = routines.filter((r) => r.trigger.type === "manual");
  const scopes = [["both", "Mensch & Haustier"], ["person", "Mensch"], ["pet", "Haustier"], ["bund", "Bund (z.B. Ihr zwei)"], ["kreis", "Kreis"]];
  const table = h("table.mtable", h("tr", h("th", "Name"), h("th", "ID"), h("th", "Typ"), h("th", "Gilt für"), h("th", "Mehrere Werte"), h("th", "Schnellaktion"), h("th")),
    S.fieldList.map((f, i) => h("tr",
      h("td", h("input.input", { value: f.name, style: { height: "28px" }, on: { change: async (e) => { await PATCH("/fields/" + f.id, { name: e.target.value }); await reloadFields(); toast("Umbenannt – Regeln nutzen die ID, nichts bricht"); } } })),
      h("td", h("span.tag", f.id), f.is_base ? h("span.tiny.t3", " Basis") : null),
      h("td", TYPE_NAMES[f.type]),
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
    h("div.card", table), await servicesCard());
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
  const draw = () => clear(box, list.map((s, i) => h("div.row", h("input.input.mono", { value: s.id, style: { width: "110px" }, on: { input: (e) => (s.id = e.target.value) } }),
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
    h("table.mtable", kinds.map((k) => {
      const prev = h("span.chip", { style: { background: k.bg, color: k.fg } }, k.name);
      const upd = async (patch) => { await PATCH("/circle-kinds/" + k.id, patch); Object.assign(k, patch); prev.style.background = k.bg; prev.style.color = k.fg; prev.textContent = k.name; await loadBase(); };
      return h("tr", h("td", h("span.av", { style: { background: k.bg, color: k.fg } }, k.abbr)), h("td", prev),
        h("td", h("input.input", { value: k.name, on: { change: (e) => upd({ name: e.target.value }) } })),
        h("td", h("input.input.mono", { value: k.abbr, style: { width: "60px" }, maxLength: 3, on: { change: (e) => upd({ abbr: e.target.value }) } })),
        h("td", hueInput(hueOf(k.fg), { label: k.name, onChange: (_h, pair) => upd({ bg: pair.bg, fg: pair.fg }) })),
        h("td", h("button.btn.sm.ghost.icon", { on: { click: async () => { await DEL("/circle-kinds/" + k.id); await loadBase(); reloadTab(body, circleKinds); } } }, icon("trash"))));
    }), h("tr", h("td", h("span.av", { style: { background: lose.bg, color: lose.fg } }, "LO")), h("td", h("span.chip", "Lose")), h("td.t3", { colSpan: 3 }, "fest – für Personen ohne Kreis"))),
    h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: async () => { const n = await promptDlg("Neue Kreis-Art", "Name"); if (n) { const used = kinds.map((k) => hueOf(k.fg)); const free = [0, 30, 60, 95, 140, 175, 200, 230, 265, 300, 330].find((x) => used.every((u) => Math.abs(u - x) > 18)) ?? 200; const { pairForHue } = await import("./color.js"); await POST("/circle-kinds", { name: n, ...pairForHue(free) }); await loadBase(); reloadTab(body, circleKinds); } } } }, icon("plus"), "Kreis-Art")));
}
async function bundKinds(body) {
  const ks = await GET("/bund-kinds");
  body.append(card("Bund-Arten", h("p.small.t3", "Ein Bund ist eine Beziehung zwischen genau zwei Lebewesen. Jede Seite hat eine Rolle."),
    h("table.mtable", h("tr", h("th", "Name"), h("th", "Rolle A"), h("th", "Rolle B"), h("th")), ks.map((k) => h("tr",
      ...["name", "role_a", "role_b"].map((f) => h("td", h("input.input", { value: k[f] || "", on: { change: async (e) => { await PATCH("/bund-kinds/" + k.id, { [f]: e.target.value }); await loadBase(); } } }))),
      h("td", h("button.btn.sm.ghost.icon", { on: { click: async () => { await DEL("/bund-kinds/" + k.id); await loadBase(); reloadTab(body, bundKinds); } } }, icon("trash")))))),
    h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: async () => { const n = await promptDlg("Neue Bund-Art", "Name"); if (n) { await POST("/bund-kinds", { name: n }); await loadBase(); reloadTab(body, bundKinds); } } } }, icon("plus"), "Bund-Art")));
}

// ---------------------------------------------------------------- Ringe
async function ringsTab(body) {
  const st = S.settings;
  const names = { ...st.ring_names }, days = { ...st.unseen_days };
  body.append(card("Ringe (Level)",
    h("label.check", h("input", { type: "checkbox", checked: st.use_levels, on: { change: (e) => saveSettings({ use_levels: e.target.checked }) } }), "Mit Ringen arbeiten – ohne Level fallen die Ringe-Ansicht und Level-Bedingungen weg"),
    h("div.row.wrap", [1, 2, 3, 4].map((n) => h("label.f", `Ring ${n}`, h("input.input", { value: names[n], on: { input: (e) => (names[n] = e.target.value) } })))),
    h("button.btn.sm.primary", { style: { alignSelf: "flex-start" }, on: { click: () => saveSettings({ ring_names: names }) } }, "Namen speichern")),
    card("Berechnetes „Ist“",
      h("label.check", h("input", { type: "checkbox", checked: st.use_ist, on: { change: (e) => saveSettings({ use_ist: e.target.checked }) } }), "„Ist“ aus Zuletzt gesehen, Zählern und Importen (letzte Nachricht) berechnen"),
      h("p.small.t3", "Ist-Ring: letzter Kontakt ≤ 7 Tage → 1, ≤ 30 → 2, ≤ 120 → 3, sonst 4. Ab 25 Treffen einen Ring näher."),
      h("div.small.t2", "„Lange nicht gesehen“ ab … Tagen (je Ring)"),
      h("div.row.wrap", [1, 2, 3, 4].map((n) => h("label.f", `Ring ${n}`, h("input.input", { type: "number", value: days[n], style: { width: "90px" }, on: { input: (e) => (days[n] = +e.target.value) } })))),
      h("button.btn.sm.primary", { style: { alignSelf: "flex-start" }, on: { click: () => saveSettings({ unseen_days: days }) } }, "Speichern")));
}

// ---------------------------------------------------------------- Routinen
const SPECIAL = [["f_level", "Ring · Bund mit dir"], ["ist", "Ist (berechnet)"], ["kind", "Art"], ["circle", "Kreis"], ["circle_kind", "Kreis-Art"], ["lose", "Lose"], ["name_unknown", "Name unbekannt"], ["on_phone", "Mit Handy synchronisiert"]];
const OPS = [["<=", "≤"], ["<", "<"], [">=", "≥"], [">", ">"], ["=", "="], ["!=", "≠"], ["contains", "enthält"], ["in", "ist einer von"], ["not_in", "ist keiner von"], ["empty", "ist leer"], ["not_empty", "ist gesetzt"], ["days_since_gt", "vor mehr als … Tagen"], ["days_since_lt", "vor weniger als … Tagen"], ["is_true", "ist wahr"], ["is_false", "ist falsch"]];
const ACTS = [["webhook", "Webhook"], ["card", "In syn anzeigen: Karte unter „Heute“"], ["list", "In syn anzeigen: Liste unter „Heute“"], ["set_today", "Feld auf heute setzen"], ["increment", "Zahl erhöhen (+1)"], ["set_value", "Feld auf Wert setzen"], ["import", "Import ausführen"], ["google_sync", "Google-Sync ausführen"]];
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
          a.type === "card" ? h("input.input", { value: a.text || "", placeholder: "{alter}", on: { input: (e) => (a.text = e.target.value) } }) : null,
          ["set_today", "increment", "set_value"].includes(a.type) ? fieldSel(a.field, (f) => (a.type === "set_today" ? f.type === "date" : a.type === "increment" ? f.type === "number" : f.scope !== "kreis"), (v) => (a.field = v)) : null,
          a.type === "set_value" ? h("input.input", { value: a.value ?? "", placeholder: "Wert", on: { input: (e) => (a.value = e.target.value) } }) : null,
          a.type === "import" ? h("input.input.mono", { value: a.importer || "", placeholder: "Importer-ID", on: { input: (e) => (a.importer = e.target.value) } }) : null,
          h("button.btn.sm.ghost.icon", { on: { click: () => { r.actions.splice(i, 1); draw(); } } }, icon("x"))),
          a.type === "webhook" ? h("details", h("summary.small.t2", "Header (JSON, z.B. Authorization)"), h("textarea.input.mono", { rows: 2, value: a.headers ? JSON.stringify(a.headers) : "", on: { change: (e) => { try { a.headers = e.target.value ? JSON.parse(e.target.value) : undefined; } catch (_) { toast("Header kein gültiges JSON", { err: true }); } } } })) : null,
          ["card", "list"].includes(a.type) ? h("div.tiny.t3", "Platzhalter: {name} {alter} {datum} {tage} {ring}") : null)),
        h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: () => { r.actions.push({ type: "webhook", url: "" }); draw(); } } }, icon("plus"), "Aktion"),
        preview,
        h("div.row", h("button.btn.primary", { on: { click: save } }, "Speichern"),
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
  body.append(h("p.small.t2", "syn zieht Leute aus Messengern und Online-Diensten. Neue Leute landen unter „Lose“. Ein Importer schreibt nur Werte aus seiner eigenen Quelle und überschreibt nie, was du von Hand gesetzt hast. Unsichere Treffer erscheinen unter „Mögliche Doppelte“."));
  const grid = h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(380px,100%),1fr))", gap: "12px" } });
  body.append(grid);
  for (const imp of list) grid.append(importerCard(imp, () => reloadTab(body, importers)));
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
    btn.disabled = true; btn.textContent = "Läuft …";
    let fd;
    if (files?.files.length) { fd = new FormData(); for (const f of files.files) fd.append("files", f); }
    try { const r = await api("POST", `/importers/${imp.id}/run`, fd); toast(r.status, { err: r.status.includes("Fehler") }); logBox.textContent = r.log; logBox.classList.remove("hidden"); invalidate(); }
    finally { btn.disabled = false; btn.textContent = "Jetzt importieren"; }
  };
  return h("div.card", h("div.card-h", h("div", h("h3", imp.name), h("div.small.t2", imp.way)),
    h("div.row", h("span.tag" + (imp.unofficial ? "" : ".yellow"), "offiziell: " + imp.official), h("label.check", h("input", { type: "checkbox", checked: imp.enabled, on: { change: async (e) => { if (!(await save(e.target.checked))) e.target.checked = !e.target.checked; else reload(); } } }), "an"))),
    h("div.card-b.col",
      h("div.small", h("span.t2", "Was reinkommt: "), imp.brings),
      imp.unofficial ? h("div.hint", icon("question"), h("div.grow.small", imp.risk)) : null,
      imp.missing_packages.length ? h("div.hint", h("div.grow.small", "Fehlende Pakete auf dem Server: ", h("span.mono", "pip install " + imp.missing_packages.join(" ")))) : null,
      imp.needs === "google" ? h("div.small.t2", "Nutzt die Google-Verbindung aus ", h("a", { href: "#/settings/sync" }, "Sync"), ".") : null,
      form, files ? h("label.f", imp.file_hint, files) : null,
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
  const host = h("input.input.mono", { value: st.public_host || "", placeholder: "syn.example.org" });
  const cc = h("input.input.mono", { value: st.country_code || "49", style: { width: "80px" } });
  const n = (await rows()).filter((r) => !r.is_self).length;
  body.append(card("Wer aufs Handy kommt",
    h("div.seg.yellow", [["all", "Jeder"], ["rule", "Nach Regel"], ["none", "Niemand"]].map(([k, l]) => h("button" + (sy.mode === k ? ".on" : ""), { on: { click: () => { sy.mode = k; clear(body); S.settings.sync = sy; sync(body, {}); } } }, l))),
    h("p.small.t3", sy.mode === "all" ? "Alle Personen." : "Außer bei „Jeder“ hat jede Person einen Schalter „Mit Handy synchronisieren“, mit dem sie trotzdem synchronisiert wird."),
    rulesBox,
    h("p.small.t3", "Was aufs Handy geht: nur, was ein Telefonbuch versteht – Name, Nummern, E-Mails, Geburtstag, Profilbild. Ringe, Bünde und Notizen bleiben in syn. Ein neuer Kontakt vom Handy landet unter „Lose“."),
    h("div.row.wrap", h("label.f", "Öffentlicher Hostname (für den Link zur Personenseite)", host), h("label.f", "Ländervorwahl", cc)),
    h("button.btn.primary", { style: { alignSelf: "flex-start" }, on: { click: () => saveSettings({ sync: sy, public_host: host.value.trim(), country_code: cc.value.trim() || "49" }) } }, "Speichern")),
    card("Handy direkt mit syn (CardDAV)",
      h("p.small", "syn ist selbst ein CardDAV-Server. Das Handy synchronisiert direkt mit syn, ohne Google dazwischen."),
      h("div.rblock", h("div.row", h("span.t2", { style: { width: "110px" } }, "Server"), h("span.mono", location.host)),
        h("div.row", h("span.t2", { style: { width: "110px" } }, "Adresse"), h("span.mono", location.origin + "/dav/")),
        h("div.row", h("span.t2", { style: { width: "110px" } }, "Benutzer"), h("span.mono", S.me.username)),
        h("div.row", h("span.t2", { style: { width: "110px" } }, "Passwort"), h("span", "dein syn-Passwort oder besser ein eigenes Token aus ", h("a", { href: "#/settings/account" }, "Konto")))),
      h("p.small.t3", "iPhone: Einstellungen → Kontakte → Accounts → Account hinzufügen → Andere → CardDAV-Account. Android: DAVx⁵ → Login mit URL und Benutzername. Löschen am Handy entfernt nur vom Handy, nicht aus syn.")),
    await googleCard());
}
async function googleCard() {
  const g = await GET("/google");
  const id = h("input.input.mono", { placeholder: g.configured ? "•••• gespeichert" : "Client-ID" });
  const sec = h("input.input.mono", { placeholder: g.configured ? "•••• gespeichert" : "Client-Secret" });
  return card("Option: Sync zu Google Kontakte",
    h("p.small", "Wer kein CardDAV am Handy einrichten will, synchronisiert nach Google Kontakte – Google bringt die Kontakte aufs Handy. Es gelten dieselben Regeln. Die Daten liegen dann auch bei Google. syn bleibt die führende Quelle: Änderungen aus Google kommen als Vorschlag zurück."),
    h("ol.small.t2", h("li", "In der Google Cloud Console ein Projekt anlegen, People API und Calendar API aktivieren."), h("li", "OAuth-Client vom Typ Webanwendung anlegen mit Weiterleitungs-URI: ", h("span.mono", g.redirect_uri)), h("li", "Client-ID und Secret hier eintragen, dann verbinden.")),
    h("div.row.wrap", id, sec, h("button.btn.sm", { on: { click: async () => { await PUT("/google", { client_id: id.value || undefined, client_secret: sec.value || undefined }); toast("Gespeichert"); } } }, "Speichern"),
      h("button.btn.sm.primary", { disabled: !g.configured && false, on: { click: async () => { if (id.value) await PUT("/google", { client_id: id.value, client_secret: sec.value }); const r = await GET("/google/auth-url"); location.href = r.url; } } }, g.connected ? "Neu verbinden" : "Mit Google verbinden")),
    g.connected ? h("div.row.wrap", h("label.check", h("input", { type: "checkbox", checked: g.sync_enabled, on: { change: async (e) => { await PUT("/google", { sync_enabled: e.target.checked }); toast(e.target.checked ? "Sync stündlich aktiv" : "Sync aus"); } } }), "Stündlich synchronisieren"),
      h("button.btn.sm", { on: { click: async (e) => { e.target.disabled = true; const r = await POST("/google/sync"); toast(r.status, { err: r.status.startsWith("Fehler") }); e.target.disabled = false; } } }, icon("refresh"), "Jetzt synchronisieren"),
      h("button.btn.sm.ghost.danger", { on: { click: async () => { if (await confirmDlg("Google trennen?", "Die Verbindung und die Zuordnungen werden gelöscht. Kontakte in Google bleiben.", "Trennen", true)) { await DEL("/google"); location.reload(); } } } }, "Trennen")) : null,
    g.last_sync ? h("div.small.t3", `Zuletzt ${fmtTs(g.last_sync)}: ${g.last_status} · ${g.mapped} Kontakte in Google`) : null);
}

// ---------------------------------------------------------------- Vorschläge
async function suggestions(body) {
  const list = await GET("/suggestions");
  const circ = await GET("/suggestions/circles");
  body.append(card("Werte aus Importen und Google", list.length ? list.map((s) => h("div.row", { style: { borderBottom: "1px solid var(--line)", padding: "6px 0" } },
    h("a", { href: "#/p/" + s.entity_id }, s.entity_name), h("span.grow.small", h("b", s.field_name || (s.kind === "name" ? "Name" : s.kind)), ": ", typeof s.payload.value === "object" ? JSON.stringify(s.payload.value) : String(s.payload.value), h("span.t3", ` · ${s.payload.why || ""} · ${s.source}`)),
    h("button.btn.sm", { on: { click: async (e) => { await POST(`/suggestions/${s.id}/accept`); invalidate(); e.target.closest(".row").remove(); } } }, "Übernehmen"),
    h("button.btn.sm.ghost", { on: { click: async (e) => { await POST(`/suggestions/${s.id}/reject`); e.target.closest(".row").remove(); } } }, "Ablehnen"))) : h("div.t3", "Keine offenen Vorschläge.")),
  card("Neue Kreise", circ.length ? circ.map((sg) => h("div.row", { style: { borderBottom: "1px solid var(--line)", padding: "6px 0" } },
    h("div.grow", h("b", sg.name), " – ", sg.member_names.join(", "), h("div.small.t3", sg.reason)),
    h("button.btn.sm", { on: { click: async (e) => { const n = await promptDlg("Kreis anlegen", "Name", sg.name); if (!n) return; await POST("/suggestions/circles/accept", { ...sg, name: n }); await reloadCircles(); invalidate(); e.target.closest(".row").remove(); } } }, "Anlegen"),
    h("button.btn.sm.ghost", { on: { click: async (e) => { await POST("/suggestions/circles/dismiss", sg); e.target.closest(".row").remove(); } } }, "Nein"))) : h("div.t3", "Keine Vorschläge. Vorschläge sind nie verpflichtend.")));
}

// ---------------------------------------------------------------- Module, Konto, Admin
async function modules(body) {
  body.append(card("Module",
    h("label.check", h("input", { type: "checkbox", checked: S.settings.notes_enabled, on: { change: async (e) => { await saveSettings({ notes_enabled: e.target.checked }); location.reload(); } } }), h("b", "Notizen"), h("span.t2.small", "– datierte Notizen, in denen Namen automatisch erkannt werden")),
    h("div.small.t2", "Importer schaltest du unter ", h("a", { href: "#/settings/importers" }, "Importe"), " ein. Global ausgeschaltete Importer stehen dort nicht zur Verfügung (Admin)."),
    h("div.small.t2", "Doppelte: ", h("a", { href: "#/v/" + (S.views.find((v) => v.view === "duplicates")?.id || "") }, "Empfindlichkeit in „Mögliche Doppelte“"))),
    card("Daten",
      h("p.small.t2", "Die API ist komplett offen: alles, was die Oberfläche kann, geht auch über die API."),
      h("div.row", h("a.btn.sm", { href: "/api/docs", target: "_blank" }, icon("ext"), "API-Dokumentation"),
        h("button.btn.sm", { on: { click: async () => download("syn-export.json", JSON.stringify({ entities: await GET("/entities"), circles: await GET("/circles"), bunds: await GET("/bunds"), fields: await GET("/fields"), routines: await GET("/routines") }, null, 2)) } }, icon("download"), "Alles als JSON exportieren"))));
}

async function account(body) {
  const toks = await GET("/tokens");
  const ses = await GET("/sessions");
  const dn = h("input.input", { value: S.me.display_name });
  const o = h("input.input", { type: "password", placeholder: "Altes Passwort" }), n = h("input.input", { type: "password", placeholder: "Neues Passwort (mind. 8 Zeichen)" });
  const tn = h("input.input", { placeholder: "Name, z.B. n8n, Home Assistant, Türschild" }), tro = h("input", { type: "checkbox" });
  body.append(card("Darstellung", h("div.seg", [["system", "Wie das System"], ["light", "Hell"], ["dark", "Dunkel"]].map(([k, l]) =>
      h("button" + (themePref() === k ? ".on" : ""), { on: { click: () => setTheme(k) } }, l))), h("p.small.t3", "Gilt für dieses Gerät.")),
    card("Profil", h("div.row", dn, h("button.btn.sm", { on: { click: () => saveSettings({ display_name: dn.value }) } }, "Speichern"))),
    card("Passwort", h("div.row.wrap", o, n, h("button.btn.sm", { on: { click: async () => { await POST("/me/password", { old: o.value, new: n.value }); o.value = n.value = ""; toast("Passwort geändert"); } } }, "Ändern"))),
    card("Long-lived Access Tokens",
      h("p.small.t3", "Für Skripte, n8n, Home Assistant und CardDAV. Jedes Token sieht nur deine Daten. Ein Token kann auf Lesen beschränkt sein."),
      h("div.row.wrap", tn, h("label.check", tro, "nur lesen"), h("button.btn.sm.primary", { on: { click: async () => {
        const r = await POST("/tokens", { name: tn.value || "Token", read_only: tro.checked });
        await modal("Token erstellt", h("div.col", h("p", "Kopiere das Token jetzt – es wird nur einmal angezeigt."), h("div.code", r.token), h("button.btn.sm", { on: { click: () => { navigator.clipboard?.writeText(r.token); toast("Kopiert"); } } }, icon("copy"), "Kopieren")), [{ label: "Fertig", primary: true }]);
        reloadTab(body, account); } } }, icon("key"), "Erstellen")),
      h("table.mtable", h("tr", h("th", "Name"), h("th", "Token"), h("th", "Rechte"), h("th", "Erstellt"), h("th", "Zuletzt benutzt"), h("th")),
        toks.map((t) => h("tr" + (t.revoked_at ? ".t3" : ""), h("td", t.name), h("td.mono", t.prefix + "…"), h("td", t.read_only ? "lesen" : "lesen & schreiben"), h("td.mono", (t.created_at || "").slice(0, 10)), h("td", t.last_used_at ? rel(t.last_used_at.slice(0, 10)) : "nie"),
          h("td", t.revoked_at ? "widerrufen" : h("button.btn.sm", { on: { click: async () => { await DEL("/tokens/" + t.id); reloadTab(body, account); } } }, "Widerrufen")))))),
    card("Angemeldete Geräte", ses.map((s) => h("div.small", h("span.mono", (s.created_at || "").slice(0, 16)), " · ", s.agent?.slice(0, 80), " · läuft ab ", (s.expires_at || "").slice(0, 16))),
      h("button.btn.sm", { style: { alignSelf: "flex-start" }, on: { click: async () => { await POST("/auth/logout"); location.hash = "#/login"; } } }, icon("logout"), "Abmelden")));
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
  body.append(h("p.small.t2", "Alle Tastenkürzel lassen sich ändern. Einfache Tasten (ohne Strg/⌘/Alt) wirken nicht, während du in ein Feld tippst."),
    ...Object.entries(groups).map(([g, list]) => card(g, h("table.mtable", list.map(([id, , label, def]) => {
      const cur = binding(id);
      return h("tr", h("td", label), h("td", h("span.kbd.big", pretty(cur))), h("td.small.t3", cur !== def ? `Standard: ${pretty(def)}` : "Standard"),
        h("td.row", { style: { justifyContent: "flex-end" } },
          h("button.btn.sm", { on: { click: async () => { const c = await recordCombo(); if (c) { await saveBinding(id, c); reloadTab(body, shortcuts); } } } }, "Ändern"),
          h("button.btn.sm.ghost", { on: { click: async () => { await saveBinding(id, ""); reloadTab(body, shortcuts); } } }, "Aus"),
          cur !== def ? h("button.btn.sm.ghost", { on: { click: async () => { await saveBinding(id, null); reloadTab(body, shortcuts); } } }, "Zurücksetzen") : null));
    })))),
    h("button.btn", { style: { alignSelf: "flex-start" }, on: { click: async () => { await saveSettings({ shortcuts: {} }); reloadTab(body, shortcuts); } } }, icon("refresh"), "Alle auf Standard"));
}
