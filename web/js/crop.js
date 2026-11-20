// Bilder zuschneiden: quadratischer Ausschnitt mit runder Vorschau, Ziehen zum Verschieben, Regler/Mausrad zum Zoomen.
import { h, modal, api, icon } from "./core.js";

export function cropDialog(file, { size = 512, round = true } = {}) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.onload = async () => {
      const V = 300; // Ansichtsgröße
      const cv = h("canvas.crop-canvas", { width: V * 2, height: V * 2, style: { width: V + "px", height: V + "px" } });
      const ctx = cv.getContext("2d");
      const base = Math.max(V / img.width, V / img.height);
      const st = { z: 1, x: 0, y: 0 };
      const clamp = () => {
        const s = base * st.z, w = img.width * s, hh = img.height * s;
        st.x = Math.min(0, Math.max(V - w, st.x)); st.y = Math.min(0, Math.max(V - hh, st.y));
      };
      const center = () => { const s = base * st.z; st.x = (V - img.width * s) / 2; st.y = (V - img.height * s) / 2; };
      center();
      const draw = () => {
        clamp();
        const s = base * st.z;
        ctx.setTransform(2, 0, 0, 2, 0, 0);
        ctx.clearRect(0, 0, V, V);
        ctx.drawImage(img, st.x, st.y, img.width * s, img.height * s);
        ctx.fillStyle = "rgba(22,24,29,.45)";
        ctx.beginPath(); ctx.rect(0, 0, V, V);
        if (round) ctx.arc(V / 2, V / 2, V / 2 - 2, 0, Math.PI * 2, true); else ctx.rect(4, 4, V - 8, V - 8);
        ctx.fill("evenodd");
        ctx.strokeStyle = "#FFD60A"; ctx.lineWidth = 2;
        ctx.beginPath(); if (round) ctx.arc(V / 2, V / 2, V / 2 - 2, 0, Math.PI * 2); else ctx.rect(4, 4, V - 8, V - 8); ctx.stroke();
      };
      let drag = null;
      cv.addEventListener("pointerdown", (e) => { drag = { x: e.clientX - st.x, y: e.clientY - st.y }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener("pointermove", (e) => { if (!drag) return; st.x = e.clientX - drag.x; st.y = e.clientY - drag.y; draw(); });
      cv.addEventListener("pointerup", () => (drag = null));
      const zoomTo = (z, cx = V / 2, cy = V / 2) => {
        z = Math.min(6, Math.max(1, z));
        const k = z / st.z; st.x = cx - (cx - st.x) * k; st.y = cy - (cy - st.y) * k; st.z = z; slider.value = z; draw();
      };
      cv.addEventListener("wheel", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomTo(st.z * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
      const slider = h("input", { type: "range", min: 1, max: 6, step: 0.01, value: 1, style: { flex: 1 }, on: { input: (e) => zoomTo(+e.target.value) } });
      draw();
      const body = h("div.col", { style: { alignItems: "center" } }, cv,
        h("div.row", { style: { width: V + "px" } }, icon("minus"), slider, icon("plus")),
        h("p.small.t3", "Ziehen verschiebt den Ausschnitt, Mausrad oder Regler zoomt."));
      const ok = await modal("Bild zuschneiden", body, [{ label: "Abbrechen", value: false }, { label: "Übernehmen", primary: true, value: true }]);
      if (!ok) { URL.revokeObjectURL(url); return resolve(null); }
      const out = h("canvas", { width: size, height: size });
      const o = out.getContext("2d");
      const s = base * st.z, f = size / V;
      o.fillStyle = "#fff"; o.fillRect(0, 0, size, size);
      o.drawImage(img, st.x * f, st.y * f, img.width * s * f, img.height * s * f);
      URL.revokeObjectURL(url);
      out.toBlob((b) => resolve(b), "image/jpeg", 0.9);
    };
    img.src = url;
  });
}

// Datei wählen → zuschneiden → hochladen. Gibt die URL des Bildes zurück (oder null).
export async function pickAndCrop(file, opts) {
  if (!file) return null;
  const blob = await cropDialog(file, opts);
  if (!blob) return null;
  const fd = new FormData();
  fd.append("file", new File([blob], "bild.jpg", { type: "image/jpeg" }));
  const r = await api("POST", "/files", fd);
  return r.url;
}
