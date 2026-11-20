// Onscreen-Guide nach der Einführung: führt einmal an einer echten Person durch die wichtigsten Dinge.
// Jeder Schritt zeigt auf ein echtes Element und geht von selbst weiter, sobald man es erledigt hat.
import { S, h, icon, today } from "./core.js";
import { keys, binding } from "./shortcuts.js";

const KEY = "syn.guide";
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) { return null; } };
const save = (g) => { try { g ? localStorage.setItem(KEY, JSON.stringify(g)) : localStorage.removeItem(KEY); } catch (_) {} };
export const startGuide = (pid) => save({ pid, step: 0, baseline: null });

const fieldCount = (e) => Object.values(e.fields || {}).reduce((n, vals) => n + vals.filter((v) => !v.deprecated).length, 0);

function steps(e, mobile) {
  const name = (e.name || e.description || "diese Person").split(" ")[0];
  return [
    S.settings.use_levels ? { sel: ".guide-ring", title: `Wie nah ist dir ${name}?`, text: mobile ? "Tipp auf „Ring“ und wähl einen Ring von 1 (Engste) bis 4 (Weit)." : "Zieh den Punkt auf einen Ring – oder klick darunter und wähl einen Ring von 1 (Engste) bis 4 (Weit).", done: () => e.level != null } : null,
    { sel: '[data-fid="f_via"]', title: "Wie habt ihr euch kennengelernt?", text: "Wähl eine Person, einen Kreis oder eine Quelle wie Instagram oder Discord.", done: () => (e.ihr_zwei?.fields?.f_via || []).length > 0 },
    mobile ? null : { sel: ".guide-circle", title: `In welchen Kreis gehört ${name}?`, text: "Kreise sind Gruppen wie Familie, Klasse oder Verein. Sie färben das Profilbild und ordnen die Ringe.", done: () => (e.memberships || []).some((m) => m.active) },
    { sel: ".guide-field", title: "Was weißt du noch?", text: "Trag eine Sache ein – Geburtstag, Wohnort, Telefon oder ein eigenes Feld.", done: (g) => fieldCount(e) > (g.baseline ?? 0) },
    e.is_self ? null : { sel: ".guide-seen", title: "Habt ihr euch heute gesehen?", text: "Ein Tipp merkt sich das Datum und zählt das Treffen – auch direkt aus der Personenliste.", done: () => (e.fields?.f_seen || []).some((v) => v.value === today()) },
  ].filter(Boolean);
}

let raf = 0;
function clearOverlay() { cancelAnimationFrame(raf); document.querySelectorAll(".guide-spot, .guide-card").forEach((x) => x.remove()); }
addEventListener("hashchange", () => { const g = load(); if (!g || !location.hash.startsWith("#/p/" + g.pid)) clearOverlay(); });

export function guideAttach(e, { mobile = false } = {}) {
  const g = load();
  clearOverlay();
  if (!g || g.pid !== e.id) return;
  if (g.baseline === null || g.baseline === undefined) { g.baseline = fieldCount(e); save(g); }
  const list = steps(e, mobile);
  while (g.step < list.length && list[g.step].done(g)) g.step++;
  save(g);
  setTimeout(() => show(g, list), 350); // nach dem Einblenden der Seite
}

function show(g, list) {
  clearOverlay();
  if (g.step >= list.length) return finish();
  const st = list[g.step];
  const target = document.querySelector(st.sel);
  if (!target) { g.step++; save(g); return show(g, list); }
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  const spot = h("div.guide-spot");
  const card = h("div.guide-card",
    h("div.guide-step", `${g.step + 1} von ${list.length}`, h("span.guide-dots", list.map((_, i) => h("span" + (i === g.step ? ".on" : i < g.step ? ".done" : ""))))),
    h("h3", st.title), h("p", st.text),
    h("div.row", h("button.btn.sm.ghost", { on: { click: () => { save(null); clearOverlay(); } } }, "Guide beenden"), h("span.grow"),
      h("button.btn.sm", { on: { click: () => { g.step++; save(g); show(g, list); } } }, "Überspringen")));
  document.body.append(spot, card);
  const place = () => {
    if (!target.isConnected) return clearOverlay();
    const r = target.getBoundingClientRect(), pad = 8;
    Object.assign(spot.style, { left: r.left - pad + "px", top: r.top - pad + "px", width: r.width + pad * 2 + "px", height: r.height + pad * 2 + "px" });
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let top = r.bottom + 16, left = r.left + r.width / 2 - cw / 2;
    if (top + ch > innerHeight - 12) top = r.top - ch - 16;
    if (top < 12) { top = Math.max(12, r.top); left = r.right + 16 + cw < innerWidth ? r.right + 16 : r.left - cw - 16; }
    card.style.left = Math.max(12, Math.min(innerWidth - cw - 12, left)) + "px";
    card.style.top = Math.max(12, Math.min(innerHeight - ch - 12, top)) + "px";
    raf = requestAnimationFrame(place);
  };
  place();
}

function finish() {
  save(null);
  const card = h("div.guide-card.final",
    h("div.intro-check", h("svg", { viewBox: "0 0 52 52", width: 56, height: 56 }, h("circle", { cx: 26, cy: 26, r: 24, class: "ck-c" }), h("path", { d: "M15 27l7 7 15-16", class: "ck-p" }))),
    h("h3", "Das war's schon!"),
    h("p", "So wächst aus einem Eintrag nach und nach eine Person. Ein paar Dinge, die dir helfen:"),
    h("div.guide-tips",
      h("div.row", keys(binding("search")), h("span", "findet Personen, Kreise und Ansichten")),
      h("div.row", keys(binding("new_person")), h("span", "legt eine neue Person an")),
      h("div.row", keys(binding("undo")), h("span", "macht jede Änderung rückgängig"))),
    h("button.btn.primary", { on: { click: () => { card.classList.add("leaving"); setTimeout(clearOverlay, 200); } } }, "Los geht's"));
  document.body.append(h("div.guide-spot.full"), card);
  card.style.left = `calc(50% - ${card.offsetWidth / 2}px)`; card.style.top = `calc(50% - ${card.offsetHeight / 2}px)`;
}
