// Öffentliche Visitenkarte: /@name – ohne Anmeldung, ohne Rest der App.
const $ = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const ICONS = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  profile: '<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  address: '<path d="M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  date: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  text: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
};
const ico = (n) => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "i"); s.innerHTML = ICONS[n] || ICONS.text; return s; };
const slug = decodeURIComponent(location.pathname.replace(/^\/@/, "").split("/")[0]);
const root = document.getElementById("vk");

function profileLink(v, services) {
  if (!v || typeof v !== "object") return null;
  if (v.url) return v.url;
  const s = services.find((x) => x.id === v.service); if (!s?.link || s.link.includes("{url}")) return null;
  if (s.link.includes("{id}") && !v.id) return null;
  return s.link.replace("{handle}", encodeURIComponent((v.handle || "").replace(/^@/, ""))).replace("{id}", encodeURIComponent(v.id || ""));
}
function show(f, v, services) {
  const x = v.value;
  if (f.type === "phone") return { text: x, href: "tel:" + String(x).replace(/[^\d+]/g, "") };
  if (f.type === "email") return { text: x, href: "mailto:" + x };
  if (f.type === "profile") {
    const s = services.find((y) => y.id === x?.service);
    return { text: (s ? s.name + " · " : "") + (x?.handle || x?.id || x?.url || ""), href: profileLink(x, services) };
  }
  if (f.type === "address") { const t = typeof x === "object" ? [x.street, [x.zip, x.city].filter(Boolean).join(" "), x.country].filter(Boolean).join(", ") : x; return { text: t, href: "https://www.openstreetmap.org/search?query=" + encodeURIComponent(t) }; }
  if (f.type === "date") { const m = /^(\d{4}|\?{4})-(\d\d)-(\d\d)$/.exec(x || ""); return { text: m ? new Date(2000, +m[2] - 1, +m[3]).toLocaleDateString("de-DE", { day: "numeric", month: "long" }) + (m[1].startsWith("?") ? "" : " " + m[1]) : x }; }
  if (Array.isArray(x)) return { text: x.join(", ") };
  if (x && typeof x === "object") return { text: Object.values(x).filter((y) => y && typeof y !== "object").join(", ") };
  return { text: String(x) };
}
function vcard(c) {
  const esc = (s) => String(s).replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const L = ["BEGIN:VCARD", "VERSION:3.0", "FN:" + esc(c.name)];
  for (const f of c.fields) for (const v of f.values) {
    if (f.type === "phone") L.push("TEL:" + v.value);
    else if (f.type === "email") L.push("EMAIL:" + v.value);
    else if (f.type === "profile") { const u = profileLink(v.value, c.services); if (u) L.push("URL:" + u); }
    else if (f.type === "date" && /^\d{4}-\d\d-\d\d$/.test(v.value)) L.push("BDAY:" + v.value);
  }
  L.push("END:VCARD");
  const a = $("a", { href: URL.createObjectURL(new Blob([L.join("\r\n")], { type: "text/vcard" })), download: (c.name || "kontakt") + ".vcf" });
  document.body.append(a); a.click(); a.remove();
}
function input(f, services) {
  const base = { class: "input", name: f.id, "data-1p-ignore": true, autocomplete: "off" };
  if (f.type === "phone") return { el: $("input", { ...base, type: "tel", autocomplete: "tel", placeholder: "+49 …" }), get: (e) => e.value.trim() };
  if (f.type === "email") return { el: $("input", { ...base, type: "email", autocomplete: "email", placeholder: "name@beispiel.de" }), get: (e) => e.value.trim() };
  if (f.type === "date") return { el: $("input", { ...base, type: "date" }), get: (e) => e.value };
  if (f.type === "profile") {
    // mehrere Profile: jede Zeile Dienst + Name, darunter „+ weiteres Profil“
    const list = $("div", { class: "vk-multi" });
    const rows = [];
    const add = () => {
      const sel = $("select", { class: "input vk-svc", "aria-label": "Dienst" }, services.map((s) => $("option", { value: s.id }, s.name)));
      if (rows.length < services.length) sel.selectedIndex = rows.length;
      const h = $("input", { ...base, name: rows.length ? null : f.id, placeholder: "@name" });
      const row = $("div", { class: "vk-pair" }, sel, h);
      const it = { sel, h, row };
      if (rows.length) row.append($("button", { class: "vk-x", type: "button", "aria-label": "Entfernen", onclick: () => { rows.splice(rows.indexOf(it), 1); row.remove(); } }, "×"));
      rows.push(it); list.append(row); if (rows.length > 1) h.focus();
    };
    add();
    const more = $("button", { class: "vk-more", type: "button", onclick: add }, "+ weiteres Profil");
    return { el: $("div", { class: "vk-multi-wrap" }, list, more), get: () => {
      const v = rows.filter((r) => r.h.value.trim()).map((r) => ({ service: r.sel.value, handle: r.h.value.trim().replace(/^@/, "") }));
      return v.length ? v : null;
    } };
  }
  return { el: $("input", { ...base, type: "text" }), get: (e) => e.value.trim() };
}

async function main() {
  let c;
  try { const r = await fetch(`/api/v1/public/cards/${encodeURIComponent(slug)}`); if (!r.ok) throw 0; c = await r.json(); }
  catch (_) { root.replaceChildren($("div", { class: "vk-card vk-404" }, $("span", { class: "logo" }, "syn", $("b", {}, ".")), $("h1", {}, "Diese Visitenkarte gibt es nicht"), $("p", {}, "Vielleicht hat sich der Link geändert."))); return; }
  document.title = `${c.name} · syn.`;
  const first = c.first_name || c.name.split(" ")[0];
  const initials = c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const head = $("div", { class: "vk-head" },
    c.avatar ? $("img", { class: "vk-av", src: c.avatar, alt: "" }) : $("div", { class: "vk-av vk-av-i" }, initials),
    $("h1", {}, c.name), c.intro ? $("p", { class: "vk-intro" }, c.intro) : null);
  const rows = $("div", { class: "vk-rows" }, c.fields.flatMap((f) => f.values.map((v) => {
    const s = show(f, v, c.services);
    const inner = [$("span", { class: "vk-ic" }, ico(f.type)), $("span", { class: "vk-txt" }, $("span", { class: "vk-k" }, v.label || f.name), $("span", { class: "vk-v" }, s.text))];
    return s.href ? $("a", { class: "vk-row", href: s.href, target: s.href.startsWith("http") ? "_blank" : null, rel: "noopener" }, inner) : $("div", { class: "vk-row" }, inner);
  })));
  const save = c.fields.length ? $("button", { class: "btn vk-save", type: "button", onclick: () => vcard(c) }, ico("download"), "Als Kontakt speichern") : null;

  // Zurückschreiben
  const name = $("input", { class: "input", name: "name", autocomplete: "name", placeholder: "Vor- und Nachname", required: true });
  const asks = c.ask.map((f) => ({ f, ...input(f, c.services) }));
  const msg = $("textarea", { class: "input", rows: 3, placeholder: `Woher kennt ihr euch? Ein Gruß an ${first} …`, "data-1p-ignore": true });
  const trap = $("input", { name: "website", tabindex: "-1", autocomplete: "off", class: "vk-trap", "aria-hidden": "true" });
  const err = $("p", { class: "vk-err" });
  const send = $("button", { class: "btn primary vk-send", type: "submit" }, ico("send"), `An ${first} schicken`);
  const form = $("form", { class: "vk-form", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    if (!name.value.trim()) { err.textContent = "Bitte gib deinen Namen an."; name.focus(); return; }
    const fields = {}; for (const a of asks) { const v = a.get(a.el); if (v) fields[a.f.id] = v; }
    send.disabled = true;
    try {
      const r = await fetch(`/api/v1/public/cards/${encodeURIComponent(slug)}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.value, fields, message: msg.value, website: trap.value }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Das hat nicht geklappt.");
      form.replaceWith($("div", { class: "vk-done" }, $("span", { class: "vk-done-i" }, ico("check")), $("h2", {}, "Angekommen!"), $("p", {}, `${first} hat jetzt deine Angaben.`)));
    } catch (ex) { err.textContent = ex.message; send.disabled = false; }
  } },
    $("h2", {}, "Und du?"), $("p", { class: "vk-sub" }, `Lass ${first} deine Kontaktdaten da – alles ist freiwillig außer dem Namen.`),
    $("label", { class: "f" }, "Name", name),
    asks.map((a) => $("label", { class: "f" }, a.f.name, a.el)),
    $("label", { class: "f" }, "Nachricht", msg), trap, err, send);

  root.replaceChildren($("div", { class: "vk-card vk-me" }, head, c.fields.length ? rows : null, save), $("div", { class: "vk-card vk-reply" }, form),
    $("a", { class: "vk-foot", href: "/" }, "Visitenkarte von ", $("span", { class: "logo" }, "syn", $("b", {}, "."))));
}
main();
