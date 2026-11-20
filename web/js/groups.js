// Freie Gruppierung für Raster, Liste und Tabelle.
import { S, h, icon, circleChip, ringName } from "./core.js";
import { LOCALE } from "./i18n.js";
const LS = (k, d) => { try { return JSON.parse(localStorage.getItem("syn." + k)) ?? d; } catch (_) { return d; } };
const SAVE = (k, v) => { try { localStorage.setItem("syn." + k, JSON.stringify(v)); } catch (_) {} };

export const GROUPINGS = [
  ["", "Keine"],
  ["main_circle", "Hauptkreis"],
  ["circle_kind", "Kreis-Art"],
  ["level", "Ring", () => S.settings.use_levels],
  ["via", "Kennengelernt über"],
  ["kind", "Mensch / Haustier"],
  ["city", "Stadt"],
  ["created", "Erfasst (Monat)"],
  ["seen", "Zuletzt gesehen"],
];
const DEFAULTS = { list: "main_circle", grid: "", table: "" };

// gespeicherte Ansichten merken sich ihre Gruppierung selbst, sonst gilt die letzte Wahl je Ansicht
export function groupingOf(view, cfg) {
  if (cfg && "group" in cfg) return cfg.group || "";
  return LS("group_" + view, DEFAULTS[view] ?? "");
}
export function setGrouping(view, cfg, g, saved) { if (saved) cfg.group = g; else { delete cfg.group; SAVE("group_" + view, g); } }
export const groupLabel = (g) => GROUPINGS.find((x) => x[0] === g)?.[1] || "Keine";

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
function seenBucket(d) {
  if (!d) return ["9", "Nie"];
  const days = (Date.now() - new Date(d + "T12:00:00")) / 86400000;
  if (days < 8) return ["1", "Diese Woche"];
  if (days < 32) return ["2", "Diesen Monat"];
  if (days < 183) return ["3", "Im letzten halben Jahr"];
  if (days < 366) return ["4", "Im letzten Jahr"];
  return ["5", "Länger her"];
}

// → [Sortierschlüssel, Kopf-Element]
export function groupOf(g, r) {
  switch (g) {
    case "main_circle": return r.main_circle_id ? ["0" + (S.circles[r.main_circle_id]?.name || "").toLowerCase(), circleChip(r.main_circle_id)] : ["~", h("span.chip", "Lose")];
    case "circle_kind": {
      const k = S.kinds[S.circles[r.main_circle_id]?.kind_id];
      return k ? ["0" + k.name.toLowerCase(), h("span.chip", { style: { background: k.bg, color: k.fg } }, k.icon ? icon(k.icon, "xs") : null, k.name)] : ["~", h("span.chip", "Lose")];
    }
    case "level": return r.level ? [String(r.level), h("b", ringName(r.level))] : ["9", h("b", "Ohne Ring")];
    case "via": { const x = r.v.f_via; return x?.d ? ["0" + x.d.toLowerCase(), h("b", x.d)] : ["~", h("span.t2", "Unbekannt")]; }
    case "kind": return r.kind === "pet" ? ["1", h("b", "Haustiere")] : ["0", h("b", "Menschen")];
    case "city": { const c = r.v.f_city?.d; return c ? ["0" + c.toLowerCase(), h("b", c)] : ["~", h("span.t2", "Ohne Stadt")]; }
    case "created": { const m = (r.created_at || "").slice(0, 7); return [String(9999 - +m.slice(0, 4)) + String(12 - +m.slice(5, 7)).padStart(2, "0"), h("b", m ? `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : "–")]; }
    case "seen": { const [k, l] = seenBucket(r.v.f_seen?.raw); return [k, h("b", l)]; }
    default: return ["", null];
  }
}

// Liste in Gruppen teilen – Reihenfolge innerhalb bleibt (Sortierung)
export function groupRows(g, list) {
  if (!g) return [{ key: "", head: null, rows: list }];
  const m = new Map();
  for (const r of list) { const [k, head] = groupOf(g, r); if (!m.has(k)) m.set(k, { key: k, head, rows: [] }); m.get(k).rows.push(r); }
  return [...m.values()].sort((a, b) => (a.key === "~") - (b.key === "~") || a.key.localeCompare(b.key, LOCALE()));
}
