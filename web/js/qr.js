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
export async function qrDialog(title, text, { hint, label } = {}) {
  const box = await qrBox(text, ".qr-big");
  const copy = async () => { try { await navigator.clipboard.writeText(text); toast("Kopiert"); } catch (_) { toast(text); } };
  return modal(title, h("div.qr-dlg",
    box,
    label !== false ? h("div.qr-url.mono", label || text) : null,
    hint ? h("p.small.t2.qr-hint", hint) : null,
    h("div.row.wrap.qr-acts", label === false ? null : h("button.btn.sm", { on: { click: copy } }, icon("copy"), "Kopieren"),
      navigator.share && /^https?:/.test(text) ? h("button.btn.sm", { on: { click: () => navigator.share({ title, url: text }).catch(() => {}) } }, icon("ext"), "Teilen") : null)), []);
}
