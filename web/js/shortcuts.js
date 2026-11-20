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

export function helpOverlay() {
  const groups = {};
  for (const [id, g, label] of ACTIONS) (groups[g] ||= []).push([id, label]);
  modal("Tastenkürzel", h("div.col", Object.entries(groups).map(([g, list]) => h("div.col", { style: { gap: "4px" } }, h("h3", g),
    list.map(([id, label]) => h("div.row.between", h("span", label), h("span.kbd", pretty(binding(id))))))),
  h("a.small", { href: "#/settings/shortcuts", on: { click: () => document.querySelector(".backdrop:not(.leaving)")?._close?.(null) } }, "Tastenkürzel ändern →")), []);
}
