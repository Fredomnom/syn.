// Kalender in syn: „Demnächst“ (Liste), Monatsansicht (Desktop) und Rückblick auf einen Tag (mit Fotos aus Immich).
// Zeigt die Daten deiner Leute – Geburtstage, Jahrestage, „Kennengelernt“ … –, keine eigenen Termine.
import { S, h, icon, GET, clear, avatar, modal, nameEl } from "./core.js";
import { LOCALE } from "./i18n.js";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const LS = (k, d) => { try { return JSON.parse(localStorage.getItem("syn.cal." + k)) ?? d; } catch (_) { return d; } };
const SAVE = (k, v) => { try { localStorage.setItem("syn.cal." + k, JSON.stringify(v)); } catch (_) {} };

// Welche Datumsfelder der Kalender zeigt (gemerkt im Browser); Standard: alle außer „Zuletzt gesehen“
export const calFields = () => LS("fields", null) || S.fieldList.filter((f) => f.type === "date" && f.scope !== "kreis" && f.id !== "f_seen").map((f) => f.id);

function dayLabel(s, today = iso(new Date())) {
  const d = parse(s), t = parse(today), diff = Math.round((d - t) / 86400000);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Morgen";
  if (diff === -1) return "Gestern";
  return d.toLocaleDateString(LOCALE(), { weekday: diff > 0 && diff < 7 ? "long" : "short", day: "numeric", month: "long" });
}

// „wird 32“, „5. Jahrestag“, „vor 3 Jahren kennengelernt“ …
export function whatText(it, past = false) {
  const n = it.years;
  if (it.field === "f_bday") return n != null ? (past ? `wurde ${n}` : n === 0 ? "geboren" : `wird ${n}`) : "Geburtstag";
  if (it.field === "f_met") return n ? `vor ${n} ${n === 1 ? "Jahr" : "Jahren"} kennengelernt` : "Kennengelernt";
  if (it.field === "f_anniv") return n ? `${n}. Jahrestag` : "Jahrestag";
  return n ? `${it.field_name} · ${n} ${n === 1 ? "Jahr" : "Jahre"}` : it.field_name;
}

async function load(start, end) {
  const f = calFields();
  if (!f.length) return { items: [] };
  return GET(`/calendar?start=${start}&end=${end}&fields=${encodeURIComponent(f.join(","))}`);
}

// Feld-Auswahl als Chips
export function fieldPicker(onChange) {
  const box = h("div.sugg.cal-pick");
  const draw = () => {
    const sel = new Set(calFields());
    clear(box, S.fieldList.filter((f) => f.type === "date" && f.scope !== "kreis").map((f) =>
      h("span.chip" + (sel.has(f.id) ? ".sel" : ".plain"), { on: { click: () => { sel.has(f.id) ? sel.delete(f.id) : sel.add(f.id); SAVE("fields", [...sel]); draw(); onChange(); } } },
        sel.has(f.id) ? icon("check", "xs") : null, f.name)));
  };
  draw();
  return box;
}

// ---------------------------------------------------------------- Demnächst (Liste)
export async function upcoming(box, { days = 30 } = {}) {
  const t = new Date(), end = new Date(t); end.setDate(t.getDate() + days);
  const d = await load(iso(t), iso(end));
  const byDay = new Map();
  for (const it of d.items) (byDay.get(it.date) || byDay.set(it.date, []).get(it.date)).push(it);
  if (!byDay.size) return clear(box, h("div.card.pad.empty", `In den nächsten ${days} Tagen steht nichts an.`));
  clear(box, [...byDay].map(([day, items]) => h("div.cal-day",
    h("button.cal-day-h", { type: "button", title: "Tag im Rückblick", on: { click: () => dayDialog(day) } },
      h("b", dayLabel(day)), h("span.t3.small", parse(day).toLocaleDateString(LOCALE(), { day: "numeric", month: "numeric" }))),
    h("div.list", items.map((it) => h("a.prow", { href: "#/p/" + it.entity.id }, avatar(it.entity, 36),
      h("div.grow", h("div.nm", nameEl(it.entity)), h("div.sub", it.field === "f_bday" ? icon("gift", "xs") : icon("calendar", "xs"), whatText(it))),
      icon("right")))))));
}

// ---------------------------------------------------------------- Monat (Desktop)
export async function monthView(box, { onNav } = {}) {
  let cur = LS("month", null) ? parse(LS("month")) : new Date();
  cur = new Date(cur.getFullYear(), cur.getMonth(), 1);
  const draw = async () => {
    SAVE("month", iso(cur));
    const first = new Date(cur), startDow = (first.getDay() + 6) % 7; // Montag zuerst
    const gridStart = new Date(first); gridStart.setDate(1 - startDow);
    const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 41);
    const d = await load(iso(gridStart), iso(gridEnd));
    const byDay = new Map();
    for (const it of d.items) (byDay.get(it.date) || byDay.set(it.date, []).get(it.date)).push(it);
    const today = iso(new Date());
    const wd = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(LOCALE(), { weekday: "short" }));
    const cells = [...Array(42)].map((_, i) => {
      const day = new Date(gridStart); day.setDate(gridStart.getDate() + i);
      const k = iso(day), items = byDay.get(k) || [];
      return h("button.cal-cell" + (day.getMonth() !== cur.getMonth() ? ".other" : "") + (k === today ? ".today" : "") + (items.length ? ".has" : ""),
        { type: "button", on: { click: () => dayDialog(k) } },
        h("span.cal-num", day.getDate()),
        h("div.cal-avs", items.slice(0, 4).map((it) => h("span.cal-av", { title: `${it.entity.display} · ${whatText(it)}` }, avatar(it.entity, 26))),
          items.length > 4 ? h("span.cal-more", `+${items.length - 4}`) : null),
        items.length === 1 ? h("span.cal-one", items[0].entity.display.split(" ")[0]) : null);
    });
    const step = (n) => { cur = new Date(cur.getFullYear(), cur.getMonth() + n, 1); draw(); };
    clear(box,
      h("div.cal-head", h("button.btn.sm.ghost.icon", { "aria-label": "Voriger Monat", on: { click: () => step(-1) } }, icon("left")),
        h("h3", cur.toLocaleDateString(LOCALE(), { month: "long", year: "numeric" })),
        h("button.btn.sm.ghost.icon", { "aria-label": "Nächster Monat", on: { click: () => step(1) } }, icon("right")),
        h("button.btn.sm", { on: { click: () => { cur = new Date(new Date().getFullYear(), new Date().getMonth(), 1); draw(); } } }, "Heute")),
      h("div.cal-grid", wd.map((w) => h("div.cal-wd", w)), cells));
    onNav?.();
  };
  await draw();
}

// ---------------------------------------------------------------- Ein Tag im Rückblick
export async function dayDialog(day) {
  const d = await GET("/calendar/day/" + day);
  const P = d.photos.length ? await import("./photos.js") : null;
  const byYear = new Map();
  for (const p of d.photos) (byYear.get(p.year) || byYear.set(p.year, []).get(p.year)).push(p);
  const past = day < iso(new Date());
  const all = { items: d.photos, immich: null };
  const body = h("div.col", { style: { gap: "14px" } },
    d.items.length ? h("div.list", d.items.map((it) => h("a.prow", { href: "#/p/" + it.entity.id, on: { click: () => document.querySelector(".backdrop:not(.leaving)")?._close(null) } },
      avatar(it.entity, 36), h("div.grow", h("div.nm", nameEl(it.entity)), h("div.sub", whatText(it, past)))))) : h("p.small.t2", "An diesem Tag steht bei niemandem etwas an."),
    d.photos.length ? [h("h3.cal-sub", "An diesem Tag in früheren Jahren"),
      ...[...byYear].map(([y, ps]) => h("div.col", { style: { gap: "6px" } },
        h("div.small.t2", `${y} · vor ${parse(day).getFullYear() - y} ${parse(day).getFullYear() - y === 1 ? "Jahr" : "Jahren"}`),
        h("div.ph-grid", ps.map((p) => { const img = h("img", { src: P.photoUrl(p.id), alt: "", loading: "lazy" }); img.addEventListener("load", () => img.classList.add("in")); img.addEventListener("error", () => img.closest(".ph-cell")?.remove());
          return h("button.ph-cell", { type: "button", on: { click: () => P.lightbox(all, d.photos.indexOf(p)) } }, img); }))))] : null);
  return modal(parse(day).toLocaleDateString(LOCALE(), { weekday: "long", day: "numeric", month: "long", year: "numeric" }), body, [], { wide: true });
}
