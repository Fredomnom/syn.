// syn – Grundbausteine: API, DOM-Helfer, Icons, Zustand, Formatierung, Dialoge.

export const S = { me: null, settings: {}, fields: {}, fieldList: [], kinds: {}, lose: { bg: "#ECEEF2", fg: "#4B5563" },
  bundKinds: [], circles: {}, views: [], rows: null, rowsAt: 0 };

// ---------------------------------------------------------------- API
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export async function api(method, path, body, { raw = false, quiet = false } = {}) {
  const opts = { method, headers: { "X-Syn": "1" }, credentials: "same-origin" };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  let res;
  busy(true);
  try { res = await fetch("/api/v1" + path, opts); }
  catch (e) { throw new ApiError(0, "Keine Verbindung"); }
  finally { busy(false); }
  if (res.status === 401 && !path.startsWith("/auth")) { location.hash = "#/login"; throw new ApiError(401, "Nicht angemeldet"); }
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = typeof j.detail === "string" ? j.detail : (j.detail?.[0]?.msg || JSON.stringify(j.detail)); } catch (_) {}
    if (!quiet) toast(msg, { err: true });
    throw new ApiError(res.status, msg);
  }
  if (raw) return res;
  const ct = res.headers.get("content-type") || "";
  return ct.includes("json") ? res.json() : res.text();
}
export const GET = (p) => api("GET", p);
export const POST = (p, b) => api("POST", p, b ?? {});
export const PUT = (p, b) => api("PUT", p, b ?? {});
export const PATCH = (p, b) => api("PATCH", p, b ?? {});
export const DEL = (p) => api("DELETE", p);
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") p.set(k, v); const s = p.toString(); return s ? "?" + s : ""; };

// Offline-Speicher für Erfassungen bei schlechtem Netz
const QKEY = "syn.queue";
function readQ() { try { return JSON.parse(localStorage.getItem(QKEY) || "[]"); } catch (_) { return []; } }
function writeQ(q) { try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (_) {} }
export async function postOrQueue(path, body, label) {
  try { return await api("POST", path, body, { quiet: true }); }
  catch (e) {
    if (e.status !== 0) { toast(e.message, { err: true }); throw e; }
    const q = readQ(); q.push({ path, body, label, at: Date.now() }); writeQ(q);
    toast(`Offline gespeichert: ${label}. Wird gesendet, sobald Netz da ist.`);
    return null;
  }
}
export async function flushQueue() {
  const q = readQ(); if (!q.length) return;
  const rest = [];
  for (const item of q) {
    try { await api("POST", item.path, item.body, { quiet: true }); }
    catch (e) { if (e.status === 0) rest.push(item); }
  }
  writeQ(rest);
  if (rest.length < q.length) { toast(`${q.length - rest.length} Offline-Erfassung(en) gesendet`); S.rows = null; }
}
export const queued = () => readQ().length;
addEventListener("online", flushQueue);

// ---------------------------------------------------------------- DOM
// append/prepend überspringen null/undefined/false – so dürfen Bausteine „nichts“ zurückgeben
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ["append", "prepend"]) {
    const orig = proto[m];
    proto[m] = function (...kids) { return orig.apply(this, kids.filter((k) => k !== null && k !== undefined && k !== false)); };
  }
}
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Strg+";
export function h(tag, attrs, ...kids) {
  const m = tag.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const isSvg = ["svg", "g", "circle", "line", "path", "text", "rect", "polygon", "polyline", "defs", "clipPath", "ellipse", "title", "tspan", "image", "pattern", "mask"].includes(m[1]);
  const el = isSvg ? document.createElementNS("http://www.w3.org/2000/svg", m[1]) : document.createElement(m[1] || "div");
  for (const part of (m[2] || "").match(/[.#][\w-]+/g) || []) {
    if (part[0] === ".") el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "on") for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sv === undefined || sv === null) continue;
        if (sk.startsWith("--")) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k === "class") el.setAttribute("class", [el.getAttribute("class"), v].filter(Boolean).join(" "));
    else if (k === "html") el.innerHTML = v;
    else if (k === "title") el.dataset.tip = v; // keine Browser-Tooltips – eigenes <syn-tooltip>
    else if (k in el && !isSvg && k !== "list" && k !== "form") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids.flat(Infinity)) {
    if (k === null || k === undefined || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const clear = (el, ...kids) => { el.replaceChildren(); add(el, kids); return el; };

// Ohne Flackern neu aufbauen: frische Kopie im Hintergrund füllen, dann in einem Schritt austauschen.
export async function rebuild(el, fill) {
  const fresh = el.cloneNode(false);
  fresh.classList.remove("enter");
  await fill(fresh);
  const st = el.scrollTop;
  if (el.isConnected) { el.replaceWith(fresh); fresh.scrollTop = st; }
  return fresh;
}

// dünner Ladebalken, wenn etwas länger als einen Moment dauert
let busyN = 0, busyT;
export function busy(on) {
  busyN = Math.max(0, busyN + (on ? 1 : -1));
  clearTimeout(busyT);
  if (busyN) busyT = setTimeout(() => document.body.classList.add("busy"), 160);
  else document.body.classList.remove("busy");
}
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------------------------------------------------------------- Icons (Linien, 1,8 px, runde Enden)
const P = {
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5"/><path d="M16 4.5a3 3 0 0 1 0 6"/><path d="M18 14c1.7.6 2.8 2.2 3 5"/>',
  circles: '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h7M9 17h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m18 15-6-6-6 6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', check: '<path d="M20 6 9 17l-5-5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="3"/><rect x="14" y="4" width="6" height="6" rx="3"/><rect x="4" y="14" width="6" height="6" rx="3"/><rect x="14" y="14" width="6" height="6" rx="3"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r=".8"/><circle cx="4.5" cy="12" r=".8"/><circle cx="4.5" cy="18" r=".8"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
  rings: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  axes: '<path d="M4 4v16h16"/><circle cx="9" cy="14" r="1.3"/><circle cx="13" cy="9" r="1.3"/><circle cx="17" cy="12" r="1.3"/>',
  net: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="m8.3 7 7.4 1M7 8.4l1.4 7.2M16.3 9.9l-5.6 6.4"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  merge: '<path d="M6 3v6a6 6 0 0 0 6 6h6"/><path d="M18 3v18"/><path d="m15 12 3 3-3 3"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
  paw: '<circle cx="7" cy="9" r="1.8"/><circle cx="12" cy="6.5" r="1.8"/><circle cx="17" cy="9" r="1.8"/><path d="M8 17c0-2.5 1.8-5 4-5s4 2.5 4 5c0 2-1.8 2.5-4 2.5S8 19 8 17z"/>',
  link: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.2"/><path d="M5.5 16c.6-1.6 1.9-2.4 3.5-2.4s2.9.8 3.5 2.4M15 10h3M15 13.5h3"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  pin: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>', logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l-5-5 5-5M5 12h11"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.5v.01"/>',
  bund: '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M10 12h4"/>',
  drag: '<circle cx="9" cy="6" r=".9"/><circle cx="15" cy="6" r=".9"/><circle cx="9" cy="12" r=".9"/><circle cx="15" cy="12" r=".9"/><circle cx="9" cy="18" r=".9"/><circle cx="15" cy="18" r=".9"/>',
  smartphone: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  swap: '<path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/>',
  // Symbole für Kreis- und Bund-Arten
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>',
  graduation: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11v5c3 2 9 2 12 0v-5M22 9v6"/>',
  dumbbell: '<path d="M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 3a14 14 0 0 1 0 18M3.5 9h17M3.5 15h17"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  gamepad: '<rect x="2" y="7" width="20" height="11" rx="5"/><path d="M7 11v3M5.5 12.5h3M15 12h.01M18 13h.01"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3"/>',
  plane: '<path d="M10 20l2-6-7-3v-2l8 1 3-6h2l-1 7 5 1v2l-5 1-3 5z"/>',
  car: '<path d="M5 16l1.5-5A2 2 0 0 1 8.4 9.5h7.2a2 2 0 0 1 1.9 1.5L19 16"/><rect x="3" y="15" width="18" height="4" rx="1.5"/><circle cx="7" cy="19.5" r="1"/><circle cx="17" cy="19.5" r="1"/>',
  tree: '<path d="M12 3 6 11h3l-4 6h14l-4-6h3z"/><path d="M12 17v4"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l2-3h4l2 3"/><circle cx="12" cy="13.5" r="3.5"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2M10 21v-3h4v3"/>',
  baby: '<circle cx="12" cy="8" r="4"/><path d="M10 7.5h.01M14 7.5h.01M10.5 10c1 .7 2 .7 3 0M6 21c0-3.3 2.7-6 6-6s6 2.7 6 6"/>',
  wave: '<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 14.6a1.5 1.5 0 0 1 2.4-1.8L7 14"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 4s0 4 4 4zM12 8s1.5-5 4-4 0 4-4 4z"/>',
  rings2: '<circle cx="9" cy="14" r="5"/><circle cx="15" cy="14" r="5"/><path d="m10 5 2-2 2 2"/>',
  church: '<path d="M12 2v4M10 4h4M6 21V11l6-5 6 5v10M3 21h18M10 21v-4a2 2 0 0 1 4 0v4"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  mountain: '<path d="m3 20 6-11 4 7 2-3 6 7z"/>',
  bike: '<circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M14 6h2"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
};
export const ICON_NAMES = () => Object.keys(P);
export const KIND_ICON_SET = ["home", "heart", "users", "briefcase", "book", "graduation", "dumbbell", "ball", "bike", "music", "gamepad",
  "coffee", "plane", "car", "tree", "mountain", "flag", "camera", "code", "palette", "globe", "building", "church", "baby", "wave", "gift",
  "rings2", "shield", "sparkle", "paw", "star", "pin", "message", "circles", "bund"];
export function icon(name, cls = "") {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "i " + cls);
  s.innerHTML = P[name] || P.question; return s;
}
export const logo = () => h("span.logo", "syn", h("b", "."));

// ---------------------------------------------------------------- Zustand laden
export async function loadBase() {
  const [me, fields, kinds, bk, circles, views] = await Promise.all([
    GET("/me"), GET("/fields"), GET("/circle-kinds"), GET("/bund-kinds"), GET("/circles"), GET("/views")]);
  S.me = me; S.settings = me.settings; S.fieldList = fields; S.fields = Object.fromEntries(fields.map((f) => [f.id, f]));
  S.kinds = Object.fromEntries(kinds.kinds.map((k) => [k.id, k])); S.lose = kinds.lose; S.bundKinds = bk;
  S.circles = Object.fromEntries(circles.map((c) => [c.id, c])); S.views = views;
}
export async function reloadCircles() { const cs = await GET("/circles"); S.circles = Object.fromEntries(cs.map((c) => [c.id, c])); }
export async function reloadFields() { const f = await GET("/fields"); S.fieldList = f; S.fields = Object.fromEntries(f.map((x) => [x.id, x])); }
export async function rows(force = false) {
  if (!S.rows || force || Date.now() - S.rowsAt > 60000) { S.rows = await GET("/entities"); S.rowsAt = Date.now(); }
  return S.rows;
}
export const invalidate = () => { S.rows = null; };

// ---------------------------------------------------------------- Formatierung
export const RING = () => S.settings.ring_names || { 1: "Engste", 2: "Nah", 3: "Mittel", 4: "Weit" };
export const ringName = (l) => (l ? `${l} · ${RING()[l] || ""}` : "–");
export function initials(name) {
  if (!name) return "?";
  const p = name.replace(/[?()]/g, "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] || "") + (p.length > 1 ? p[p.length - 1][0] : (p[0][1] || ""))).toUpperCase();
}
// ---------------------------------------------------------------- Darstellung (Hell/Dunkel)
const THEME_KEY = "syn.theme";
export const themePref = () => { try { return localStorage.getItem(THEME_KEY) || "system"; } catch (_) { return "system"; } };
const mq = matchMedia("(prefers-color-scheme: dark)");
export function applyTheme(pref = themePref()) {
  const dark = pref === "dark" || (pref === "system" && mq.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0F1114" : "#FFD60A");
}
export function setTheme(pref) { try { localStorage.setItem(THEME_KEY, pref); } catch (_) {} applyTheme(pref); dispatchEvent(new Event("syn-theme")); }
mq.addEventListener?.("change", () => { if (themePref() === "system") { applyTheme(); dispatchEvent(new Event("syn-theme")); } });
applyTheme();
export const isDark = () => document.documentElement.dataset.theme === "dark";
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function hueOfHex(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(hex || ""); if (!m) return 0;
  const n = parseInt(m[1], 16); const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return null;
  const hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return Math.round((hh * 60 + 360) % 360);
}
// Im Dunkelmodus: gleiche Farbfamilie, dunkle Fläche und helle Schrift
function themed(bg, fg) {
  if (!isDark()) return { bg, fg };
  const hh = hueOfHex(fg);
  if (hh === null) return { bg: "#262A31", fg: "#C3C8D0" };
  return { bg: `hsl(${hh} 32% 21%)`, fg: `hsl(${hh} 80% 80%)` };
}
export function circleColors(cid) {
  const c = S.circles[cid]; const k = c && S.kinds[c.kind_id];
  return k ? { ...themed(k.bg, k.fg), abbr: k.abbr, kind: k.name } : { ...themed(S.lose.bg, S.lose.fg), abbr: "LO", kind: "Lose" };
}
export function kindColors(kid) { const k = S.kinds[kid]; return k ? themed(k.bg, k.fg) : themed(S.lose.bg, S.lose.fg); }
export const loseColors = () => themed(S.lose.bg, S.lose.fg);

export function parseISO(s) { if (!s || s.includes("?") || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null; return new Date(s.slice(0, 10) + "T12:00:00"); }
export function daysSince(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2}|\?\?)-(\d{2}|\?\?)/.exec(s); if (!m) return null;
  const d = new Date(+m[1], m[2] === "??" ? 0 : +m[2] - 1, m[3] === "??" ? 1 : +m[3], 12);
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
export function rel(s) {
  const d = daysSince(s); if (d === null) return s ? fmtDate(s) : "";
  if (d <= 0) return d === 0 ? "heute" : "in " + -d + " Tagen";
  if (d === 1) return "gestern";
  if (d < 14) return `vor ${d} Tagen`;
  if (d < 70) return `vor ${Math.round(d / 7)} Wochen`;
  if (d < 600) return `vor ${Math.round(d / 30)} Monaten`;
  return `vor ${Math.round(d / 365)} Jahren`;
}
export function fmtDate(s) {
  if (!s) return "";
  return String(s).slice(0, 10);
}
export function fmtTs(s) {
  if (!s) return ""; const d = new Date(s); if (isNaN(d)) return s;
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const isMobile = () => matchMedia("(max-width: 760px)").matches;
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------------------------------------------------------------- Bausteine
export function avatar(row, size = 28, { sel = false, self = false, exact = false } = {}) {
  if (!exact) size = Math.round(size * 1.4); // Profilbilder bewusst groß
  const name = row.display || row.name || row.description;
  const cc = circleColors(row.main_circle_id);
  const unsure = !row.name || row.name_uncertain;
  const el = h("span.av", { style: { "--s": size + "px", background: cc.bg, color: cc.fg } });
  if (row.id && !row.is_self) el.dataset.pid = row.id;
  if (row.is_self || self) el.classList.add("self");
  if (unsure && !row.is_self) el.classList.add("unsure");
  if (sel) el.classList.add("sel");
  if (row.avatar) el.append(h("img", { src: row.avatar, alt: "", loading: "lazy" }));
  else el.append(row.is_self ? "Du" : (!row.name ? "?" : initials(row.name)));
  return el;
}
export function circleChip(cid, { star = false, onRemove = null, role = null } = {}) {
  const c = S.circles[cid]; const cc = circleColors(cid);
  const ki = c && S.kinds[c.kind_id]?.icon;
  return h("span.chip", { style: { background: cc.bg, color: cc.fg } }, star ? icon("star", "xs") : ki ? icon(ki, "xs") : null, c ? c.name : "?", role ? h("span.t3", ` · ${role}`) : null,
    onRemove ? h("button", { title: "Entfernen", on: { click: (e) => { e.preventDefault(); e.stopPropagation(); onRemove(); } } }, icon("x")) : null);
}
export function nameEl(row) {
  const n = row.name || row.description || "Ohne Namen";
  if (!row.name) return h("span", n, " ", h("span.qmark", "ohne Namen"));
  const shown = row.display || n;
  if (row.name_uncertain) return h("span.unsure-val", shown);
  return h("span", shown);
}
export function ringMini(level, size = 22) {
  const svg = h("svg", { viewBox: "0 0 24 24", width: size, height: size, class: "ring-mini" });
  for (let i = 4; i >= 1; i--) svg.append(h("circle", { cx: 12, cy: 12, r: i * 2.6, fill: i === +level ? cssVar("--yellow-light") : "none", stroke: i === +level ? cssVar("--yellow-line") : cssVar("--line"), "stroke-width": 1.2 }));
  svg.append(h("circle", { cx: 12, cy: 12, r: 1.6, fill: cssVar("--ink") }));
  return svg;
}

let toastBox;
export function toast(msg, { err = false, undo = null, action = null, ms = 3800 } = {}) {
  if (!toastBox) { toastBox = h("div.toast-box"); document.body.append(toastBox); }
  const act = action || (undo ? { label: "Rückgängig", run: undo } : null);
  const t = h("div.toast" + (err ? ".err" : ""), h("span", msg), act ? h("button", { on: { click: () => { act.run(); t.remove(); } } }, act.label) : null);
  while (toastBox.children.length > 2) toastBox.firstChild.remove();
  toastBox.append(t); setTimeout(() => t.remove(), act ? 7000 : ms);
}

export function modal(title, body, buttons = [], { wide = false, onClose } = {}) {
  return new Promise((resolve) => {
    const close = (v) => {
      document.removeEventListener("keydown", key); bd.classList.add("leaving");
      setTimeout(() => bd.remove(), 140); onClose?.(); resolve(v);
    };
    let primaryBtn = null;
    const key = (e) => {
      // nur der oberste Dialog reagiert
      if (bd !== [...document.querySelectorAll(".backdrop:not(.leaving)")].pop()) return;
      if (e.key === "Escape") { close(null); return; }
      if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.defaultPrevented || !primaryBtn || primaryBtn.disabled) return;
      const t = e.target;
      if (t.closest?.("textarea, button, a, [contenteditable]")) return; // dort hat Enter eine eigene Bedeutung
      if (document.querySelector(".ctl-pop, .date-pop, .hue-pop, .pop")) return; // offenes Menü/Kalender
      e.preventDefault(); primaryBtn.click();
    };
    const foot = buttons.length ? h("div.dialog-f", buttons.map((b) => h("button.btn" + (b.primary ? ".primary" : "") + (b.danger ? ".danger" : "") + (b.primary ? ".dlg-primary" : ""), {
      on: { click: async () => { if (b.action) { const r = await b.action(); if (r === false) return; close(r ?? b.value ?? true); } else close(b.value ?? null); } } }, b.label))) : null;
    const dlg = h("div.dialog" + (wide ? ".wide" : ""), { role: "dialog" },
      h("div.dialog-h", h("h2", title), h("button.btn.ghost.icon", { on: { click: () => close(null) }, title: "Schließen" }, icon("x"))),
      h("div.dialog-b", body), foot);
    const bd = h("div.backdrop", { on: { mousedown: (e) => { if (e.target === bd) close(null); } } }, dlg);
    bd._close = close;
    primaryBtn = bd.querySelector(".dlg-primary") || bd.querySelector(".dialog-f .btn.danger:last-child");
    document.body.append(bd); document.addEventListener("keydown", key);
    setTimeout(() => dlg.querySelector("input,select,textarea")?.focus(), 30);
  });
}
export const confirmDlg = (title, text, label = "OK", danger = false) =>
  modal(title, h("p", text), [{ label: "Abbrechen", value: false }, { label, value: true, primary: !danger, danger }]);
export async function promptDlg(title, label, value = "", placeholder = "") {
  const inp = h("input.input", { value, placeholder });
  const r = await modal(title, h("label.f", label, inp), [{ label: "Abbrechen", value: null }, { label: "OK", primary: true, action: () => inp.value }]);
  inp.addEventListener?.("keydown", () => {});
  return r;
}

let openPop = null;
export function closePop() { if (openPop) { openPop.remove(); openPop = null; } }
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openPop && !document.querySelector(".date-pop, .hue-pop")) { e.stopPropagation(); closePop(); } }, true);
addEventListener("hashchange", () => { closePop(); document.querySelectorAll(".date-pop, .hue-pop").forEach((x) => x.remove()); });
export function popover(anchor, content, { align = "left", x, y } = {}) {
  closePop();
  const p = h("div.pop", content);
  document.body.append(p);
  const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, bottom: y, top: y };
  let left = align === "right" ? r.right - p.offsetWidth : r.left;
  let top = r.bottom + 6;
  if (left + p.offsetWidth > innerWidth - 8) left = innerWidth - p.offsetWidth - 8;
  if (top + p.offsetHeight > innerHeight - 8) top = Math.max(8, r.top - p.offsetHeight - 6);
  p.style.left = Math.max(8, left) + "px"; p.style.top = top + "px";
  openPop = p;
  setTimeout(() => {
    const off = (e) => { if (!p.contains(e.target) && !e.target.closest?.(".pop")) { document.removeEventListener("mousedown", off, true); if (openPop === p) closePop(); } };
    document.addEventListener("mousedown", off, true);
  });
  return p;
}
// Pfeiltasten in jedem Popover: ↑/↓ wandern durch die Einträge, Enter wählt.
// Solange man tippt, zählt die Maus nicht – erst wenn sie sich wieder bewegt.
function popItems() { return openPop ? [...openPop.querySelectorAll(".menu button:not([disabled]), .menu a, .ip-grid button")].filter((b) => b.offsetParent) : []; }
document.addEventListener("keydown", (e) => {
  if (!openPop || !["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Enter", "Home", "End"].includes(e.key)) return;
  const its = popItems(); if (!its.length) return;
  const grid = openPop.querySelector(".ip-grid");
  const inText = e.target.matches?.("input,textarea") && e.target.closest(".pop");
  if (inText && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
  let i = its.findIndex((b) => b.classList.contains("kfocus"));
  if (e.key === "Enter") { if (i < 0) return; e.preventDefault(); e.stopPropagation(); its[i].click(); return; }
  if (!grid && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
  e.preventDefault(); e.stopPropagation();
  document.body.classList.add("kbd-nav");
  if (i < 0) i = its.findIndex((b) => b.classList.contains("on"));
  const cols = grid && its.every((b) => grid.contains(b)) ? Math.round(grid.offsetWidth / (its[0].offsetWidth || 1)) || 1 : 1;
  const step = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: 1, ArrowLeft: -1 }[e.key];
  const n = e.key === "Home" ? 0 : e.key === "End" ? its.length - 1 : i < 0 ? (step > 0 ? 0 : its.length - 1) : Math.min(its.length - 1, Math.max(0, i + step));
  its.forEach((b) => b.classList.remove("kfocus"));
  its[n].classList.add("kfocus"); its[n].scrollIntoView({ block: "nearest" });
}, true);
document.addEventListener("mousemove", () => { if (document.body.classList.contains("kbd-nav")) { document.body.classList.remove("kbd-nav"); openPop?.querySelectorAll(".kfocus").forEach((b) => b.classList.remove("kfocus")); } }, true);

// Symbolwahl für Kreis- und Bund-Arten: oben die passende Auswahl, darunter jedes Symbol von syn
export function iconPicker(anchor, { value, onPick } = {}) {
  const pick = (n) => { closePop(); onPick(n); };
  const btn = (n) => h("button" + (n === value ? ".on" : ""), { type: "button", title: n, on: { click: () => pick(n) } }, icon(n));
  const rest = ICON_NAMES().filter((n) => !KIND_ICON_SET.includes(n)).sort();
  const q = h("input.input", { placeholder: "Symbol suchen …", style: { width: "100%" } });
  const all = h("div.ip-grid", rest.map(btn));
  q.addEventListener("input", () => { const t = q.value.trim().toLowerCase(); [...all.children].forEach((b) => (b.style.display = !t || b.title.includes(t) ? "" : "none")); });
  const p = popover(anchor, h("div.ip", q,
    h("div.lbl", "Vorschläge"), h("div.ip-grid", KIND_ICON_SET.map(btn)),
    h("div.lbl", "Alle Symbole"), all,
    value ? h("div.menu", h("button", { type: "button", on: { click: () => pick(null) } }, icon("x"), h("span.grow", "Kein Symbol"))) : null));
  setTimeout(() => q.focus(), 20);
  return p;
}
export function iconButton(value, onPick, { title = "Symbol wählen" } = {}) {
  const b = h("button.btn.sm.icon.ip-btn", { type: "button", title });
  const set = (v) => { value = v; clear(b, v ? icon(v) : h("span.t3", "–")); };
  set(value);
  b.addEventListener("click", () => iconPicker(b, { value, onPick: (n) => { set(n); onPick(n); } }));
  return b;
}

export function menu(anchor, items, opts) {
  const m = h("div.menu", items.filter(Boolean).map((it) => it.label && !it.action && !it.href ? h("div.lbl", it.label)
    : it.href ? h("a", { href: it.href, on: { click: closePop } }, it.icon ? icon(it.icon) : null, it.label)
      : h("button" + (it.on ? ".on" : ""), { on: { click: () => { closePop(); it.action(); } } }, it.icon ? icon(it.icon) : null, h("span.grow", it.label), it.hint ? h("span.t3.small", it.hint) : null)));
  return popover(anchor, m, opts);
}

export function pickPerson(anchor, { exclude = [], onPick, allowNew = true, kind } = {}) {
  const inp = h("input.input", { placeholder: "Person suchen …", style: { width: "100%" } });
  const list = h("div.menu", { style: { marginTop: "6px", maxHeight: "300px", overflow: "auto" } });
  const render = async () => {
    const q = inp.value.trim().toLowerCase();
    const all = (await rows()).filter((r) => !exclude.includes(r.id) && (!kind || r.kind === kind));
    const hits = all.filter((r) => !q || [r.display, ...(r.aliases || [])].join(" ").toLowerCase().includes(q)).slice(0, 30);
    first = hits[0];
    const exact = hits.some((r) => r.display.toLowerCase() === q);
    clear(list, hits.length ? hits.map((r, i) => h("button" + (i === 0 && q ? ".on" : ""), { on: { click: () => { closePop(); onPick(r); } } }, avatar(r, 22), h("span.grow", r.display), r.main_circle_id ? h("span.t3.small", S.circles[r.main_circle_id]?.name) : null)) : h("div.lbl", "Niemand gefunden"),
      allowNew && q && !exact ? h("div", { style: { borderTop: "1px solid var(--line)", marginTop: "6px", paddingTop: "6px" } },
        h("button", { on: { click: async () => { closePop(); const e = await POST("/entities", { name: inp.value.trim() }); invalidate(); onPick(e); } } }, icon("plus"), h("span.grow", "Neue Person anlegen: ", h("b", `„${inp.value.trim()}“`)))) : null);
  };
  let first = null;
  inp.addEventListener("input", debounce(render, 120));
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && first && inp.value.trim()) { e.preventDefault(); closePop(); onPick(first); } });
  const p = popover(anchor, h("div", { style: { width: "280px" } }, inp, list));
  render(); setTimeout(() => inp.focus(), 20);
  return p;
}
export function pickCircle(anchor, { exclude = [], onPick, allowNew = true } = {}) {
  const inp = h("input.input", { placeholder: "Kreis suchen …", style: { width: "100%" } });
  const list = h("div.menu", { style: { marginTop: "6px", maxHeight: "320px", overflow: "auto" } });
  let hits = [];
  const render = () => {
    const q = inp.value.trim().toLowerCase();
    hits = Object.values(S.circles).filter((c) => !exclude.includes(c.id) && (!q || c.name.toLowerCase().includes(q))).sort((a, b) => a.name.localeCompare(b.name));
    const exact = Object.values(S.circles).some((c) => c.name.toLowerCase() === q);
    clear(list,
      hits.length ? hits.map((c, i) => h("button" + (i === 0 && q ? ".on" : ""), { on: { click: () => { closePop(); onPick(c); } } }, circleChip(c.id), h("span.grow"),
        c.parent_id ? h("span.t3.small", "in " + (S.circles[c.parent_id]?.name || "")) : h("span.t3.small", circleColors(c.id).kind)))
        : h("div.lbl", q ? "Kein Kreis gefunden" : "Noch keine Kreise"),
      allowNew && q && !exact ? h("div", { style: { borderTop: "1px solid var(--line)", marginTop: "6px", paddingTop: "6px" } },
        h("button", { on: { click: () => newCircleStep(inp.value.trim()) } }, icon("plus"), h("span.grow", "Neuen Kreis anlegen: ", h("b", `„${inp.value.trim()}“`)), icon("right"))) : null);
  };
  const newCircleStep = (name) => {
    const nameIn = h("input.input", { value: name, style: { width: "100%" } });
    let kind = Object.keys(S.kinds)[0];
    const kinds = h("div.row.wrap", { style: { gap: "6px" } });
    const drawKinds = () => clear(kinds, Object.values(S.kinds).map((k) => {
      const c = kindColors(k.id);
      return h("button.chip", { type: "button", style: { background: c.bg, color: c.fg, cursor: "pointer", border: 0, boxShadow: kind === k.id ? `0 0 0 2px var(--white), 0 0 0 4px ${c.fg}` : "none" }, on: { click: () => { kind = k.id; drawKinds(); } } }, k.name);
    }));
    drawKinds();
    const create = async () => {
      if (!nameIn.value.trim()) return nameIn.focus();
      closePop(); const c = await POST("/circles", { name: nameIn.value.trim(), kind_id: kind }); await reloadCircles(); onPick(c);
    };
    nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
    clear(box, h("div.small.t2", "Neuer Kreis"), nameIn, h("div.small.t2", { style: { margin: "10px 0 6px" } }, "Kreis-Art"), kinds,
      h("div.row", { style: { marginTop: "12px", justifyContent: "flex-end" } }, h("button.btn.sm.ghost", { on: { click: () => { clear(box, inp, list); render(); inp.focus(); } } }, "Zurück"),
        h("button.btn.sm.primary", { on: { click: create } }, "Anlegen")));
    setTimeout(() => nameIn.focus(), 20);
  };
  inp.addEventListener("input", render);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter" && hits[0] && inp.value.trim()) { e.preventDefault(); closePop(); onPick(hits[0]); } });
  const box = h("div", { style: { width: "300px" } }, inp, list);
  const p = popover(anchor, box);
  render(); setTimeout(() => inp.focus(), 20);
  return p;
}

export function svgEl(tag, attrs = {}, ...kids) { return h(tag, attrs, ...kids); }
export function download(name, text, mime = "application/json") {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name }); a.click();
}

// ---------------------------------------------------------------- Räumliche Übergänge
// Markierungen in Leisten ([data-seg]) gleiten vom alten zum neuen Eintrag, statt neu zu erscheinen.
export function captureSegs(root) {
  const out = {};
  root.querySelectorAll("[data-seg]").forEach((c) => {
    const on = c.querySelector(".on"); if (!on) return;
    const a = c.getBoundingClientRect(), b = on.getBoundingClientRect();
    out[c.dataset.seg] = { x: b.left - a.left - c.clientLeft + c.scrollLeft, y: b.top - a.top - c.clientTop + c.scrollTop, w: b.width, h: b.height };
  });
  return out;
}
export function animateSegs(root, prev) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.querySelectorAll("[data-seg]").forEach((c) => {
    const old = prev[c.dataset.seg]; const on = c.querySelector(".on");
    if (!old || !on) return;
    const a = c.getBoundingClientRect(), b = on.getBoundingClientRect();
    const now = { x: b.left - a.left - c.clientLeft + c.scrollLeft, y: b.top - a.top - c.clientTop + c.scrollTop, w: b.width, h: b.height };
    if (Math.abs(now.x - old.x) < 1 && Math.abs(now.y - old.y) < 1) return;
    const ind = document.createElement("span"); ind.className = "seg-ind";
    Object.assign(ind.style, { left: old.x + "px", top: old.y + "px", width: old.w + "px", height: old.h + "px" });
    c.classList.add("seg-anim"); c.prepend(ind);
    requestAnimationFrame(() => requestAnimationFrame(() => Object.assign(ind.style, { left: now.x + "px", top: now.y + "px", width: now.w + "px", height: now.h + "px" })));
    let done = false;
    const finish = () => { if (done) return; done = true; c.classList.remove("seg-anim"); ind.remove(); };
    ind.addEventListener("transitionend", (e) => { if (e.propertyName === "left" || e.propertyName === "top") finish(); });
    setTimeout(finish, 450); // Sicherheitsnetz
  });
}
