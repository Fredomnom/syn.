// Eigene Hover-Elemente statt Browser-Tooltips:
//  <syn-tooltip>     kurzer Hinweis – nur wo er etwas erklärt (Symbol-Knöpfe, Erklärungen), nie als Wiederholung des Texts
//  <syn-personcard>  große Karte mit unscharfem Hintergrund und Eckdaten, wenn man über eine Person fährt
import { S, h, icon, avatar, circleChip, rel, ringName, rows, isMobile } from "./core.js";
import { pretty as prettyDate } from "./date.js";

const canHover = () => matchMedia("(hover: hover) and (pointer: fine)").matches;
const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

// ---------------------------------------------------------------- <syn-tooltip>
class SynTooltip extends HTMLElement {
  connectedCallback() { this.setAttribute("role", "tooltip"); }
  show(target, text) {
    this.textContent = text;
    this.classList.remove("on");
    const r = target.getBoundingClientRect();
    this.style.left = "0px"; this.style.top = "0px";
    const w = this.offsetWidth, hh = this.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.top - hh - 8, below = false;
    if (y < 8) { y = r.bottom + 8; below = true; }
    x = Math.max(8, Math.min(innerWidth - w - 8, x));
    this.style.left = x + "px"; this.style.top = y + "px";
    this.classList.toggle("below", below);
    requestAnimationFrame(() => this.classList.add("on"));
  }
  hide() { this.classList.remove("on"); }
}
customElements.define("syn-tooltip", SynTooltip);

// Ein Hinweis lohnt sich nur, wenn er mehr sagt als der sichtbare Text
function tipWorthy(el) {
  const tip = el.dataset.tip;
  if (!tip) return false;
  const text = norm(el.textContent);
  if (!text) return true; // reiner Symbol-Knopf
  const t = norm(tip);
  return !(t === text || t.startsWith(text) && t.length - text.length < 4 || text.includes(t));
}

// ---------------------------------------------------------------- <syn-personcard>
class SynPersonCard extends HTMLElement {
  render(r) {
    const v = r.v || {};
    const fact = (label, value, mono = false) => value ? h("div.pc-fact", h("span.pc-k", label), h("span.pc-v" + (mono ? ".mono" : ""), value)) : null;
    const others = (r.circles || []).filter((c) => c !== r.main_circle_id).slice(0, 3);
    const bday = v.f_bday?.raw;
    const seen = v.f_seen?.raw;
    const kind = r.bund_kind ? S.bundKinds.find((k) => k.id === r.bund_kind)?.name : null;
    this.replaceChildren(
      h("div.pc-head", avatar(r, 72, { exact: true }),
        h("div.pc-names",
          h("div.pc-name", r.name || r.description || "Ohne Namen", !r.name ? h("span.qmark", "ohne Namen") : r.name_uncertain ? h("span.qmark", "Name ?") : null),
          r.aliases?.length ? h("div.pc-alias", "auch: " + r.aliases.slice(0, 3).join(", ")) : null,
          h("div.pc-chips", r.main_circle_id ? circleChip(r.main_circle_id, { star: true }) : h("span.chip", "Lose"), others.map((c) => circleChip(c)),
            r.kind === "pet" ? h("span.chip.plain", icon("paw", "xs"), "Haustier") : null))),
      h("div.pc-facts",
        S.settings.use_levels ? fact("Ring", r.level ? ringName(r.level) : "ohne Ring") : null,
        r.ist ? fact("Ist", `Ring ${r.ist.ring} · ${rel(r.ist.last)}`) : null,
        kind ? fact("Ihr zwei", kind) : null,
        fact("Zuletzt gesehen", seen ? rel(seen) : "noch nie"),
        bday ? fact("Geburtstag", prettyDate(bday)) : null,
        v.f_met ? fact("Kennengelernt", prettyDate(v.f_met.raw)) : null,
        v.f_via ? fact("Kennengelernt über", v.f_via.d) : null,
        v.f_city ? fact("Wohnort", v.f_city.d) : null,
        v.f_phone ? fact("Telefon", v.f_phone.d, true) : null,
        v.f_email ? fact("E-Mail", v.f_email.d) : null,
        r.long_unseen ? h("div.pc-flag", icon("clock", "xs"), "Nah, aber lange nicht gesehen") : null),
      h("div.pc-foot", "Klicken zum Öffnen"));
  }
  place(target, x, y) {
    const r = target.getBoundingClientRect();
    const w = this.offsetWidth, hh = this.offsetHeight;
    let left = r.right + 14, top = r.top + r.height / 2 - hh / 2;
    if (left + w > innerWidth - 12) left = r.left - w - 14;
    if (left < 12) { left = Math.max(12, Math.min(innerWidth - w - 12, x - w / 2)); top = r.bottom + 12; if (top + hh > innerHeight - 12) top = r.top - hh - 12; }
    top = Math.max(12, Math.min(innerHeight - hh - 12, top));
    this.style.left = left + "px"; this.style.top = top + "px";
  }
}
customElements.define("syn-personcard", SynPersonCard);

// ---------------------------------------------------------------- Steuerung
const tipEl = document.createElement("syn-tooltip");
const cardEl = document.createElement("syn-personcard");
document.body.append(tipEl, cardEl);
let tipT, cardT, tipFor = null, cardFor = null;

function personId(el) {
  const p = el.closest?.("[data-pid]");
  if (p) return [p, p.dataset.pid];
  const a = el.closest?.('a[href^="#/p/"]');
  if (a) return [a, a.getAttribute("href").slice(4).split(/[?/]/)[0]];
  const n = el.closest?.(".viz .node[data-id]");
  if (n) return [n, n.dataset.id];
  return [null, null];
}
let stopShow = () => {};
function hideCard() { clearTimeout(cardT); cardFor = null; cardEl.classList.remove("on"); stopShow(); stopShow = () => {};
  setTimeout(() => { if (!cardFor) { cardEl.querySelector(".pc-banner")?.remove(); cardEl.classList.remove("with-banner"); } }, 200); }
function hideTip() { clearTimeout(tipT); tipFor = null; tipEl.hide(); }

document.addEventListener("mouseover", (e) => {
  if (!canHover() || isMobile()) return;
  const [pEl, pid] = personId(e.target);
  if (pEl && pid && pid !== S.me?.self_id && !pEl.closest(".pc-head")) {
    if (cardFor !== pEl) {
      hideCard(); hideTip(); cardFor = pEl;
      const x = e.clientX, y = e.clientY;
      cardT = setTimeout(async () => {
        let r = (S.rows || []).find((x) => x.id === pid);
        if (!r) { try { r = (await rows()).find((x) => x.id === pid); } catch (_) { return; } }
        if (!r || cardFor !== pEl || !pEl.isConnected) return;
        cardEl.render(r); cardEl.place(pEl, x, y);
        requestAnimationFrame(() => cardEl.classList.add("on"));
        // Fotos aus Immich: zufällige Auswahl läuft als Diashow durch ein Banner oben in der Karte
        const P = await import("./photos.js");
        const pd = await P.loadPhotos(pid, { random: 8 });
        if (!pd.total || cardFor !== pEl) return;
        const ban = h("div.pc-banner");
        cardEl.prepend(ban); cardEl.classList.add("with-banner");
        stopShow = P.slideshow(ban, pd.items);
        cardEl.place(pEl, x, y);
      }, 420);
    }
    return;
  }
  if (cardFor && !cardFor.contains(e.target)) hideCard();
  const t = e.target.closest?.("[data-tip]");
  if (t && t !== tipFor) {
    hideTip();
    if (!tipWorthy(t)) return;
    tipFor = t;
    tipT = setTimeout(() => { if (tipFor === t && t.isConnected) tipEl.show(t, t.dataset.tip); }, 450);
  } else if (!t) hideTip();
});
document.addEventListener("mouseout", (e) => {
  if (tipFor && !tipFor.contains(e.relatedTarget)) hideTip();
  if (cardFor && !cardFor.contains(e.relatedTarget)) hideCard();
});
for (const ev of ["mousedown", "keydown", "scroll", "hashchange"]) addEventListener(ev, () => { hideTip(); hideCard(); }, true);
