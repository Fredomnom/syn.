// Sprachen: Deutsch ist die Quelle. Englisch und Spanisch kommen aus Wörterbüchern (static/i18n/xx.json).
// Übersetzt wird beim Anzeigen: ein Beobachter tauscht deutsche Texte und Attribute (placeholder, Tooltip, aria-label)
// gegen die Übersetzung. Was Nutzer eintippen (Eingabefelder, Notizen) bleibt unangetastet.
export const LANGS = [["auto", "Automatisch"], ["de", "Deutsch"], ["en", "English"], ["es", "Español"]];
const SUPPORTED = ["de", "en", "es"];

function pick() {
  let pref = null;
  try { pref = localStorage.getItem("syn.lang"); } catch (_) {}
  if (pref && SUPPORTED.includes(pref)) return pref;
  for (const l of navigator.languages || [navigator.language || "de"]) {
    const b = String(l).slice(0, 2).toLowerCase();
    if (SUPPORTED.includes(b)) return b;
  }
  return "en";
}
export let LANG = pick();
export const LOCALE = () => ({ de: "de-DE", en: "en-GB", es: "es-ES" })[LANG];
export function langPref() { try { return localStorage.getItem("syn.lang") || "auto"; } catch (_) { return "auto"; } }
export function setLang(l) {
  try { l === "auto" ? localStorage.removeItem("syn.lang") : localStorage.setItem("syn.lang", l); } catch (_) {}
  location.reload();
}

const dict = new Map();
const pats = [];
const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
const norm = (s) => s.replace(/\s+/g, " ").trim();

function lookup(k) {
  const v = dict.get(k);
  if (v != null) return v;
  for (const [re, out] of pats) {
    const m = re.exec(k);
    if (m) { let i = 1; return out.replace(/\{\}/g, () => { const x = m[i++] ?? ""; return dict.get(norm(x)) ?? x; }); }
  }
  return null;
}
// Text übersetzen (für Code, der Texte nicht ins DOM schreibt)
export function t(s, ...args) {
  let out = s;
  if (LANG !== "de") { const v = lookup(norm(s)); if (v != null) out = v; }
  let i = 0; return args.length ? out.replace(/\{\}/g, () => args[i++] ?? "") : out;
}
function trText(s) {
  if (!s || !/[A-Za-zÄÖÜäöüß]/.test(s)) return null;
  const k = norm(s); if (!k) return null;
  const v = lookup(k); if (v == null || v === k) return null;
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
  return lead + v + trail;
}

const SKIP = "input, textarea, script, style, [contenteditable], .no-i18n, code, pre, .note-body";
const ATTRS = ["placeholder", "data-tip", "title", "aria-label", "alt"];
const done = new WeakMap(); // Knoten → zuletzt gesetzter Text, gegen Schleifen

function trNode(n) {
  if (n.nodeType === 3) {
    const p = n.parentElement;
    if (!p || p.closest(SKIP)) return;
    if (done.get(n) === n.data) return;
    const v = trText(n.data);
    if (v != null) n.data = v;
    done.set(n, n.data);
  } else if (n.nodeType === 1) {
    if (n.matches(SKIP) && !(n.matches("input, textarea") && (n.placeholder || n.title))) return;
    for (const a of ATTRS) {
      const x = n.getAttribute(a);
      if (x) { const v = trText(x); if (v != null) n.setAttribute(a, v); }
    }
    if (n.matches("input[type=submit], input[type=button]") && n.value) { const v = trText(n.value); if (v) n.value = v; }
    if (n.matches(SKIP)) return;
    for (const c of n.childNodes) trNode(c);
  }
}

export async function initI18n() {
  document.documentElement.lang = LANG;
  if (LANG === "de") return;
  try {
    const d = await fetch(`/static/i18n/${LANG}.json`).then((r) => r.json());
    for (const [k, v] of Object.entries(d)) {
      if (!v) continue;
      const nk = norm(k);
      if (nk.includes("{}")) pats.push([new RegExp("^" + nk.split("{}").map(esc).join("(.+?)") + "$", "s"), v]);
      else dict.set(nk, v);
    }
    pats.sort((a, b) => b[0].source.length - a[0].source.length); // genauere Muster zuerst
  } catch (_) { return; }
  trNode(document.documentElement);
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "childList") m.addedNodes.forEach(trNode);
      else if (m.type === "characterData") trNode(m.target);
      else if (m.type === "attributes") trNode(m.target);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
