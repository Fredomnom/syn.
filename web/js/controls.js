// Eigene, markengerechte Bedienelemente statt Browser-Standard.
// Ein Enhancer wertet automatisch jedes native Element auf, sobald es im DOM erscheint:
//   <select>, <select multiple>  →  eigenes Auswahlmenü (Suche, Tastatur, Mehrfachauswahl)
//   <input type=file>            →  Knopf mit Dateiname und Drag & Drop
//   <input list=…>               →  eigene Vorschlagsliste (statt <datalist>)
//   <input type=time>            →  Textfeld mit Uhrzeit-Vorschlägen
// Das native Element bleibt unsichtbar als Datenquelle erhalten – value, selectedOptions und
// change-Ereignisse funktionieren wie gewohnt.

const ICON = {
  down: '<svg viewBox="0 0 24 24" class="i"><path d="m6 9 6 6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" class="i"><path d="M20 6 9 17l-5-5"/></svg>',
  upload: '<svg viewBox="0 0 24 24" class="i"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>',
  search: '<svg viewBox="0 0 24 24" class="i"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
};
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------------------------------------------------------------- schwebendes Panel
let panel = null;
function closePanel() {
  if (!panel) return;
  const p = panel; panel = null;
  p.el.remove();
  document.removeEventListener("mousedown", p.off, true);
  document.removeEventListener("keydown", p.key, true);
  removeEventListener("resize", p.reposition); removeEventListener("scroll", p.reposition, true);
  p.onClose?.();
}
function openPanel(anchor, content, { onKey, onClose, width } = {}) {
  closePanel();
  const box = el("div", "pop ctl-pop");
  box.append(content);
  document.body.append(box);
  const reposition = () => {
    const r = anchor.getBoundingClientRect();
    box.style.minWidth = Math.max(width || 0, r.width) + "px";
    const h = box.offsetHeight, w = box.offsetWidth;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8 && r.top - h - 6 > 8) top = r.top - h - 6;
    box.style.top = Math.max(8, Math.min(top, innerHeight - h - 8)) + "px";
    box.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
  };
  reposition();
  const off = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) closePanel(); };
  const key = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePanel(); anchor.focus?.(); return; }
    onKey?.(e);
  };
  setTimeout(() => document.addEventListener("mousedown", off, true));
  document.addEventListener("keydown", key, true);
  addEventListener("resize", reposition); addEventListener("scroll", reposition, true);
  panel = { el: box, off, key, reposition, onClose };
  return box;
}
addEventListener("hashchange", closePanel);

// ---------------------------------------------------------------- <select>
function enhanceSelect(sel) {
  if (sel.dataset.ctl || sel.closest(".ctl-pop")) return;
  sel.dataset.ctl = "1";
  const multi = sel.multiple;
  const wrap = el("span", "ctl-select" + (sel.classList.contains("input") ? "" : " plain") + (multi ? " multi" : ""));
  const btn = el("button", "ctl-btn");
  btn.type = "button";
  for (const p of ["height", "width", "minWidth", "maxWidth", "flex"]) if (sel.style[p]) (p === "flex" || p.includes("idth") ? wrap : btn).style[p] = sel.style[p];
  if (sel.style.height) btn.style.height = sel.style.height;
  const label = el("span", "ctl-label");
  btn.append(label, el("span", "ctl-chev", ICON.down));
  sel.parentNode.insertBefore(wrap, sel);
  wrap.append(sel, btn);
  sel.classList.add("ctl-native");
  const opts = () => [...sel.options].filter((o) => !o.hidden);
  const refresh = () => {
    btn.disabled = sel.disabled;
    if (multi) {
      const chosen = [...sel.selectedOptions];
      label.innerHTML = chosen.length ? chosen.map((o) => `<span class="ctl-tag">${esc(o.textContent)}</span>`).join("") : `<span class="ctl-ph">Auswählen …</span>`;
    } else {
      const o = sel.options[sel.selectedIndex];
      label.textContent = o ? o.textContent : "";
    }
  };
  refresh();
  sel.addEventListener("change", refresh);
  new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true });
  const fire = () => { sel.dispatchEvent(new Event("input", { bubbles: true })); sel.dispatchEvent(new Event("change", { bubbles: true })); refresh(); };
  const open = () => {
    if (sel.disabled) return;
    const box = el("div", "ctl-menu");
    const list = el("div", "ctl-list");
    let q = "", active = Math.max(0, opts().findIndex((o) => o.selected));
    const many = opts().length > 9;
    const search = many ? el("input", "input ctl-search") : null;
    if (search) { search.placeholder = "Suchen …"; box.append(search); }
    box.append(list);
    const visible = () => opts().filter((o) => !q || o.textContent.toLowerCase().includes(q));
    const draw = () => {
      list.replaceChildren();
      const vis = visible();
      if (active >= vis.length) active = vis.length - 1;
      vis.forEach((o, i) => {
        const b = el("button", "ctl-opt" + (o.selected ? " sel" : "") + (i === active ? " act" : ""));
        b.type = "button"; b.disabled = o.disabled;
        b.innerHTML = `<span class="ctl-ck">${o.selected ? ICON.check : ""}</span><span>${esc(o.textContent)}</span>`;
        b.addEventListener("mouseenter", () => { active = i; list.querySelectorAll(".act").forEach((x) => x.classList.remove("act")); b.classList.add("act"); });
        b.addEventListener("click", () => choose(o));
        list.append(b);
      });
      if (!vis.length) list.append(el("div", "ctl-empty", "Nichts gefunden"));
      list.querySelector(".act")?.scrollIntoView({ block: "nearest" });
    };
    const choose = (o) => {
      if (multi) { o.selected = !o.selected; fire(); draw(); return; }
      sel.value = o.value; fire(); closePanel(); btn.focus();
    };
    let typed = "", typedT;
    openPanel(btn, box, {
      width: 180,
      onClose: () => wrap.classList.remove("open"),
      onKey: (e) => {
        const vis = visible();
        if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(vis.length - 1, active + 1); draw(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
        else if (e.key === "Enter") { e.preventDefault(); if (vis[active]) choose(vis[active]); }
        else if (e.key === "Tab") closePanel();
        else if (!search && e.key.length === 1) {
          typed += e.key.toLowerCase(); clearTimeout(typedT); typedT = setTimeout(() => (typed = ""), 600);
          const i = vis.findIndex((o) => o.textContent.toLowerCase().startsWith(typed)); if (i >= 0) { active = i; draw(); }
        }
      },
    });
    wrap.classList.add("open");
    if (search) { search.addEventListener("input", () => { q = search.value.trim().toLowerCase(); active = 0; draw(); }); setTimeout(() => search.focus(), 10); }
    draw();
  };
  btn.addEventListener("click", () => (wrap.classList.contains("open") ? closePanel() : open()));
  btn.addEventListener("keydown", (e) => { if (["ArrowDown", "ArrowUp", " "].includes(e.key) && !wrap.classList.contains("open")) { e.preventDefault(); open(); } });
}

// ---------------------------------------------------------------- <input type=file>
function enhanceFile(inp) {
  if (inp.dataset.ctl) return;
  inp.dataset.ctl = "1";
  const img = (inp.accept || "").includes("image");
  const wrap = el("span", "ctl-file");
  const btn = el("button", "btn sm", ICON.upload + `<span>${img ? "Bild wählen" : inp.multiple ? "Dateien wählen" : "Datei wählen"}</span>`);
  btn.type = "button";
  const name = el("span", "ctl-fname", "oder hierher ziehen");
  inp.parentNode.insertBefore(wrap, inp);
  wrap.append(inp, btn, name);
  inp.classList.add("ctl-native");
  btn.addEventListener("click", () => inp.click());
  inp.addEventListener("change", () => {
    const f = [...(inp.files || [])];
    name.textContent = f.length ? (f.length === 1 ? f[0].name : `${f.length} Dateien`) : "oder hierher ziehen";
    wrap.classList.toggle("has", f.length > 0);
  });
  dropTarget(wrap, inp);
}
export function dropTarget(zone, inp) {
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("drag"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("drag"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault(); zone.classList.remove("drag");
    if (!e.dataTransfer?.files?.length) return;
    const dt = new DataTransfer();
    for (const f of e.dataTransfer.files) { dt.items.add(f); if (!inp.multiple) break; }
    inp.files = dt.files;
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// ---------------------------------------------------------------- Vorschläge (statt <datalist>) und Uhrzeit
function suggest(inp, getItems) {
  inp.setAttribute("autocomplete", "off");
  const open = () => {
    const q = inp.value.trim().toLowerCase();
    const items = getItems().filter((x) => !q || x.toLowerCase().includes(q) && x.toLowerCase() !== q).slice(0, 40);
    if (!items.length) { if (panel?.owner === inp) closePanel(); return; }
    let active = -1;
    const list = el("div", "ctl-list");
    const draw = () => {
      list.replaceChildren(...items.map((x, i) => {
        const b = el("button", "ctl-opt" + (i === active ? " act" : ""), `<span class="ctl-ck"></span><span>${esc(x)}</span>`);
        b.type = "button";
        b.addEventListener("mousedown", (e) => { e.preventDefault(); pick(x); });
        return b;
      }));
      list.querySelector(".act")?.scrollIntoView({ block: "nearest" });
    };
    const pick = (x) => { inp.value = x; inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); closePanel(); };
    draw();
    openPanel(inp, list, {
      width: 160,
      onKey: (e) => {
        if (e.target !== inp) return;
        if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(items.length - 1, active + 1); draw(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
        else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(items[active]); }
      },
    });
    panel.owner = inp;
  };
  inp.addEventListener("focus", open);
  inp.addEventListener("input", open);
  inp.addEventListener("blur", () => setTimeout(() => { if (panel?.owner === inp && !panel.el.contains(document.activeElement)) closePanel(); }, 120));
}
function enhanceList(inp) {
  if (inp.dataset.ctlList) return;
  const id = inp.getAttribute("list"); if (!id) return;
  inp.dataset.ctlList = id;
  inp.removeAttribute("list");
  suggest(inp, () => [...(document.getElementById(id)?.options || [])].map((o) => o.value));
}
const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
function enhanceTime(inp) {
  if (inp.dataset.ctl) return;
  inp.dataset.ctl = "1";
  inp.type = "text"; inp.inputMode = "numeric"; inp.placeholder = inp.placeholder || "08:00"; inp.maxLength = 5;
  inp.classList.add("mono");
  suggest(inp, () => TIMES);
  inp.addEventListener("change", () => {
    const m = /^(\d{1,2})[:.]?(\d{2})?$/.exec(inp.value.trim());
    if (m) inp.value = `${String(Math.min(23, +m[1])).padStart(2, "0")}:${String(Math.min(59, +(m[2] || 0))).padStart(2, "0")}`;
  });
}

// ---------------------------------------------------------------- Enhancer
function enhance(root) {
  if (!(root instanceof Element || root instanceof DocumentFragment)) return;
  const all = (s) => (root.matches?.(s) ? [root] : []).concat([...root.querySelectorAll(s)]);
  all("select:not([data-ctl])").forEach(enhanceSelect);
  all('input[type="file"]:not([data-ctl])').forEach(enhanceFile);
  all('input[type="time"]:not([data-ctl])').forEach(enhanceTime);
  all("input[list]").forEach(enhanceList);
}
new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) enhance(n); })
  .observe(document.documentElement, { childList: true, subtree: true });
enhance(document.body);

// ---------------------------------------------------------------- Bausteine für Dialoge
// Schalter (statt Checkbox, wo es um an/aus geht)
export function switchInput(checked, label, hint) {
  const inp = el("input"); inp.type = "checkbox"; inp.className = "switch"; inp.checked = !!checked; inp.setAttribute("role", "switch");
  const l = el("label", "switch-row");
  const text = el("span", "switch-text"); text.append(Object.assign(el("span", "switch-label"), { textContent: label }));
  if (hint) text.append(Object.assign(el("span", "switch-hint"), { textContent: hint }));
  l.append(text, inp);
  return { el: l, get: () => inp.checked, input: inp };
}
// Segmentierte Auswahl (statt Select bei wenigen Optionen)
export function segInput(options, value, onChange) {
  const box = el("div", "seg");
  let cur = value;
  const draw = () => {
    box.replaceChildren(...options.map(([v, label]) => {
      const b = el("button", cur === v ? "on" : ""); b.type = "button"; b.textContent = label;
      b.addEventListener("click", () => { cur = v; draw(); onChange?.(v); });
      return b;
    }));
  };
  draw();
  return { el: box, get: () => cur };
}
// Schlagwort-Eingabe (z.B. Aliase): Enter oder Komma fügt hinzu, × entfernt
export function tagInput(values = [], placeholder = "Hinzufügen …") {
  const list = [...values];
  const box = el("div", "tag-input");
  const inp = el("input"); inp.placeholder = placeholder;
  const draw = () => {
    box.replaceChildren(...list.map((v, i) => {
      const t = el("span", "chip plain", esc(v) + ' <button type="button" aria-label="Entfernen">×</button>');
      t.querySelector("button").addEventListener("click", () => { list.splice(i, 1); draw(); inp.focus(); });
      return t;
    }), inp);
  };
  const add = () => { const v = inp.value.replace(/,$/, "").trim(); if (v && !list.includes(v)) list.push(v); inp.value = ""; draw(); inp.focus(); };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    else if (e.key === "Backspace" && !inp.value && list.length) { list.pop(); draw(); inp.focus(); }
  });
  inp.addEventListener("blur", () => { if (inp.value.trim()) add(); });
  box.addEventListener("click", (e) => { if (e.target === box) inp.focus(); });
  draw();
  return { el: box, get: () => { if (inp.value.trim()) add(); return [...list]; } };
}
