// <syn-hue>: Farbwähler für Kreis-Arten. Einstellbar ist nur der Farbton – Sättigung und Helligkeit sind fest,
// damit jedes Paar aus heller Fläche und dunkler Schrift zur Marke passt.
export const LIGHT_S = 85, LIGHT_L = 94, DARK_S = 70, DARK_L = 32;
const PRESETS = [12, 25, 40, 95, 140, 168, 190, 205, 222, 245, 262, 285, 320, 345];

export function hsl2hex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
export function hueOf(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(hex || ""); if (!m) return 0;
  const n = parseInt(m[1], 16); const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round((h * 60 + 360) % 360);
}
export const pairForHue = (h) => ({ bg: hsl2hex(h, LIGHT_S, LIGHT_L), fg: hsl2hex(h, DARK_S, DARK_L) });

class SynHue extends HTMLElement {
  constructor() {
    super();
    this._h = 220;
    this.btn = document.createElement("button");
    this.btn.type = "button"; this.btn.className = "hue-btn";
    this.btn.addEventListener("click", () => (this.panel ? this.close() : this.open()));
  }
  connectedCallback() { if (!this.contains(this.btn)) this.append(this.btn); this.classList.add("syn-hue"); this.paint(); }
  disconnectedCallback() { this.close(); }
  get value() { return this._h; }
  set value(h) { this._h = Math.round(((+h % 360) + 360) % 360); this.paint(); }
  get pair() { return pairForHue(this._h); }
  paint() {
    const p = this.pair;
    this.btn.style.setProperty("--hb", p.bg); this.btn.style.setProperty("--hf", p.fg);
    this.btn.textContent = this.getAttribute("label") || "Farbton";
    if (this.panel) this.drawPanel();
  }
  emit(final) { this.paint(); this.dispatchEvent(new Event("input", { bubbles: true })); if (final) this.dispatchEvent(new Event("change", { bubbles: true })); }
  open() {
    this.panel = document.createElement("div");
    this.panel.className = "pop hue-pop";
    document.body.append(this.panel);
    this.drawPanel();
    const r = this.getBoundingClientRect(), P = this.panel;
    P.style.left = Math.max(8, Math.min(r.left, innerWidth - P.offsetWidth - 8)) + "px";
    P.style.top = (r.bottom + P.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - P.offsetHeight - 6) : r.bottom + 6) + "px";
    this._off = (e) => { if (!P.contains(e.target) && !this.contains(e.target) && !e.target.closest?.(".pop")) this.close(); };
    this._key = (e) => { if (e.key === "Escape") { e.stopPropagation(); this.close(); } };
    setTimeout(() => { document.addEventListener("mousedown", this._off, true); document.addEventListener("keydown", this._key, true); });
  }
  drawPanel() {
    const P = this.panel; if (!P) return;
    if (!P.firstChild) {
      const sws = document.createElement("div"); sws.className = "hue-sws";
      for (const h of PRESETS) {
        const b = document.createElement("button"); b.type = "button"; const p = pairForHue(h);
        b.style.background = p.bg; b.style.color = p.fg; b.textContent = "Aa"; b.dataset.h = h;
        b.addEventListener("click", () => { this.value = h; this.emit(true); });
        sws.append(b);
      }
      const track = document.createElement("div"); track.className = "hue-track";
      const knob = document.createElement("span"); knob.className = "hue-knob"; track.append(knob);
      const pick = (e) => { const r = track.getBoundingClientRect(); this.value = Math.min(359, Math.max(0, ((e.clientX - r.left) / r.width) * 360)); this.emit(false); };
      track.addEventListener("pointerdown", (e) => { track.setPointerCapture(e.pointerId); pick(e); track.onpointermove = pick; });
      track.addEventListener("pointerup", () => { track.onpointermove = null; this.emit(true); });
      track.tabIndex = 0;
      track.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); this.value = this._h + (e.key === "ArrowRight" ? 5 : -5); this.emit(true); } });
      const prev = document.createElement("div"); prev.className = "hue-prev";
      const note = document.createElement("div"); note.className = "tiny t3"; note.textContent = "Nur der Farbton ist wählbar – Sättigung und Helligkeit bleiben fest.";
      P.append(sws, track, prev, note);
    }
    P.querySelector(".hue-knob").style.left = (this._h / 360) * 100 + "%";
    P.querySelector(".hue-knob").style.background = `hsl(${this._h} 90% 50%)`;
    const p = this.pair, prev = P.querySelector(".hue-prev");
    prev.replaceChildren();
    const chip = document.createElement("span"); chip.className = "chip"; chip.style.background = p.bg; chip.style.color = p.fg; chip.textContent = this.getAttribute("label") || "Beispiel";
    const av = document.createElement("span"); av.className = "av"; av.style.background = p.bg; av.style.color = p.fg; av.textContent = "AB";
    const code = document.createElement("span"); code.className = "mono tiny t2"; code.textContent = `${this._h}° · ${p.bg} / ${p.fg}`;
    prev.append(av, chip, code);
    P.querySelectorAll(".hue-sws button").forEach((b) => b.classList.toggle("on", +b.dataset.h === this._h));
  }
  close() { if (!this.panel) return; this.panel.remove(); this.panel = null; document.removeEventListener("mousedown", this._off, true); document.removeEventListener("keydown", this._key, true); }
}
if (!customElements.get("syn-hue")) customElements.define("syn-hue", SynHue);

export function hueInput(hue, { label, onChange } = {}) {
  const el = document.createElement("syn-hue");
  if (label) el.setAttribute("label", label);
  el.value = hue;
  if (onChange) el.addEventListener("change", () => onChange(el.value, el.pair));
  return el;
}
