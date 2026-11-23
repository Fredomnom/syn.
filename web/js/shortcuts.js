// Tastenkürzel: alle Aktionen mit Standardbelegung, frei änderbar (gespeichert in den Nutzer-Einstellungen).
// Schreibweise: „Mod+B“ – Mod ist ⌘ auf dem Mac und Strg sonst. Weitere: Shift, Alt, Ctrl, Meta.
import { S, PATCH, h, modal, toast } from "./core.js";

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

export const ACTIONS = [
  // [id, Bereich, Beschreibung, Standard]
  ["undo", "Allgemein", "Rückgängig", "Mod+Z"],
  ["redo", "Allgemein", "Wiederholen", "Mod+Shift+Z"],
  ["toggle_sidebar", "Allgemein", "Seitenleiste ein-/ausklappen", "Mod+B"],
  ["search", "Allgemein", "Suchen", "Mod+K"],
  ["new_person", "Allgemein", "Neue Person", "N"],
  ["help", "Allgemein", "Tastenkürzel anzeigen", "Shift+?"],
  ["go_people", "Navigation", "Personen", "Alt+1"],
  ["go_circles", "Navigation", "Kreise", "Alt+2"],
  ["go_today", "Navigation", "Heute", "Alt+3"],
  ["go_notes", "Navigation", "Notizen", "Alt+4"],
  ["go_settings", "Navigation", "Einstellungen", "Mod+,"],
  ["view_grid", "Ansichten", "Grid", "1"],
  ["view_list", "Ansichten", "Liste", "2"],
  ["view_table", "Ansichten", "Tabelle", "3"],
  ["view_rings", "Ansichten", "Ringe", "4"],
  ["view_axes", "Ansichten", "Achsen", "5"],
  ["view_net", "Ansichten", "Netz", "6"],
  ["save_view", "Ansichten", "Ansicht speichern", "Mod+S"],
  ["seen_today", "Personenseite", "Heute gesehen", "H"],
  ["edit_person", "Personenseite", "Bearbeiten", "E"],
  ["add_field", "Personenseite", "Feld hinzufügen", "F"],
  ["ring_1", "Personenseite", "Ring 1 (Engste)", "1"],
  ["ring_2", "Personenseite", "Ring 2 (Nah)", "2"],
  ["ring_3", "Personenseite", "Ring 3 (Mittel)", "3"],
  ["ring_4", "Personenseite", "Ring 4 (Weit)", "4"],
  ["ring_0", "Personenseite", "Ohne Ring", "0"],
  ["add_bund", "Personenseite", "Bund hinzufügen", "B"],
  ["add_circle", "Personenseite", "Zu Kreis hinzufügen", "K"],
  ["edit_ihr", "Personenseite", "„Ihr zwei“ bearbeiten", "I"],
  ["new_note", "Personenseite", "Notiz schreiben", "O"],
  ["call", "Personenseite", "Anrufen", "A"],
  ["mail", "Personenseite", "Schreiben (E-Mail)", "S"],
  ["update_link", "Personenseite", "Angaben prüfen lassen / Freundebuch", "L"],
  ["merge_with", "Personenseite", "Zusammenführen mit …", "M"],
  ["toggle_phone", "Personenseite", "Mit Handy synchronisieren an/aus", "Y"],
  ["ring_center", "Personenseite", "In den Ringen in die Mitte", "G"],
  ["prev_person", "Personenseite", "Vorige Person", "Left"],
  ["next_person", "Personenseite", "Nächste Person", "Right"],
  ["back_list", "Personenseite", "Zurück zur Liste", "Esc"],
  ["delete_person", "Personenseite", "Person löschen", "Shift+Delete"],
  ["fill_down", "Tabelle", "Nach unten füllen", "Mod+D"],
  ["open_row", "Tabelle", "Person öffnen", "Mod+O"],
  ["select_all", "Tabelle", "Alles markieren", "Mod+A"],
];

export const binding = (id) => (S.settings.shortcuts || {})[id] ?? ACTIONS.find((a) => a[0] === id)?.[3] ?? "";

const KEYNAME = { " ": "Space", Escape: "Esc", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };
export function comboOf(e) {
  const parts = [];
  const mod = IS_MAC ? e.metaKey : e.ctrlKey;
  if (mod) parts.push("Mod");
  if (IS_MAC && e.ctrlKey) parts.push("Ctrl");
  if (!IS_MAC && e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  let k = KEYNAME[e.key] || e.key;
  if (e.altKey && e.code?.startsWith("Digit")) k = e.code.slice(5);
  if (e.altKey && e.code?.startsWith("Key")) k = e.code.slice(3);
  if (k.length === 1) k = k.toUpperCase();
  if (e.shiftKey && (k.length > 1 || /[A-Z0-9]/.test(k))) parts.push("Shift");
  else if (e.shiftKey && k === "?") parts.push("Shift");
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return parts.join("+");
  parts.push(k);
  return parts.join("+");
}
const norm = (c) => (c || "").split("+").map((p) => (p.length === 1 ? p.toUpperCase() : p)).join("+");
export const matches = (e, id) => { const b = binding(id); return !!b && norm(comboOf(e)) === norm(b); };
export const pretty = (c) => (c || "–").split("+").map((p) => (p === "Mod" ? (IS_MAC ? "⌘" : "Strg") : p === "Alt" ? (IS_MAC ? "⌥" : "Alt") : p === "Shift" ? (IS_MAC ? "⇧" : "Shift") : p)).join(IS_MAC ? "" : "+");

export const typing = (e) => {
  const t = e.target;
  return t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest?.("syn-date"));
};

// Handler pro Seite (werden bei jedem Seitenwechsel zurückgesetzt) und global
const page = new Map();
const global = new Map();
export const onPage = (id, fn) => page.set(id, fn);
export const onGlobal = (id, fn) => global.set(id, fn);
export const resetPage = () => page.clear();

document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || document.querySelector(".backdrop:not(.leaving)")) return;
  const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  for (const map of [page, global]) {
    for (const [id, fn] of map) {
      if (!matches(e, id)) continue;
      if (plain && typing(e)) continue; // einfache Tasten nicht beim Tippen
      if ((id === "undo" || id === "redo") && typing(e)) continue; // im Textfeld gilt das Rückgängig des Browsers
      e.preventDefault(); fn(e); return;
    }
  }
});

export async function saveBinding(id, combo) {
  const sc = { ...(S.settings.shortcuts || {}) };
  if (combo === null) delete sc[id]; else sc[id] = combo;
  const clash = combo && ACTIONS.find((a) => a[0] !== id && norm(binding(a[0])) === norm(combo));
  S.settings = await PATCH("/me/settings", { shortcuts: sc });
  S.me.settings = S.settings;
  if (clash) toast(`Achtung: ${pretty(combo)} ist auch „${clash[2]}“ zugeordnet`);
}

export function recordCombo() {
  return new Promise((resolve) => {
    const box = h("div.kbd-rec", "Tastenkombination drücken …");
    const key = (e) => {
      if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { done(null); return; }
      done(comboOf(e));
    };
    const done = (v) => { document.removeEventListener("keydown", key, true); document.querySelector(".backdrop:not(.leaving)")?._close?.(v); };
    document.addEventListener("keydown", key, true);
    modal("Neues Tastenkürzel", h("div.col", box, h("p.small.t3", "Esc bricht ab.")), []).then((v) => { document.removeEventListener("keydown", key, true); resolve(v); });
  });
}

// ---------------------------------------------------------------- Shift+? : kurz = Kürzel an den Knöpfen, halten = Liste
// Welche Kürzel an welchen Knöpfen stehen (sichtbare Elemente bekommen ein kleines Tastenschild)
const SPOTS = [
  ["toggle_sidebar", ".side .top .btn.icon"], ["new_person", ".page-h .btn.primary.np-btn"],
  ["go_people", 'a.nav[href="#/people"]'], ["go_circles", 'a.nav[href="#/circles"]'], ["go_today", 'a.nav[href="#/today"]'], ["go_notes", 'a.nav[href="#/notes"]'],
  ["go_settings", 'a.nav[href^="#/settings"]'], ["save_view", ".sv-btn"],
  ["view_grid", '[data-sc="view_grid"]'], ["view_list", '[data-sc="view_list"]'], ["view_table", '[data-sc="view_table"]'],
  ["view_rings", '[data-sc="view_rings"]'], ["view_axes", '[data-sc="view_axes"]'], ["view_net", '[data-sc="view_net"]'],
  ["seen_today", ".guide-seen"], ["call", '.phead a.btn[href^="tel:"]'], ["mail", '.phead a.btn[href^="mailto:"]'],
  ["add_bund", ".card.bw .card-h .btn"], ["add_circle", ".guide-circle"], ["edit_ihr", ".iz-kind"],
  ["ring_1", ".iz-ring", "1–4 · 0"],
];
let hintsOn = false, hintObs = null, hintPill = null;
function paintHints() {
  document.querySelectorAll(".sc-badge").forEach((b) => b.remove());
  if (!hintsOn) return;
  for (const [id, sel, text] of SPOTS) {
    const combo = text || binding(id); if (!combo) continue;
    for (const el of document.querySelectorAll(sel)) {
      if (!el.offsetParent || el.closest(".backdrop")) continue;
      el.classList.add("sc-host");
      const b = text ? h("span.sc-badge", h("span.key", text)) : h("span.sc-badge", keys(combo));
      el.append(b);
    }
  }
}
export function setHints(on) {
  hintsOn = on;
  document.body.classList.toggle("sc-hints", on);
  hintObs?.disconnect(); hintObs = null;
  hintPill?.remove(); hintPill = null;
  if (on) {
    let t = 0;
    hintObs = new MutationObserver((m) => { if (m.every((x) => [...x.addedNodes, ...x.removedNodes].every((n) => n.classList?.contains("sc-badge")))) return; clearTimeout(t); t = setTimeout(paintHints, 60); });
    hintObs.observe(document.body, { childList: true, subtree: true });
    hintPill = h("div.sc-pill", h("b", "Tastenkürzel eingeblendet"), h("span", keys(binding("help")), " nochmal: ausblenden"), h("span", keys(binding("help")), " gedrückt halten: alle Kürzel"), h("span", keys("Esc"), " schließen"));
    document.body.append(hintPill);
  }
  paintHints();
}
document.addEventListener("keydown", (e) => { if (hintsOn && e.key === "Escape" && !document.querySelector(".backdrop:not(.leaving), .pop")) { e.preventDefault(); e.stopPropagation(); setHints(false); } }, true);

let holdT = null;
export function helpKey(e) {
  if (e.repeat || holdT) return;
  let holdPill = null;
  const pillT = setTimeout(() => { holdPill = h("div.sc-pill.hold", h("span", "Gedrückt halten …"), h("span.sc-bar")); document.body.append(holdPill); }, 120);
  holdT = setTimeout(() => { holdT = "fired"; clearTimeout(pillT); holdPill?.remove(); setHints(false); helpOverlay(); }, 550);
  const up = () => {
    document.removeEventListener("keyup", up, true);
    clearTimeout(pillT); holdPill?.remove();
    if (holdT !== "fired") { clearTimeout(holdT); setHints(!hintsOn); }
    holdT = null;
  };
  document.addEventListener("keyup", up, true);
}

// Übersicht: nach Bereichen in Spalten, „Hier“ zuerst, mit Suche
export function helpOverlay() {
  const here = location.hash.startsWith("#/p/") ? "Personenseite" : /^#\/(people|v)\b/.test(location.hash) || location.hash === "" ? "Ansichten" : null;
  const groups = {};
  for (const [id, g, label] of ACTIONS) (groups[g] ||= []).push([id, label]);
  const order = Object.keys(groups).sort((a, b) => (b === here) - (a === here));
  const q = h("input.input.sc-q", { placeholder: "Kürzel suchen …", autocomplete: "off" });
  const grid = h("div.sc-grid");
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    grid.replaceChildren(...order.map((g) => {
      const list = groups[g].filter(([id, label]) => !f || label.toLowerCase().includes(f) || g.toLowerCase().includes(f) || pretty(binding(id)).toLowerCase().includes(f));
      if (!list.length) return null;
      return h("section.sc-group" + (g === here ? ".here" : ""), h("h3", g, g === here ? h("span.tag.yellow", "hier") : null),
        h("div.sc-rows", list.map(([id, label]) => h("div.sc-row", h("span.sc-l", label), keys(binding(id))))));
    }).filter(Boolean));
  };
  q.addEventListener("input", draw); draw();
  setTimeout(() => q.focus(), 30);
  modal("Tastenkürzel", h("div.col", { style: { gap: "12px" } }, h("div.row", { style: { gap: "10px" } }, q,
      h("span.small.t3", "Kurz ", keys(binding("help")), " zeigt die Kürzel direkt an den Knöpfen")), grid,
    h("a.small", { href: "#/settings/shortcuts", on: { click: () => document.querySelector(".backdrop:not(.leaving)")?._close?.(null) } }, "Tastenkürzel ändern →")), [], { wide: true });
}

// ---------------------------------------------------------------- Tastenkappen: einheitliche Darstellung aller Tasten
const KEY_SVG = {
  cmd: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
  shift: '<path d="M12 4 4 12h4v8h8v-8h4z"/>',
  opt: '<path d="M3 6h5l8 12h5M14 6h7"/>',
  ctrl: '<path d="m6 14 6-6 6 6"/>',
  enter: '<path d="M20 5v7a3 3 0 0 1-3 3H5"/><path d="m9 11-4 4 4 4"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>', down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  left: '<path d="M19 12H5M11 6l-6 6 6 6"/>', right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
};
const NAMES = { Mod: IS_MAC ? "cmd" : "Strg", Ctrl: IS_MAC ? "ctrl" : "Strg", Meta: IS_MAC ? "cmd" : "Win", Alt: IS_MAC ? "opt" : "Alt", Shift: IS_MAC ? "shift" : "Shift",
  Enter: "enter", Up: "up", Down: "down", Left: "left", Right: "right", Esc: "Esc", Space: "Leertaste", Delete: IS_MAC ? "⌦" : "Entf", Backspace: IS_MAC ? "⌫" : "Rück", "↑": "up", "↓": "down", "←": "left", "→": "right" };
export function keycap(k) {
  const n = NAMES[k] ?? k;
  const el = document.createElement("span"); el.className = "key";
  if (KEY_SVG[n]) { el.innerHTML = `<svg viewBox="0 0 24 24">${KEY_SVG[n]}</svg>`; el.title = ""; el.setAttribute("aria-label", k); }
  else el.textContent = n.length === 1 ? n.toUpperCase() : n;
  return el;
}
// „Mod+Shift+Z“ → einzelne Tastenkappen; auch „↑↓“ oder „1–3“
export function keys(combo) {
  const box = document.createElement("span"); box.className = "keys";
  if (!combo) { box.append(Object.assign(document.createElement("span"), { className: "key off", textContent: "aus" })); return box; }
  const parts = combo === "↑↓" ? ["↑", "↓"] : combo.split("+").filter((x, i, a) => x || a[i - 1] === "");
  for (const p of parts) box.append(keycap(p || "+"));
  return box;
}
