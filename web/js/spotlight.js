// Spotlight-Suche (Strg/⌘+K): Personen, Kreise, Ansichten & Seiten, gespeicherte Ansichten, Bünde.
import { S, h, icon, GET, clear, rows, avatar, circleChip, circleColors } from "./core.js";
import { binding, pretty, keys } from "./shortcuts.js";

const fold = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const RECENT = "syn.recent";
export function rememberPerson(id) {
  try { const r = JSON.parse(localStorage.getItem(RECENT) || "[]").filter((x) => x !== id); r.unshift(id); localStorage.setItem(RECENT, JSON.stringify(r.slice(0, 8))); } catch (_) {}
}
const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch (_) { return []; } };

// Treffer-Güte: Anfang > Wortanfang > enthalten; 0 = kein Treffer
function score(q, ...texts) {
  let best = 0;
  for (const t of texts) {
    if (!t) continue;
    const f = fold(t);
    if (f === q) best = Math.max(best, 100);
    else if (f.startsWith(q)) best = Math.max(best, 80);
    else if (f.includes(" " + q) || f.includes("-" + q)) best = Math.max(best, 60);
    else if (f.includes(q)) best = Math.max(best, 40);
  }
  return best;
}

const PAGES = [
  ["Personen · Grid", "#/people/grid", "grid"], ["Personen · Liste", "#/people/list", "list"], ["Personen · Tabelle", "#/people/table", "table"],
  ["Personen · Ringe", "#/people/rings", "rings"], ["Personen · Achsen", "#/people/axes", "axes"], ["Personen · Netz", "#/people/net", "net"],
  ["Kreise", "#/circles", "circles"], ["Kreise · Bereiche", "#/circles/areas", "layers"], ["Heute", "#/today", "bell"], ["Notizen", "#/notes", "note"],
  ["Mögliche Doppelte", null, "merge"],
  ["Einstellungen · Felder", "#/settings/fields", "settings"], ["Einstellungen · Kreis-Arten", "#/settings/circle-kinds", "settings"],
  ["Einstellungen · Bund-Arten", "#/settings/bund-kinds", "settings"], ["Einstellungen · Ringe & Ist", "#/settings/rings", "rings"],
  ["Einstellungen · Routinen", "#/settings/routines", "zap"], ["Einstellungen · Importe", "#/settings/importers", "download"],
  ["Einstellungen · Handy & Sync", "#/settings/sync", "smartphone"], ["Einstellungen · Vorschläge", "#/settings/suggestions", "zap"],
  ["Einstellungen · Tastenkürzel", "#/settings/shortcuts", "key"], ["Einstellungen · Konto", "#/settings/account", "user"], ["Einstellungen · Darstellung", "#/settings/appearance", "sun"], ["Einstellungen · API-Tokens", "#/settings/tokens", "link"], ["Einstellungen · Module & Daten", "#/settings/modules", "layers"],
  ["Mein Profil", null, "user"], ["API-Dokumentation", "#/api", "link"],
];

let open = null;
export async function openSpotlight() {
  if (open) { open.input.focus(); open.input.select(); return; }
  const input = h("input.spot-input", { placeholder: "Personen, Kreise, Ansichten, Bünde suchen …", autocomplete: "off", spellcheck: false });
  const list = h("div.spot-list");
  const panel = h("div.spot", h("div.spot-head", icon("search"), input, keys("Esc")), list,
    h("div.spot-foot", h("span.row", keys("↑↓"), " auswählen"), h("span.row", keys("Enter"), " öffnen"), h("span.row", keys("Shift"), " + Klick: mehrere wählen"), h("span.grow"), h("span.row", keys(binding("search")), " öffnet die Suche")));
  const bd = h("div.spot-bd", { on: { mousedown: (e) => { if (e.target === bd) close(); } } }, panel);
  document.body.append(bd);
  open = { input };
  setTimeout(() => input.focus(), 10);

  const [all, bunds] = await Promise.all([rows(), GET("/bunds").catch(() => [])]);
  // Mehrfachauswahl (⇧/⌘/Strg + Klick oder ⇧+Enter) zum direkten Zusammenführen – bleibt beim Weitersuchen bestehen
  const sel = [];
  const selBar = h("div.spot-sel");
  panel.insertBefore(selBar, list);
  const drawSel = () => {
    selBar.hidden = !sel.length; panel.classList.toggle("selecting", sel.length > 0);
    clear(selBar, sel.length ? [
      h("div.spot-sel-list", sel.map((id) => { const r = byId[id]; return h("span.spot-sel-chip", avatar(r, 20, { exact: true }), h("span", r.display || r.name || "Ohne Namen"),
        h("button", { title: "Abwählen", on: { click: (e) => { e.stopPropagation(); toggle(id); } } }, icon("x", "xs"))); })),
      h("div.row", { style: { gap: "6px" } },
        h("button.btn.sm.ghost", { on: { click: () => { sel.length = 0; drawSel(); build(); input.focus(); } } }, "Leeren"),
        h("button.btn.sm.primary", { disabled: sel.length < 2, on: { click: mergeSel } }, icon("merge"), sel.length < 2 ? "Noch eine Person wählen" : `${sel.length} zusammenführen`)),
    ] : []);
  };
  const toggle = (id) => { const i = sel.indexOf(id); i >= 0 ? sel.splice(i, 1) : sel.push(id); drawSel(); build(); input.focus(); };
  function mergeSel() {
    if (sel.length < 2) return;
    close(); location.hash = sel.length === 2 ? `#/merge/${sel[0]}/${sel[1]}` : `#/merge/${sel.join(",")}`;
  }
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const kindName = (id) => S.bundKinds.find((k) => k.id === id)?.name || "Bund";
  let items = [], active = 0;

  const build = () => {
    const q = fold(input.value.trim());
    const groups = [];
    const add = (title, arr, max) => { if (arr.length) groups.push([title, arr.slice(0, max)]); };
    if (!q) {
      add("Zuletzt geöffnet", recent().map((id) => byId[id]).filter(Boolean).map((r) => person(r)), 6);
      add("Springen zu", PAGES.slice(0, 10).map(page), 10);
    } else {
      const people = all.filter((r) => !r.is_self).map((r) => [score(q, r.name, r.description, ...(r.aliases || [])) || (score(q, r.v.f_phone?.d, r.v.f_email?.d, r.v.f_city?.d) && 20), r])
        .filter(([s]) => s).sort((a, b) => b[0] - a[0] || a[1].display.localeCompare(b[1].display)).map(([, r]) => person(r));
      const circles = Object.values(S.circles).map((c) => [score(q, c.name, circleColors(c.id).kind), c]).filter(([s]) => s).sort((a, b) => b[0] - a[0]).map(([, c]) => ({
        el: h("div.spot-item", circleChip(c.id), h("span.grow"), h("span.t3.small", `${c.count ?? ""} Mitglieder`)), go: "#/c/" + c.id }));
      const views = S.views.map((v) => [score(q, v.name), v]).filter(([s]) => s).map(([, v]) => ({
        el: h("div.spot-item", h("span.spot-ic", icon("layers")), h("span.grow", v.name), h("span.t3.small", "Gespeicherte Ansicht")), go: "#/v/" + v.id }));
      const pages = PAGES.map((p) => [score(q, p[0]), p]).filter(([s]) => s).sort((a, b) => b[0] - a[0]).map(([, p]) => page(p));
      const bs = bunds.map((b) => {
        const A = byId[b.a_id], B = byId[b.b_id]; if (!A || !B) return null;
        if ((A.is_self || B.is_self) && !b.kind_id) return null; // leeres „Ihr zwei“ ist kein Bund
        const s = score(q, A.is_self ? "" : A.display, B.is_self ? "" : B.display, b.kind_id ? kindName(b.kind_id) : "", b.role_a, b.role_b);
        return s ? [s, b, A, B] : null;
      }).filter(Boolean).sort((a, b) => b[0] - a[0]).map(([, b, A, B]) => {
        const other = A.is_self ? B : A;
        return { el: h("div.spot-item", h("span.spot-pair", avatar(A, 26, { exact: true, self: A.is_self }), avatar(B, 26, { exact: true, self: B.is_self })),
          h("span.grow", `${A.is_self ? "Du" : A.display} & ${B.is_self ? "Du" : B.display}`), h("span.t3.small", kindName(b.kind_id))), go: "#/p/" + other.id };
      });
      add("Personen", people, 8); add("Kreise", circles, 5); add("Gespeicherte Ansichten", views, 5); add("Ansichten & Seiten", pages, 6); add("Bünde", bs, 5);
    }
    items = groups.flatMap(([, arr]) => arr);
    active = Math.min(active, Math.max(0, items.length - 1));
    clear(list, groups.length ? groups.map(([title, arr]) => h("div.spot-group", h("div.spot-title", title), arr.map((it) => it.el)))
      : h("div.spot-empty", "Nichts gefunden"));
    items.forEach((it, i) => {
      it.el.classList.toggle("act", i === active);
      it.el.addEventListener("mousemove", () => { if (active !== i) { active = i; mark(); } });
      it.el.addEventListener("click", (e) => { if (it.pid && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.preventDefault(); toggle(it.pid); } else go(it); });
      if (it.pid) it.el.addEventListener("mousedown", (e) => { if (e.shiftKey) e.preventDefault(); }); // kein Text markieren
    });
  };
  const person = (r) => ({
    pid: r.id,
    el: h("div.spot-item" + (sel.includes(r.id) ? ".picked" : ""), h("span.spot-check", icon("check", "xs")), avatar(r, 30, { exact: true }), h("div.grow", h("div", r.name || r.description || "Ohne Namen", r.name_uncertain ? " ?" : ""),
      r.aliases?.length ? h("div.tiny.t3", "auch: " + r.aliases.slice(0, 2).join(", ")) : null),
      r.main_circle_id ? circleChip(r.main_circle_id) : h("span.chip", "Lose")),
    go: "#/p/" + r.id,
  });
  function page(p) {
    const href = p[1] || (p[0] === "Mein Profil" ? "#/p/" + S.me.self_id : "#/v/" + (S.views.find((v) => v.view === "duplicates")?.id || ""));
    return { el: h("div.spot-item", h("span.spot-ic", icon(p[2])), h("span.grow", p[0])), go: href };
  }
  const mark = () => items.forEach((it, i) => it.el.classList.toggle("act", i === active));
  const go = (it) => { close(); location.hash = it.go; };
  function close() { bd.classList.add("leaving"); setTimeout(() => bd.remove(), 120); open = null; }
  input.addEventListener("input", () => { active = 0; build(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(items.length - 1, active + 1); mark(); items[active]?.el.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); mark(); items[active]?.el.scrollIntoView({ block: "nearest" }); }
    else if (e.key === "Enter" && (e.shiftKey || e.metaKey || e.ctrlKey) && items[active]?.pid) { e.preventDefault(); toggle(items[active].pid); }
    else if (e.key === "Enter") { e.preventDefault(); if (items[active]) go(items[active]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  });
  drawSel();
  build();
}
