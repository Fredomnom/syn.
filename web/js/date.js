// <syn-date>: eigenes Datumsfeld mit Kalender. Versteht ungenaue Angaben wie in syn üblich:
// „2026-03-14“, „????-03-14“ (Jahr unbekannt), „2026-03-??“ (nur Monat), „2025-Herbst“ (Jahreszeit).
// Freitext („14.3.“, „Herbst 2025“) ist ebenfalls erlaubt – der Server vereinheitlicht ihn.
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const SEASONS = ["Frühling", "Sommer", "Herbst", "Winter"];
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const pad = (n) => String(n).padStart(2, "0");

export function parseLoose(s) {
  if (!s) return null;
  s = String(s).trim();
  let m = /^(\d{4}|\?{4})-(Frühling|Sommer|Herbst|Winter)$/.exec(s);
  if (m) return { y: m[1].includes("?") ? null : +m[1], m: null, d: null, season: m[2] };
  m = /^(\d{4}|\?{4})-(\d{2}|\?{2})-(\d{2}|\?{2})$/.exec(s);
  if (m) return { y: m[1].includes("?") ? null : +m[1], m: m[2].includes("?") ? null : +m[2], d: m[3].includes("?") ? null : +m[3], season: null };
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(s);
  if (m) return { y: m[3] ? +m[3] : null, m: +m[2], d: +m[1], season: null };
  m = /^(\d{4})$/.exec(s);
  if (m) return { y: +m[1], m: null, d: null, season: null };
  return null;
}
export function canon(p) {
  if (!p) return "";
  const y = p.y ? String(p.y) : "????";
  if (p.season) return `${y}-${p.season}`;
  return `${y}-${p.m ? pad(p.m) : "??"}-${p.d ? pad(p.d) : "??"}`;
}
export function pretty(s) {
  const p = parseLoose(s); if (!p) return s || "";
  if (p.season) return `${p.season} ${p.y || ""}`.trim();
  if (p.m && p.d) return `${pad(p.d)}.${pad(p.m)}.${p.y || ""}` + (p.y ? "" : " (Jahr ?)");
  if (p.m) return `${MONTHS[p.m - 1]} ${p.y || ""}`.trim();
  return p.y ? String(p.y) : s;
}

class SynDate extends HTMLElement {
  static get observedAttributes() { return ["value", "placeholder"]; }
  constructor() {
    super();
    this._value = "";
    this.input = document.createElement("input");
    this.input.className = "input mono";
    this.input.autocomplete = "off";
    this.btn = document.createElement("button");
    this.btn.type = "button"; this.btn.className = "btn icon"; this.btn.dataset.tip = "Kalender öffnen";
    this.btn.innerHTML = '<svg viewBox="0 0 24 24" class="i"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>';
    this.input.addEventListener("input", () => { this._value = this.input.value; this.dispatchEvent(new Event("input", { bubbles: true })); });
    this.input.addEventListener("change", () => this.dispatchEvent(new Event("change", { bubbles: true })));
    this.input.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" && e.altKey) this.open(); });
    this.btn.addEventListener("click", () => (this.panel ? this.close() : this.open()));
  }
  connectedCallback() {
    if (!this.contains(this.input)) { this.classList.add("syn-date"); this.append(this.input, this.btn); }
    if (this.hasAttribute("compact")) {
      // nur ein Knopf mit Beschriftung, z.B. „Stand am …“
      this.input.hidden = true;
      this.btn.className = "btn sm"; this.btn.dataset.tip = "";
      const lab = document.createElement("span"); lab.className = "sd-lab";
      lab.textContent = this._value ? pretty(this._value) : this.getAttribute("compact");
      this.btn.querySelector(".sd-lab")?.remove(); this.btn.append(lab);
      this.addEventListener("change", () => { lab.textContent = this._value ? pretty(this._value) : this.getAttribute("compact"); });
    }
    this.input.placeholder = this.getAttribute("placeholder") || "TT.MM.JJJJ, ohne Jahr, Herbst 2025 …";
    if (this.hasAttribute("value") && !this._value) this.value = this.getAttribute("value");
  }
  disconnectedCallback() { this.close(); }
  attributeChangedCallback(n, _o, v) { if (n === "value") this.value = v; if (n === "placeholder") this.input.placeholder = v || ""; }
  get value() { return this._value; }
  set value(v) { this._value = v || ""; this.input.value = this._value; }
  focus() { this.input.focus(); }

  set(p, close = true) {
    this.value = canon(p);
    this.dispatchEvent(new Event("input", { bubbles: true }));
    this.dispatchEvent(new Event("change", { bubbles: true }));
    if (close) this.close(); else this.draw();
  }
  open() {
    const p = parseLoose(this._value) || {};
    const now = new Date();
    this.st = { y: p.y || now.getFullYear(), m: p.m || now.getMonth() + 1, noYear: !!(p.m && !p.y), sel: p };
    this.panel = document.createElement("div");
    this.panel.className = "pop date-pop";
    document.body.append(this.panel);
    this.draw();
    const r = this.getBoundingClientRect();
    const ph = this.panel.offsetHeight, pw = this.panel.offsetWidth;
    this.panel.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + "px";
    this.panel.style.top = (r.bottom + ph + 8 > innerHeight ? Math.max(8, r.top - ph - 6) : r.bottom + 6) + "px";
    this._off = (e) => { if (!this.panel?.contains(e.target) && !this.contains(e.target) && !e.target.closest?.(".pop")) this.close(); };
    this._key = (e) => { if (e.key === "Escape") { e.stopPropagation(); this.close(); } };
    setTimeout(() => { document.addEventListener("mousedown", this._off, true); document.addEventListener("keydown", this._key, true); });
  }
  close() {
    if (!this.panel) return;
    this.panel.remove(); this.panel = null;
    document.removeEventListener("mousedown", this._off, true); document.removeEventListener("keydown", this._key, true);
  }
  draw() {
    const st = this.st, P = this.panel;
    const el = (tag, cls, txt, on) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; if (on) e.addEventListener("click", on); return e; };
    P.replaceChildren();
    // Kopf: Monat und Jahr
    const head = el("div", "dp-head");
    head.append(el("button", "btn sm icon", "‹", () => { st.m--; if (st.m < 1) { st.m = 12; st.y--; } this.draw(); }));
    const msel = el("select", "input dp-sel");
    MONTHS.forEach((name, i) => { const o = el("option", null, name); o.value = i + 1; o.selected = st.m === i + 1; msel.append(o); });
    msel.addEventListener("change", () => { st.m = +msel.value; this.draw(); });
    const yin = el("input", "input mono dp-year"); yin.type = "number"; yin.value = st.y; yin.disabled = st.noYear;
    yin.addEventListener("change", () => { st.y = +yin.value || st.y; this.draw(); });
    head.append(msel, yin, el("button", "btn sm icon", "›", () => { st.m++; if (st.m > 12) { st.m = 1; st.y++; } this.draw(); }));
    P.append(head);
    // Tage
    const grid = el("div", "dp-grid");
    WD.forEach((w) => grid.append(el("span", "dp-wd", w)));
    const first = new Date(st.y, st.m - 1, 1);
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(st.y, st.m, 0).getDate();
    for (let i = 0; i < offset; i++) grid.append(el("span"));
    const t = new Date(); const sel = st.sel || {};
    for (let d = 1; d <= days; d++) {
      const b = el("button", "dp-day", String(d), () => this.set({ y: st.noYear ? null : st.y, m: st.m, d }));
      b.type = "button";
      if (!st.noYear && t.getFullYear() === st.y && t.getMonth() + 1 === st.m && t.getDate() === d) b.classList.add("today");
      if (sel.d === d && sel.m === st.m && (sel.y === st.y || (!sel.y && st.noYear))) b.classList.add("on");
      grid.append(b);
    }
    P.append(grid);
    // Ungenaue Angaben
    const opts = el("div", "dp-opts");
    const ny = el("label", "check small"); const nyc = el("input"); nyc.type = "checkbox"; nyc.checked = st.noYear;
    nyc.addEventListener("change", () => { st.noYear = nyc.checked; this.draw(); });
    ny.append(nyc, " Jahr unbekannt");
    opts.append(ny,
      el("button", "btn sm", "Nur Monat", () => this.set({ y: st.noYear ? null : st.y, m: st.m, d: null })),
      el("button", "btn sm", "Nur Jahr", () => this.set({ y: st.y, m: null, d: null })));
    P.append(opts);
    const seas = el("div", "dp-opts");
    SEASONS.forEach((s) => { const b = el("button", "btn sm" + (sel.season === s ? " active" : ""), s, () => this.set({ y: st.noYear ? null : st.y, season: s })); seas.append(b); });
    P.append(seas);
    const foot = el("div", "dp-foot");
    foot.append(el("button", "btn sm", "Heute", () => { const n = new Date(); this.set({ y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() }); }),
      el("span", "t3 tiny", this._value ? pretty(this._value) : ""),
      el("button", "btn sm ghost", "Leeren", () => { this.value = ""; this.dispatchEvent(new Event("change", { bubbles: true })); this.close(); }));
    P.append(foot);
  }
}
if (!customElements.get("syn-date")) customElements.define("syn-date", SynDate);

export function dateInput(value = "", { placeholder, onChange } = {}) {
  const el = document.createElement("syn-date");
  if (placeholder) el.setAttribute("placeholder", placeholder);
  el.value = value || "";
  if (onChange) el.addEventListener("change", () => onChange(el.value));
  return el;
}
