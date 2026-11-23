// QR-Codes (Visitenkarte, CardDAV-Einrichtung, Zwei-Faktor). Die Bibliothek wird erst bei Bedarf geladen.
import { h, icon, modal, toast } from "./core.js";

let lib = null;
export async function loadQr() {
  if (window.qrcode) return window.qrcode;
  lib ||= new Promise((ok, bad) => document.head.append(h("script", { src: "/static/vendor/qrcode.js", on: { load: () => ok(window.qrcode), error: bad } })));
  return lib;
}

// Weißes Kästchen mit dem Code als SVG (scharf in jeder Größe, auch im dunklen Modus gut scanbar)
export async function qrBox(text, cls = "") {
  const qr = await loadQr();
  const q = qr(0, "M"); q.addData(text); q.make();
  const box = h("div.qr-box" + cls);
  box.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return box;
}

// Großer QR-Code zum Vorzeigen, darunter der Link zum Kopieren
export async function qrDialog(title, text, { hint, label, book } = {}) {
  // book: Schalter „Freundebuch“ – hängt ?fb=1 an (die Visitenkarte zeigt dann auch das Freundebuch)
  let cur = text;
  const box = h("div.qr-slot", await qrBox(text, ".qr-big"));
  const url = label !== false ? h("div.qr-url.mono", label || text) : null;
  const copy = async () => { try { await navigator.clipboard.writeText(cur); toast("Kopiert"); } catch (_) { toast(cur); } };
  let sw = null;
  if (book) {
    const cb = h("input", { type: "checkbox", on: { change: async () => {
      cur = cb.checked ? text + (text.includes("?") ? "&" : "?") + "fb=1" : text;
      box.replaceChildren(await qrBox(cur, ".qr-big"));
      if (url) url.textContent = cb.checked ? (label || text) + " · Freundebuch" : (label || text);
    } } });
    sw = h("label.check.qr-book", cb, "Freundebuch gleich mit ausfüllen lassen");
  }
  return modal(title, h("div.qr-dlg",
    box, url, sw,
    hint ? h("p.small.t2.qr-hint", hint) : null,
    h("div.row.wrap.qr-acts", label === false ? null : h("button.btn.sm", { on: { click: copy } }, icon("copy"), "Kopieren"),
      navigator.share && /^https?:/.test(text) ? h("button.btn.sm", { on: { click: () => navigator.share({ title, url: cur }).catch(() => {}) } }, icon("ext"), "Teilen") : null)), []);
}
