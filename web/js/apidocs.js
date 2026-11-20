// API-Dokumentation – direkt in syn, aus /api/openapi.json, ohne fremde Dienste.
import { S, h, icon, clear, debounce, toast } from "./core.js";

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"];
let spec = null;

function resolve(s) {
  if (!s) return s;
  if (s.$ref) return resolve(spec.components.schemas[s.$ref.split("/").pop()]);
  if (s.anyOf) return resolve(s.anyOf.find((x) => x.type !== "null") || s.anyOf[0]);
  return s;
}
function example(s, depth = 0) {
  s = resolve(s); if (!s || depth > 4) return null;
  if (s.default !== undefined) return s.default;
  if (s.enum) return s.enum[0];
  switch (s.type) {
    case "string": return s.format === "date" ? "2026-03-14" : "…";
    case "integer": case "number": return 0;
    case "boolean": return false;
    case "array": return [example(s.items, depth + 1)];
    case "object": default: {
      const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = example(v, depth + 1);
      return Object.keys(o).length ? o : {};
    }
  }
}
const typeOf = (s) => { s = resolve(s) || {}; return s.type === "array" ? `${typeOf(s.items)}[]` : s.type || "object"; };

export async function apiDocs(main, route) {
  if (!spec) spec = await (await fetch("/api/openapi.json")).json();
  const ops = [];
  for (const [path, item] of Object.entries(spec.paths)) for (const m of METHOD_ORDER) if (item[m]) ops.push({ path, method: m, op: item[m], tag: (item[m].tags || ["Weitere"])[0] });
  const tags = [...new Set(ops.map((o) => o.tag))];
  const q = h("input.input", { placeholder: "Endpunkte filtern, z.B. entities oder Routine" });
  const content = h("div.api-content");
  const navEl = h("nav.api-nav", h("div.set-gtitle", "Bereiche"), tags.map((t) => h("a.set-item", { href: "#", on: { click: (e) => { e.preventDefault(); content.querySelector(`[data-tag="${CSS.escape(t)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); } } }, t, h("span.n.t3.small", ops.filter((o) => o.tag === t).length))));
  const draw = () => {
    const f = q.value.trim().toLowerCase();
    clear(content, tags.map((t) => {
      const list = ops.filter((o) => o.tag === t && (!f || `${o.method} ${o.path} ${o.op.description || ""} ${o.op.summary || ""} ${t}`.toLowerCase().includes(f)));
      if (!list.length) return null;
      return h("section.api-tag", { "data-tag": t }, h("h2", t), list.map(endpoint));
    }));
  };
  q.addEventListener("input", debounce(draw, 120));
  const base = location.origin + "/api/v1";
  const page = h("div.page.api-page",
    h("div.set-head", h("h1", "API"), h("p.t2", "Alles, was die Oberfläche kann, geht auch über die API – die Oberfläche benutzt selbst nur sie.")),
    h("div.api-intro",
      h("div", h("div.srow-title", "Basis-Adresse"), h("div.api-copy", h("code", base), h("button.btn.sm.icon.ghost", { title: "Kopieren", on: { click: () => { navigator.clipboard?.writeText(base); toast("Kopiert"); } } }, icon("copy")))),
      h("div", h("div.srow-title", "Anmeldung"), h("p.small.t2", "Mit einem Long-lived Token im Header ", h("code", "Authorization: Bearer syn_…"), ". Tokens – auch nur lesende – legst du unter ", h("a", { href: "#/settings/tokens" }, "API-Tokens"), " an.")),
      h("pre.code", `curl -H "Authorization: Bearer $SYN_TOKEN" \\\n  ${base}/entities?filter=lose`)),
    h("div.api-layout", navEl, h("div.col", { style: { gap: "14px", minWidth: 0 } }, q, content)));
  main.append(page);
  draw();
}

function endpoint(o) {
  const lines = (o.op.description || "").trim().split("\n");
  const title = lines[0] || o.op.summary || "";
  const rest = lines.slice(1).join("\n").trim();
  const params = (o.op.parameters || []);
  const bodySchema = o.op.requestBody?.content?.["application/json"]?.schema;
  const isFile = !!o.op.requestBody?.content?.["multipart/form-data"];
  const det = h("div.api-detail");
  const card = h("div.api-ep",
    h("button.api-head", { type: "button", on: { click: () => { const open = card.classList.toggle("open"); if (open && !det.firstChild) fill(); } } },
      h("span.api-m." + o.method, o.method.toUpperCase()), h("code.api-path", o.path.replace("/api/v1", "")), h("span.api-title", title), h("span.imp-chev", icon("down"))),
    det);
  const fill = () => {
    const inputs = {};
    const body = bodySchema ? h("textarea.input.mono.api-body", { rows: 8, value: JSON.stringify(example(bodySchema), null, 2) }) : null;
    const out = h("div.api-out");
    det.append(
      rest ? h("p.small.t2", { style: { whiteSpace: "pre-wrap", margin: 0 } }, rest) : null,
      params.length ? h("div.api-block", h("div.api-btitle", "Parameter"), h("table.mtable.api-params", params.map((p) => {
        inputs[p.name] = h("input.input.mono", { placeholder: p.required ? "erforderlich" : "optional", value: "" });
        return h("tr", h("td", h("code", p.name), p.required ? h("span.api-req", "*") : null), h("td.t3.small", p.in === "path" ? "im Pfad" : "Abfrage"), h("td.t3.mono.small", typeOf(p.schema)), h("td", inputs[p.name]));
      }))) : null,
      body ? h("div.api-block", h("div.api-btitle", "Anfrage (JSON)"), body) : null,
      isFile ? h("p.small.t3", "Erwartet eine Datei als multipart/form-data.") : null,
      h("div.row", h("button.btn.primary.sm", { on: { click: () => run() } }, icon("zap"), "Ausprobieren"), h("span.small.t3", "läuft mit deiner aktuellen Anmeldung")),
      out);
    const run = async () => {
      let path = o.path; const qs = new URLSearchParams();
      for (const p of params) { const v = inputs[p.name].value.trim(); if (!v) continue; if (p.in === "path") path = path.replace(`{${p.name}}`, encodeURIComponent(v)); else qs.set(p.name, v); }
      if (/\{.*\}/.test(path)) return toast("Pfad-Parameter fehlen", { err: true });
      const opts = { method: o.method.toUpperCase(), headers: { "X-Syn": "1" }, credentials: "same-origin" };
      if (body) { opts.body = body.value; opts.headers["Content-Type"] = "application/json"; }
      const t0 = performance.now();
      try {
        const r = await fetch(path + (qs.toString() ? "?" + qs : ""), opts);
        const txt = await r.text(); let pretty = txt; try { pretty = JSON.stringify(JSON.parse(txt), null, 2); } catch (_) {}
        clear(out, h("div.row.small", h("span.api-status" + (r.ok ? ".ok" : ".err"), r.status), h("span.t3", `${Math.round(performance.now() - t0)} ms`)), h("pre.code", pretty.slice(0, 20000)));
      } catch (e) { clear(out, h("p.small", { style: { color: "var(--danger)" } }, e.message)); }
    };
  };
  return card;
}
