// Fotos einer Person (aus Immich): Banner, Galerie, Großansicht und Diashow fürs Hover-Popup.
// Die Bilder kommen über syn (/api/v1/immich/assets/…), der Browser braucht keinen Zugang zu Immich.
import { h, icon, GET } from "./core.js";
import { LOCALE } from "./i18n.js";

export const photoUrl = (id, size = "thumbnail") => `/api/v1/immich/assets/${encodeURIComponent(id)}?size=${size}`;
const cache = new Map();
export async function loadPhotos(eid, { random } = {}) {
  const key = eid + (random ? ":r" + random : "");
  if (!random && cache.has(key)) return cache.get(key);
  let d;
  try { d = await GET(`/entities/${eid}/photos` + (random ? `?random_n=${random}` : "")); } catch (_) { d = { total: 0, items: [] }; }
  if (!random) cache.set(key, d);
  return d;
}
const fmtDay = (t) => { try { return t ? new Date(t).toLocaleDateString(LOCALE(), { day: "numeric", month: "long", year: "numeric" }) : ""; } catch (_) { return ""; } };

// Breites Titelbild über der Person: ein zufälliges der neueren Fotos, langsam gleitend; Klick öffnet die Großansicht
export function photoBanner(data) {
  if (!data?.items?.length) return null;
  const pool = data.items.slice(0, 40);
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const img = h("img", { src: photoUrl(pick.id, "preview"), alt: "", loading: "eager", decoding: "async" });
  img.addEventListener("load", () => img.classList.add("in"));
  img.addEventListener("error", () => img.closest(".ph-banner")?.remove()); // Foto nicht (mehr) in Immich
  return h("button.ph-banner", { type: "button", title: "Foto groß zeigen", on: { click: () => lightbox(data, data.items.indexOf(pick)) } }, img);
}

// Galerie-Karte: Raster, lädt beim Scrollen nach, Klick öffnet die Großansicht
export function photoGallery(data, { profileUrl } = {}) {
  if (!data?.total) return null;
  let shown = 0;
  const grid = h("div.ph-grid");
  const more = h("button.btn.sm.ghost.ph-more", { type: "button", on: { click: () => add(48) } });
  const add = (n) => {
    const next = data.items.slice(shown, shown + n);
    next.forEach((it, j) => {
      const img = h("img", { src: photoUrl(it.id), alt: "", loading: "lazy", decoding: "async" });
      img.addEventListener("load", () => img.classList.add("in"));
      img.addEventListener("error", () => img.closest(".ph-cell")?.remove());
      grid.append(h("button.ph-cell", { type: "button", title: fmtDay(it.taken_at), on: { click: () => lightbox(data, shown - next.length + j) } }, img));
    });
    shown += next.length;
    more.textContent = `Mehr zeigen (${data.items.length - shown})`;
    more.style.display = shown >= data.items.length ? "none" : ""; // .btn setzt display, „hidden“ greift dort nicht
  };
  add(24);
  return h("div.card.ph-card",
    h("div.card-h", h("h3", "Fotos"), h("div.row", h("span.small.t2", String(data.total)),
      profileUrl ? h("a.btn.sm.ghost", { href: profileUrl, target: "_blank", rel: "noopener" }, icon("ext"), "In Immich") : null)),
    h("div.card-b.col", { style: { gap: "10px" } }, grid, more));
}

// Großansicht: Pfeiltasten/Wischen blättern, Esc schließt
export function lightbox(data, start = 0) {
  let i = Math.max(0, start);
  const img = h("img.lb-img", { alt: "" });
  const cap = h("div.lb-cap");
  const open = h("a.btn.sm", { target: "_blank", rel: "noopener" }, icon("ext"), "In Immich öffnen");
  const show = () => {
    const it = data.items[i];
    img.classList.remove("in"); img.src = photoUrl(it.id, "preview");
    cap.textContent = [fmtDay(it.taken_at), `${i + 1} / ${data.items.length}`].filter(Boolean).join(" · ");
    open.hidden = !data.immich; if (data.immich) open.href = `${data.immich}/photos/${it.id}`;
    const nx = data.items[i + 1]; if (nx) new Image().src = photoUrl(nx.id, "preview"); // vorladen
  };
  img.addEventListener("load", () => img.classList.add("in"));
  const go = (d) => { i = (i + d + data.items.length) % data.items.length; show(); };
  const close = () => { removeEventListener("keydown", key, true); lb.remove(); };
  const key = (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1);
  };
  let x0 = null;
  const lb = h("div.lightbox", { on: { click: (e) => { if (e.target === lb || e.target === stage) close(); },
    touchstart: (e) => { x0 = e.touches[0].clientX; }, touchend: (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); x0 = null; } } });
  const stage = h("div.lb-stage", img);
  lb.append(stage,
    h("button.lb-nav.prev", { type: "button", "aria-label": "Vorheriges", on: { click: () => go(-1) } }, icon("left")),
    h("button.lb-nav.next", { type: "button", "aria-label": "Nächstes", on: { click: () => go(1) } }, icon("right")),
    h("div.lb-bar", cap, h("span.grow"), open, h("button.btn.sm", { type: "button", on: { click: close } }, icon("x"), "Schließen")));
  document.body.append(lb);
  addEventListener("keydown", key, true);
  show();
}

// Diashow (Hover-Popup): Bilder gleiten langsam durch und blenden ineinander über. Gibt eine Stopp-Funktion zurück.
export function slideshow(box, items, { every = 2800 } = {}) {
  if (!items?.length) return () => {};
  let i = 0, stop = false, t = null;
  const layer = (it) => {
    const im = h("img.ss-img", { src: photoUrl(it.id, "preview"), alt: "" });
    im.style.setProperty("--dx", (Math.random() * 10 - 5).toFixed(1) + "%");
    im.style.setProperty("--dy", (Math.random() * 8 - 4).toFixed(1) + "%");
    im.style.setProperty("--dur", every * 1.6 + "ms");
    im.addEventListener("load", () => { if (!stop) im.classList.add("in"); });
    im.addEventListener("error", () => im.remove());
    box.append(im);
    const old = [...box.querySelectorAll(".ss-img")].slice(0, -2); old.forEach((o) => o.remove());
    if (items.length > 1) new Image().src = photoUrl(items[(i + 1) % items.length].id, "preview");
  };
  layer(items[0]);
  const tick = () => { if (stop) return; i = (i + 1) % items.length; layer(items[i]); t = setTimeout(tick, every); };
  if (items.length > 1) t = setTimeout(tick, every);
  return () => { stop = true; clearTimeout(t); };
}
