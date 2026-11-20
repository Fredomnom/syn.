// syn – Start, Router, Login, Erststart und Ersteinrichtung. Handy und Desktop sind bewusst zwei Oberflächen.
import "./date.js";
import "./color.js";
import "./hover.js";
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
  const user = h("input.input", { placeholder: "Benutzername", autocomplete: "username", autocapitalize: "none" });
  const pw = h("input.input", { type: "password", placeholder: "Passwort", autocomplete: inst.needs_setup ? "new-password" : "current-password" });
  const name = h("input.input", { placeholder: "Dein Name (z.B. Fred)" });
  const err = h("p.small", { style: { color: "var(--danger)" } });
  const submit = async (e) => {
    e.preventDefault(); err.textContent = "";
    try {
      if (inst.needs_setup) await api("POST", "/instance/setup", { username: user.value, password: pw.value, display_name: name.value || user.value }, { quiet: true });
      else await api("POST", "/auth/login", { username: user.value, password: pw.value }, { quiet: true });
      location.hash = "#/"; render();
    } catch (ex) { err.textContent = ex.message; }
  };
  clear(app, h("div.center", h("form.auth.card.pad", { on: { submit } },
    h("div.row.between", logo(), h("span.t3.small", "Das Kontaktbuch für alle, die du kennst.")),
    inst.needs_setup ? h("div.hint", h("div.grow", h("b", "Erster Start. "), "Du legst jetzt das Admin-Konto an. Weitere Konten legst du danach in den Einstellungen an – es gibt keine offene Registrierung.")) : null,
    inst.needs_setup ? name : null, user, pw, err,
    h("button.btn.primary", { type: "submit" }, inst.needs_setup ? "Konto anlegen" : "Anmelden"))));
  user.focus();
}

async function renderSetup(app) {
  const st = { use_levels: true, use_ist: false, mode: "rule", max: 3 };
  const box = h("div.auth.card.pad", { style: { width: "min(520px,100%)" } });
  const opt = (key, val, title, text) => {
    const l = h("label" + (st[key] === val ? ".on" : ""), { on: { click: () => { st[key] = val; draw(); } } },
      h("input", { type: "radio", checked: st[key] === val }), h("div", h("b", title), h("div.small.t2", text)));
    return l;
  };
  const draw = () => clear(box, logo(), h("h2", "Drei Fragen zum Start"), h("p.t2.small", "Alles lässt sich später in den Einstellungen ändern."),
    h("h3", "1. Willst du mit Ringen arbeiten?"),
    h("div.choice", opt("use_levels", true, "Ja, mit Ringen", "Jede Person bekommt von Hand einen Ring von 1 (Engste) bis 4 (Weit). Dazu gibt es die Ringe-Ansicht."),
      opt("use_levels", false, "Nein", "Ohne Level fallen die Ringe-Ansicht und Level-Bedingungen weg, alles andere bleibt.")),
    h("h3", "2. Soll syn ein „Ist“ berechnen?"),
    h("div.choice", opt("use_ist", true, "Ja", "Aus „Zuletzt gesehen“, Zählern und Importen (z.B. letzte Nachricht) berechnet syn, wie nah jemand gerade wirklich ist."),
      opt("use_ist", false, "Nein", "Nur das, was du selbst einträgst.")),
    h("h3", "3. Wer kommt aufs Handy?"),
    h("div.choice", opt("mode", "all", "Jeder", "Alle Personen."),
      opt("mode", "rule", "Nach Regel", st.use_levels ? `Alle bis Ring ${st.max} – dazu jede Person mit dem Schalter „Mit Handy synchronisieren“.` : "Alle mit Telefonnummer – dazu jede Person mit dem Schalter „Mit Handy synchronisieren“."),
      opt("mode", "none", "Niemand", "Nur Personen, bei denen du „Mit Handy synchronisieren“ einschaltest.")),
    st.mode === "rule" && st.use_levels ? h("label.f", "Bis Ring", h("select.input", { on: { change: (e) => (st.max = +e.target.value) } }, [1, 2, 3, 4].map((n) => h("option", { value: n, selected: st.max === n }, n)))) : null,
    h("button.btn.primary", { on: { click: async () => {
      const rules = st.use_levels ? [{ type: "level", max: st.max }] : [{ type: "has_phone" }];
      S.settings = await POST("/me/setup", { use_levels: st.use_levels, use_ist: st.use_ist, sync: { mode: st.mode, match: "any", rules } });
      S.me.settings = S.settings; location.hash = "#/"; render();
    } } }, "Los geht's"));
  draw();
  clear(app, h("div.center", box));
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
