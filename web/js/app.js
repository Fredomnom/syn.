// syn – Start, Router, Login, Erststart und Ersteinrichtung. Handy und Desktop sind bewusst zwei Oberflächen.
import "./date.js";
import "./color.js";
import "./hover.js";
import "./controls.js";
import { onGlobal } from "./shortcuts.js";
import { S, h, api, GET, POST, clear, logo, loadBase, isMobile, flushQueue, toast, icon } from "./core.js";

export const route = { parts: [], query: {} };
let mode = null;

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, q] = raw.split("?");
  route.parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  route.query = Object.fromEntries(new URLSearchParams(q || ""));
}

export async function render() {
  parse();
  const app = document.getElementById("app");
  if (route.parts[0] === "login") return renderLogin(app);
  if (!S.me) {
    try { await loadBase(); }
    catch (e) {
      if (e.status === 401) return;
      clear(app, h("div.center", h("div.auth.card.pad", logo(), h("p", "syn ist gerade nicht erreichbar."), h("button.btn", { on: { click: () => location.reload() } }, "Nochmal versuchen"))));
      return;
    }
    flushQueue();
  }
  if (!S.settings.setup_done) return renderSetup(app);
  mode = isMobile() ? "m" : "d";
  const mod = mode === "m" ? await import("./mobile.js") : await import("./desktop.js");
  try { await mod.render(app, route); }
  catch (e) { console.error(e); if (e.status !== 401) toast(e.message || String(e), { err: true }); }
}

addEventListener("hashchange", render);
addEventListener("syn-theme", () => render());
addEventListener("resize", () => { const m = isMobile() ? "m" : "d"; if (mode && m !== mode) render(); });

export function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }

// ---------------------------------------------------------------- Login und Erststart
async function renderLogin(app) {
  const inst = await GET("/instance");
  S.me = null;
  const user = h("input.input.big", { placeholder: "Benutzername", autocomplete: "username", autocapitalize: "none" });
  const pw = h("input.input.big", { type: "password", placeholder: "Passwort", autocomplete: inst.needs_setup ? "new-password" : "current-password" });
  const name = h("input.input.big", { placeholder: "Dein Name (z.B. Fred)" });
  const err = h("p.login-err");
  const btn = h("button.btn.primary.big", { type: "submit" }, inst.needs_setup ? "Konto anlegen" : "Anmelden", icon("right"));
  const submit = async (e) => {
    e.preventDefault(); err.textContent = ""; btn.disabled = true;
    try {
      if (inst.needs_setup) await api("POST", "/instance/setup", { username: user.value, password: pw.value, display_name: name.value || user.value }, { quiet: true });
      else await api("POST", "/auth/login", { username: user.value, password: pw.value }, { quiet: true });
      app.querySelector(".login")?.classList.add("leaving");
      setTimeout(() => { location.hash = "#/"; render(); }, 260);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; form.classList.remove("shake"); void form.offsetWidth; form.classList.add("shake"); }
  };
  // Ringe im Hintergrund – wie die Ringe-Ansicht, ganz ruhig pulsierend
  const rings = h("svg.login-rings", { viewBox: "-500 -500 1000 1000", "aria-hidden": "true" });
  for (let i = 1; i <= 6; i++) rings.append(h("circle", { r: i * 80, style: { animationDelay: i * 0.35 + "s" } }));
  const form = h("form.login-form", { on: { submit } },
    inst.needs_setup ? h("div.login-first", h("b", "Willkommen! "), "Du legst jetzt das Admin-Konto an. Weitere Konten legst du später selbst an.") : null,
    inst.needs_setup ? name : null, user, pw, err, btn);
  clear(app, h("div.login-bg", rings, h("div.login",
    h("div.login-logo", h("span", "s"), h("span", "y"), h("span", "n"), h("b", ".")),
    h("p.login-slogan", "Das Kontaktbuch für alle, die du kennst."),
    form)));
  (inst.needs_setup ? name : user).focus();
}

// Ersteinrichtung als kurze, mehrseitige Einführung
async function renderSetup(app) {
  const st = { use_levels: true, use_ist: false, mode: "rule", max: 3, map: "osm" };
  const steps = ["welcome", "rings", "ist", "phone", "maps", "done"];
  let i = 0, dir = 1;
  const stage = h("div.intro-stage");
  const dots = h("div.intro-dots");
  const back = h("button.btn.ghost", { on: { click: () => go(i - 1) } }, icon("left"), "Zurück");
  const next = h("button.btn.primary", { on: { click: () => (i === steps.length - 1 ? finish() : go(i + 1)) } });
  const keysHint = h("span.intro-keys", h("span.kbd", "Enter"), " weiter");
  const card = h("div.intro", { style: { position: "relative" } }, dots, stage, h("div.intro-nav", back, h("span.grow"), keysHint, next));
  const choice = (key, val, title, text, ill) => h("button.intro-choice" + (st[key] === val ? ".on" : ""), { type: "button", tabIndex: -1, on: { click: () => { st[key] = val; draw(true); } } },
    ill ? h("span.intro-ill", ill) : null, h("span.col", { style: { gap: "2px", alignItems: "flex-start", textAlign: "left" } }, h("b", title), h("span.small.t2", text)), h("span.intro-radio"));
  const ringsIll = (n) => { const svg = h("svg", { viewBox: "0 0 48 48", width: 44, height: 44 }); for (let r = n; r >= 1; r--) svg.append(h("circle", { cx: 24, cy: 24, r: r * 5.5, fill: r === 2 ? "var(--yellow-light)" : "none", stroke: r === 2 ? "var(--yellow-line)" : "var(--line-strong)", "stroke-width": 1.5, class: "ring-anim", style: { animationDelay: (n - r) * 80 + "ms" } })); svg.append(h("circle", { cx: 24, cy: 24, r: 3, fill: "var(--ink)" })); return svg; };
  const page = (name) => {
    if (name === "welcome") return h("div.intro-page",
      h("div.intro-logo", h("span", "s"), h("span", "y"), h("span", "n"), h("b", ".")),
      h("h1", "Das Kontaktbuch für alle, die du kennst."),
      h("p.t2", "Auch für die, deren Namen du noch nicht weißt. Fünf kurze Fragen, dann geht's los."),
      h("div.intro-points",
        [["eye", "Erfassen ohne Namen", "„Typ aus dem Fitnessstudio“ reicht für den Anfang."], ["rings", "Ringe und Kreise", "Wer dir nah ist und wohin jemand gehört."],
          ["key", "Deine Daten", "Läuft auf deinem Server, ohne fremde Dienste."]].map(([ic, t, d], k) =>
          h("div.intro-point", { style: { animationDelay: 250 + k * 90 + "ms" } }, h("span.intro-ic", icon(ic)), h("div", h("b", t), h("div.small.t2", d))))));
    if (name === "rings") return h("div.intro-page", h("span.intro-step", "1 von 4"), h("h2", "Willst du mit Ringen arbeiten?"),
      h("p.t2", "Ein Ring zeigt, wie nah dir jemand ist – von 1 (Engste) bis 4 (Weit). Du setzt ihn selbst."),
      h("div.intro-choices", choice("use_levels", true, "Ja, mit Ringen", "Mit Ringe-Ansicht und Bedingungen wie „Ring ≤ 2“.", ringsIll(4)),
        choice("use_levels", false, "Nein", "Alles andere bleibt gleich.", ringsIll(0))));
    if (name === "ist") return h("div.intro-page", h("span.intro-step", "2 von 4"), h("h2", "Soll syn ein „Ist“ berechnen?"),
      h("p.t2", "Aus „Zuletzt gesehen“, der Zahl der Treffen und Importen wie der letzten Nachricht sieht syn, wie nah jemand gerade wirklich ist."),
      h("div.intro-choices", choice("use_ist", true, "Ja, berechnen", "Zeigt auch, wer nah ist, aber lange nicht gesehen wurde.", icon("clock")),
        choice("use_ist", false, "Nein", "Nur das, was du selbst einträgst.", icon("edit"))));
    if (name === "phone") return h("div.intro-page", h("span.intro-step", "3 von 4"), h("h2", "Wer soll mit dem Handy synchronisiert werden?"),
      h("p.t2", "Aufs Handy kommt nur, was ein Telefonbuch versteht: Name, Nummern, E-Mails, Geburtstag, Profilbild."),
      h("div.intro-choices", choice("mode", "all", "Jeder", "Alle Personen.", icon("users")),
        choice("mode", "rule", "Nach Regel", st.use_levels ? "Alle bis zu einem Ring – dazu jede, die du einzeln einschaltest." : "Alle mit Telefonnummer – dazu jede, die du einzeln einschaltest.", icon("filter")),
        choice("mode", "none", "Niemand", "Nur Personen, die du einzeln einschaltest.", icon("x"))),
      st.mode === "rule" && st.use_levels ? h("div.intro-ringpick", h("span.t2", "Bis Ring"), h("div.seg", [1, 2, 3, 4].map((n) => h("button" + (st.max === n ? ".on" : ""), { type: "button", on: { click: () => { st.max = n; draw(true); } } }, `${n} · ${["Engste", "Nah", "Mittel", "Weit"][n - 1]}`)))) : null);
    if (name === "maps") return h("div.intro-page", h("span.intro-step", "4 von 4"), h("h2", "Womit sollen Adressen öffnen?"),
      h("p.t2", "Ein Tipp auf eine Adresse öffnet die Karte."),
      h("div.intro-choices", choice("map", "osm", "OpenStreetMap", "Frei und ohne Konto.", icon("pin")),
        choice("map", "google", "Google Maps", "Am weitesten verbreitet.", icon("pin")), choice("map", "apple", "Apple Karten", "Auf iPhone und Mac zuhause.", icon("pin"))));
    return h("div.intro-page.center-text", h("div.intro-check", h("svg", { viewBox: "0 0 52 52", width: 72, height: 72 }, h("circle", { cx: 26, cy: 26, r: 24, class: "ck-c" }), h("path", { d: "M15 27l7 7 15-16", class: "ck-p" }))),
      h("h2", "Fertig eingerichtet"),
      h("p.t2", "Alles lässt sich später in den Einstellungen ändern. Leg mit „+ Person“ los oder hol dir Leute über Importe."),
      h("div.intro-summary", [["Ringe", st.use_levels ? "an" : "aus"], ["Ist", st.use_ist ? "berechnet" : "aus"], ["Handy", { all: "Jeder", rule: st.use_levels ? `bis Ring ${st.max}` : "nach Regel", none: "Niemand" }[st.mode]], ["Karten", { osm: "OpenStreetMap", google: "Google Maps", apple: "Apple Karten" }[st.map]]].map(([k, v]) => h("div", h("span.t3.small", k), h("b", v)))));
  };
  const draw = (same = false) => {
    const pg = page(steps[i]);
    if (!same) pg.classList.add(dir > 0 ? "from-right" : "from-left");
    clear(stage, pg);
    pg.querySelectorAll(".intro-choice").forEach((c, k) => c.prepend(h("span.intro-num", String(k + 1))));
    clear(keysHint, pg.querySelector(".intro-choice") ? [h("span.kbd", "1–" + pg.querySelectorAll(".intro-choice").length), " wählen  ", h("span.kbd", "Enter"), " weiter"] : [h("span.kbd", "Enter"), " weiter"]);
    clear(dots, steps.map((_, k) => h("span" + (k === i ? ".on" : k < i ? ".done" : ""))));
    back.style.visibility = i === 0 || i === steps.length - 1 ? "hidden" : "visible";
    clear(next, i === 0 ? "Los geht's" : i === steps.length - 1 ? "syn öffnen" : "Weiter", icon("right"));
  };
  const go = (k) => { if (k < 0 || k >= steps.length) return; dir = k > i ? 1 : -1; i = k; draw(); };
  const finish = async () => {
    const rules = st.use_levels ? [{ type: "level", max: st.max }] : [{ type: "has_phone" }];
    S.settings = await POST("/me/setup", { use_levels: st.use_levels, use_ist: st.use_ist, sync: { mode: st.mode, match: "any", rules } });
    S.settings = await api("PATCH", "/me/settings", { map_provider: st.map });
    S.me.settings = S.settings; card.classList.add("leaving");
    setTimeout(() => { location.hash = "#/"; render(); }, 220);
  };
  const key = (e) => {
    if (!document.body.contains(card)) return removeEventListener("keydown", key);
    if (e.target.closest?.("input, textarea")) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); next.click(); }
    else if (e.key === "ArrowRight") go(i + 1);
    else if (e.key === "ArrowLeft" || e.key === "Backspace") go(i - 1);
    else if (/^[1-9]$/.test(e.key)) { const c = stage.querySelectorAll(".intro-choice")[+e.key - 1]; if (c) { e.preventDefault(); c.click(); } }
  };
  addEventListener("keydown", key);
  draw();
  const rings = h("svg.login-rings", { viewBox: "-500 -500 1000 1000", "aria-hidden": "true" });
  for (let r = 1; r <= 6; r++) rings.append(h("circle", { r: r * 80, style: { animationDelay: r * 0.35 + "s" } }));
  clear(app, h("div.center.intro-bg", rings, card));
}

// Universelles Rückgängig / Wiederholen
export async function undoRedo(which) {
  let r;
  try { r = await api("POST", "/" + which, undefined, { quiet: true }); }
  catch (e) { toast(e.status === 409 ? (which === "undo" ? "Nichts zum Rückgängigmachen" : "Nichts zum Wiederholen") : e.message); return; }
  S.rows = null;
  await loadBase();
  await render();
  const other = which === "undo" ? "redo" : "undo";
  toast(`${which === "undo" ? "Rückgängig" : "Wiederholt"}: ${r.label}`, { action: { label: which === "undo" ? "Wiederholen" : "Rückgängig", run: () => undoRedo(other) } });
}
onGlobal("undo", () => undoRedo("undo"));
onGlobal("redo", () => undoRedo("redo"));
addEventListener("syn-undo", (e) => undoRedo(e.detail));

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
render();
