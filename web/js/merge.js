// Zusammenführen und „Mögliche Doppelte“.
import { S, h, icon, GET, POST, PATCH, clear, invalidate, avatar, circleChip, nameEl, rel, ringName, toast, isMobile } from "./core.js";
import { plain, SOURCE } from "./fields.js";

const ATTR = { name: "Name", description: "Beschreibung", kind: "Art", avatar: "Profilbild", main_circle_id: "Hauptkreis", name_uncertain: "Name unsicher" };

export async function mergePage(main, a, b) {
  if (a && a.includes(",")) return multiMergePage(main, a.split(",").filter(Boolean)); // mehrere (aus der Suche)
  const page = h("div.page"); main.append(page);
  const plan = await GET(`/merge/preview?a=${a}&b=${b}`);
  const choices = {};
  const showAttr = (k, v) => k === "main_circle_id" ? (v ? circleChip(v) : "–") : k === "avatar" ? (v ? h("img", { src: v, style: { width: "32px", height: "32px", borderRadius: "50%" } }) : "–") : k === "kind" ? (v === "pet" ? "Haustier" : "Mensch") : k === "name_uncertain" ? (v ? "ja" : "nein") : v ?? "–";
  const showVals = (f, vals) => vals?.length ? h("div.col", { style: { gap: "2px" } }, vals.map((v) => h("div", h("span" + (v.uncertain ? ".unsure-val" : ""), plain(S.fields[f.field] || { type: f.type }, v.value)), v.label ? h("span.t3", ` · ${v.label}`) : null, v.deprecated ? h("span.t3", " (veraltet)") : null, h("span.tiny.t3", " " + SOURCE(v.source))))) : h("span.t3", "–");
  const tbody = h("tbody");
  const draw = () => {
    clear(tbody);
    for (const at of plan.attrs) {
      const ch = choices[at.attr] || at.auto || "a";
      tbody.append(h("tr", h("td", h("b", ATTR[at.attr] || at.attr)),
        h("td", h("div.pick" + (ch === "a" ? ".on" : ""), { on: { click: () => { choices[at.attr] = "a"; draw(); } } }, showAttr(at.attr, at.a))),
        h("td", h("div.pick" + (ch === "b" ? ".on" : ""), { on: { click: () => { choices[at.attr] = "b"; draw(); } } }, showAttr(at.attr, at.b))),
        h("td.small.t2", at.auto && !choices[at.attr] ? "syn: " + (at.attr === "name" ? "sicherer Name gewinnt" : "nur einer hat einen Wert") : "")));
    }
    for (const f of plan.fields) {
      const def = S.fields[f.field];
      const keepAll = (f.multi ?? def?.multi) && f.a.length && f.b.length; // Mehrfachfeld: alle Werte bleiben, keine Wahl
      const ch = keepAll ? "both" : choices[f.field] || f.auto || "a";
      const pick = (side) => keepAll ? {} : { on: { click: () => { choices[f.field] = side; draw(); } } };
      tbody.append(h("tr", h("td", h("b", f.name), h("div.tiny.t3.mono", f.field), f.owner === "bund" ? h("div.tiny.t3", "Ihr zwei") : null),
        h("td", h("div.pick" + (ch === "a" || ch === "both" || ch === "sum" ? ".on" : "") + (keepAll ? ".fixed" : ""), pick("a"), showVals(f, f.a))),
        h("td", h("div.pick" + (ch === "b" || ch === "both" || ch === "sum" ? ".on" : "") + (keepAll ? ".fixed" : ""), pick("b"), showVals(f, f.b))),
        h("td.small.t2", keepAll ? h("div", "Alle Werte bleiben") : h("div", ch === "both" ? "beide Werte" : ch === "sum" ? "Summe" : ""),
          !keepAll && f.auto && !choices[f.field] ? h("div", "syn: " + f.why) : null)));
    }
  };
  draw();
  page.append(isMobile() ? null : h("a.crumb", { href: "#/people/table" }, icon("left"), "Tabelle"),
    h("div.page-h", h("h1", "Zusammenführen"), h("a.btn", { href: `#/merge/${b}/${a}` }, icon("refresh"), "Seiten tauschen"),
      h("button.btn.primary", { on: { click: async () => { const e = await POST("/merge", { keep: a, other: b, choices }); invalidate(); toast("Zusammengeführt"); location.hash = "#/p/" + e.id; } } }, icon("merge"), "Zusammenführen")),
    h("div.hint", h("div.grow", "Pro Feld wählst du den Wert. Manches entscheidet syn selbst: das neuere Datum gewinnt, Felder, die nur ein Eintrag hat, werden übernommen. ", h("b", "Kreise bleiben beide"), ", der Verlauf beider Einträge bleibt erhalten. Bleibt erhalten: ", h("b", plan.a.display), ".")),
    isMobile() ? h("div.merge-legend.small", h("span", "Links: ", h("b", plan.a.display), " (bleibt)"), h("span", "Rechts: ", h("b", plan.b.display))) : null,
    h("div.card", h("table.mtable.merge-t", h("thead", h("tr", h("th", "Feld"), h("th", h("a", { href: "#/p/" + a }, plan.a.display), " (bleibt)"), h("th", h("a", { href: "#/p/" + b }, plan.b.display)), h("th", ""))), tbody)),
    h("div.row", h("span.small.t2", "Kreise nach dem Zusammenführen:"), plan.circles.map((c) => circleChip(c))));
}

// Mehr als zwei auf einmal: eine Spalte je Person, pro Feld den Wert wählen; eine Spalte „bleibt“
export async function multiMergePage(main, ids) {
  const page = h("div.page"); main.append(page);
  const plan = await GET(`/merge/preview-multi?ids=${ids.join(",")}`);
  const P = plan.people, n = P.length;
  const choices = {};
  let keep = 0;
  const showAttr = (k, v) => k === "main_circle_id" ? (v ? circleChip(v) : "–") : k === "avatar" ? (v ? h("img", { src: v, style: { width: "32px", height: "32px", borderRadius: "50%" } }) : "–") : k === "kind" ? (v === "pet" ? "Haustier" : "Mensch") : v ?? "–";
  const showVals = (f, vals) => vals?.length ? h("div.col", { style: { gap: "2px" } }, vals.map((v) => h("div", h("span" + (v.uncertain ? ".unsure-val" : ""), plain(S.fields[f.field] || { type: f.type }, v.value)), v.label ? h("span.t3", ` · ${v.label}`) : null, h("span.tiny.t3", " " + SOURCE(v.source))))) : h("span.t3", "–");
  const thead = h("thead"), tbody = h("tbody");
  const draw = () => {
    clear(thead, h("tr", h("th", "Feld"), P.map((p, k) => h("th.mm-person" + (k === keep ? ".keep" : ""),
      h("a.row", { href: "#/p/" + p.id, style: { gap: "8px", textDecoration: "none", color: "inherit" } }, avatar(S.rowsById?.[p.id] || { display: p.display, name: p.display, avatar: p.avatar }, 28), h("b", p.display)),
      h("label.check.small", h("input", { type: "radio", name: "mm-keep", checked: k === keep, on: { change: () => { keep = k; draw(); } } }), k === keep ? "bleibt" : "soll bleiben")))));
    clear(tbody);
    for (const at of plan.attrs) {
      const ch = choices[at.attr] ?? (at.vals[keep] ? keep : at.auto); // ohne eigene Wahl: was der bleibende Eintrag hat
      tbody.append(h("tr", h("td", h("b", ATTR[at.attr] || at.attr)),
        at.vals.map((v, k) => h("td", v ? h("div.pick" + (ch === k ? ".on" : ""), { on: { click: () => { choices[at.attr] = k; draw(); } } }, showAttr(at.attr, v)) : h("span.t3", "–")))));
    }
    for (const f of plan.fields) {
      const all = f.auto === "all", sum = f.auto === "sum" && choices[f.field] == null;
      const ch = all ? "all" : choices[f.field] ?? f.auto ?? keep;
      tbody.append(h("tr", h("td", h("b", f.name), h("div.tiny.t3", all ? "alle Werte bleiben" : sum ? "Summe" : choices[f.field] == null && f.why ? "syn: " + f.why : ""), f.owner === "bund" ? h("div.tiny.t3", "Ihr zwei") : null),
        f.vals.map((vals, k) => h("td", vals.length ? h("div.pick" + (all || sum || ch === k ? ".on" : "") + (all ? ".fixed" : ""), all ? {} : { on: { click: () => { choices[f.field] = k; draw(); } } }, showVals(f, vals)) : h("span.t3", "–")))));
    }
  };
  draw();
  const go = h("button.btn.primary", { on: { click: async () => {
    // „bleibt“ nach vorn; gewählte Spalten auf die neue Reihenfolge umrechnen
    const order = [keep, ...P.map((_, k) => k).filter((k) => k !== keep)];
    const pos = Object.fromEntries(order.map((k, i) => [k, i]));
    const ch = {};
    for (const at of plan.attrs) { const c = choices[at.attr] ?? (at.vals[keep] ? keep : at.auto); if (c != null) ch[at.attr] = pos[c]; }
    for (const f of plan.fields) { const c = choices[f.field] ?? f.auto; if (c != null) ch[f.field] = typeof c === "number" ? pos[c] : c; }
    go.disabled = true;
    try { const e = await POST("/merge/multi", { ids: order.map((k) => P[k].id), choices: ch }); invalidate(); toast(`${n} Einträge zusammengeführt`); location.hash = "#/p/" + e.id; }
    catch (err) { go.disabled = false; toast(err.message || "Ging nicht"); }
  } } }, icon("merge"), `${n} zusammenführen`);
  page.append(isMobile() ? null : h("a.crumb", { href: "#/people/table" }, icon("left"), "Tabelle"),
    h("div.page-h", h("h1", `${n} Personen zusammenführen`), go),
    h("div.hint", h("div.grow", "Pro Feld wählst du, wessen Wert bleibt. Mehrfachfelder (Nummern, Profile …) behalten alle Werte. ", h("b", "Kreise und Bünde bleiben alle"), ", der Verlauf aller Einträge bleibt erhalten, die übrigen Namen werden Aliasse.")),
    h("div.card.mm-wrap", h("table.mtable.merge-t.mm-t", thead, tbody)));
}

export async function duplicatesPage(main, view) {
  const page = h("div.page"); main.append(page);
  const sens = S.settings.dup_sensitivity || "medium";
  const pairs = await GET("/duplicates");
  const card = (p) => {
    const one = (r) => h("a.col", { href: "#/p/" + r.id, style: { alignItems: "center", textDecoration: "none", flex: 1, gap: "4px" } }, avatar(r, 48), h("b", nameEl(r)),
      h("div.small.t2", r.main_circle_id ? S.circles[r.main_circle_id]?.name : "Lose"), h("div.small.t3", [r.v.f_phone?.d, r.v.f_email?.d, r.v.f_seen ? "gesehen " + rel(r.v.f_seen.raw) : null].filter(Boolean).join(" · ")));
    return h("div.card.pad.col", h("div.row", one(p.a_row), h("span.chip" + (p.level === 3 ? ".dark" : ".plain"), p.strength), one(p.b_row)),
      h("div.small", h("span.t2", "Gründe: "), p.reasons.join(", ")),
      h("div.row", h("a.btn.sm.dark", { href: `#/merge/${p.a}/${p.b}` }, icon("merge"), "Zusammenführen"),
        h("button.btn.sm", { on: { click: async (e) => { await POST("/duplicates/distinct", { a: p.a, b: p.b }); e.target.closest(".card").remove(); } } }, "Verschiedene Personen"),
        h("button.btn.sm.ghost", { on: { click: async (e) => { await POST("/duplicates/later", { a: p.a, b: p.b }); e.target.closest(".card").remove(); } } }, "Später")));
  };
  page.append(h("div.page-h", h("h1", view?.name || "Mögliche Doppelte"),
    h("span.small.t2", "Wie mutig syn vorschlägt:"),
    h("div.seg", [["strong", "nur starke"], ["medium", "stark und mittel"], ["all", "alle Hinweise"]].map(([k, l]) => h("button" + (sens === k ? ".on" : ""), { on: { click: async () => { S.settings = await PATCH("/me/settings", { dup_sensitivity: k }); clear(main); duplicatesPage(main, view); } } }, l)))),
    h("p.small.t2", "syn sammelt Hinweise und zeigt die Gründe – keine Prozentzahl. Gegenhinweise (verschiedene Nummern, gleichzeitig im selben Kreis, bestehender Bund) unterdrücken Vorschläge."),
    pairs.length ? h("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(420px,100%),1fr))", gap: "12px" } }, pairs.map(card)) : h("div.card.empty", "Keine möglichen Doppelten."));
}
