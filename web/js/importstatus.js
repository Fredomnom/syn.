// Kleines Statusfenster unten rechts für laufende Importe – bleibt beim Seitenwechsel stehen.
import { h, icon, clear, invalidate, api, GET } from "./core.js";
import { serviceIcon } from "./fields.js";

let dock = null;
const ensureDock = () => { if (!dock || !dock.isConnected) { dock = h("div.imp-dock"); document.body.append(dock); } return dock; };

export function importStarted(imp) {
  const bar = h("div.imp-bar", h("span"));
  const text = h("div.imp-text", "Importiere …");
  const actions = h("div.imp-actions");
  const box = h("div.imp-toast.running",
    h("div.imp-tl", h("span.imp-tlogo", serviceIcon(imp.service || imp.id, 18)), h("div.grow", h("b", imp.name), text),
      h("button.btn.sm.ghost.icon", { title: "Ausblenden", on: { click: () => close() } }, icon("x"))),
    bar, actions);
  ensureDock().append(box);
  const t0 = Date.now();
  const tick = setInterval(() => { if (box.classList.contains("running")) text.textContent = `Importiere … ${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
  const close = () => { clearInterval(tick); box.classList.add("leaving"); setTimeout(() => box.remove(), 200); };
  return {
    progress(j) {
      if (!box.classList.contains("running")) return;
      const pct = j.total ? Math.min(100, Math.round((j.done / j.total) * 100)) : null;
      bar.classList.toggle("det", pct != null);
      if (pct != null) bar.firstChild.style.width = pct + "%";
      clearInterval(tick);
      text.textContent = j.total ? `${j.phase || "Importiere"} · ${j.done} von ${j.total}` : `${j.phase || "Importiere"} …`;
    },
    done(status, log) {
      clearInterval(tick); invalidate();
      const err = /Fehler/.test(status);
      box.classList.remove("running"); box.classList.add(err ? "err" : "ok");
      const m = /(\d+) neu/.exec(status), k = /(\d+) erkannt/.exec(status);
      clear(text, err ? status.replace(/^[^:]+: /, "") : `${m ? m[1] : 0} neu · ${k ? k[1] : 0} erkannt`);
      clear(actions,
        !err && m && +m[1] ? h("a.btn.sm", { href: "#/v/lose", on: { click: (e) => { e.preventDefault(); location.hash = "#/people/table"; } } }, "Neue ansehen") : null,
        log ? h("button.btn.sm.ghost", { on: { click: () => { const pre = box.querySelector("pre"); if (pre) pre.remove(); else box.append(h("pre.code.imp-log", log.split("\n").slice(-12).join("\n"))); } } }, "Log") : null);
      if (!err) setTimeout(() => { if (box.isConnected && !box.matches(":hover")) close(); }, 9000);
    },
    fail(msg) { this.done("Fehler: " + msg); },
  };
}

// Import im Hintergrund starten und den Fortschritt abfragen. Liefert {status, log}.
export async function runImport(imp, fd, { onProgress } = {}) {
  const st = importStarted(imp);
  try {
    const { job } = await api("POST", `/importers/${imp.id}/run?background=1`, fd, { quiet: true });
    for (;;) {
      await new Promise((r) => setTimeout(r, 450));
      const j = await GET("/importers/jobs/" + job);
      st.progress(j); onProgress?.(j);
      if (j.finished) { st.done(j.status || "", j.log); return { status: j.status || "", log: j.log }; }
    }
  } catch (e) { st.fail(e.message); throw e; }
}

// Schritt-für-Schritt-Anleitung eines Importers
export function stepsEl(imp) {
  if (!imp.steps?.length) return null;
  return h("ol.imp-steps", imp.steps.map((t, i) => h("li", h("span.imp-step-n", i + 1), h("span", t))));
}
