// Pflege-Link /u/<token>: eine Person prüft ihre eigenen Kontaktdaten. Ohne Konto.
// Was sie ändert, wird nicht direkt übernommen – es geht als Vorschlag an die Person, die syn führt.
import { LOCALE, initI18n } from "./i18n.js";
import "./controls.js";
import { dateInput } from "./date.js";

const SYN_SITE = "https://syn.fredomnom.com";
const $ = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v; else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};
const token = decodeURIComponent(location.pathname.replace(/^\/u\//, "").split("/")[0]);
const root = document.getElementById("vk");
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Eingabe je Feldtyp; get() liefert den Wert in derselben Form, wie syn ihn speichert
function editor(f, value, services) {
  const base = { class: "input", "data-1p-ignore": true, autocomplete: "off" };
  if (f.type === "date") { const el = dateInput(value || ""); return { el, get: () => el.value || null }; }
  if (f.type === "address") {
    const v = value && typeof value === "object" ? value : { street: value || "" };
    const ins = ["street", "zip", "city", "country"].map((k) => $("input", { ...base, placeholder: { street: "Straße und Nr.", zip: "PLZ", city: "Ort", country: "Land" }[k], value: v[k] || "", "data-k": k }));
    return { el: $("div", { class: "up-addr" }, ins), get: () => {
      const o = {}; for (const i of ins) if (i.value.trim()) o[i.dataset.k] = i.value.trim();
      if (value && ins.every((i) => i.value.trim() === String(v[i.dataset.k] || "").trim())) return value; // unverändert
      return Object.keys(o).length ? o : null;
    } };
  }
  if (f.type === "profile") {
    const v = value && typeof value === "object" ? value : {};
    const sel = $("select", { class: "input up-svc", "aria-label": "Dienst" }, services.map((s) => $("option", { value: s.id, selected: s.id === v.service }, s.name)));
    const hdl = $("input", { ...base, placeholder: "@name", value: v.handle || v.id || "" });
    const start = v.handle || v.id || "";
    return { el: $("div", { class: "vk-pair" }, sel, hdl), get: () => {
      const x = hdl.value.trim().replace(/^@/, "");
      if (value && x === start && sel.value === v.service) return value; // unverändert → genau der alte Wert
      return x ? { service: sel.value, handle: x } : null;
    } };
  }
  const type = { phone: "tel", email: "email", url: "url" }[f.type] || "text";
  const el = $("input", { ...base, type, value: value ?? "", placeholder: { phone: "+49 …", email: "name@beispiel.de" }[f.type] || "" });
  return { el, get: () => el.value.trim() || null };
}

async function main() {
  let d;
  try { const r = await fetch(`/api/v1/public/update/${encodeURIComponent(token)}`); if (!r.ok) throw 0; d = await r.json(); }
  catch (_) {
    root.replaceChildren($("div", { class: "vk-card vk-404" }, $("a", { class: "logo", href: SYN_SITE, target: "_blank", rel: "noopener" }, "syn", $("b", {}, ".")),
      $("h1", {}, "Dieser Link gilt nicht mehr"), $("p", {}, "Er ist abgelaufen oder wurde zurückgezogen. Frag einfach nach einem neuen.")));
    return;
  }
  document.title = `Deine Angaben · ${d.owner}`;
  const until = new Date(d.expires_at).toLocaleDateString(LOCALE(), { day: "numeric", month: "long" });
  const rows = []; // { f, old, ed, comment, row }
  const fieldBox = (f) => {
    const list = $("div", { class: "up-list" });
    const addRow = (old) => {
      const ed = editor(f, old, d.services);
      const comment = $("input", { class: "input up-comment", placeholder: "Kommentar (optional), z.B. „seit dem Umzug“", maxlength: 200, "data-1p-ignore": true });
      const it = { f, old, ed, comment, gone: false };
      const x = $("button", { class: "vk-x", type: "button", title: old != null ? "Gilt nicht mehr" : "Entfernen", "aria-label": "Entfernen", onclick: () => {
        if (old == null) { rows.splice(rows.indexOf(it), 1); row.remove(); return; }
        it.gone = !it.gone; row.classList.toggle("gone", it.gone); x.textContent = it.gone ? "↺" : "×"; x.title = it.gone ? "Doch noch gültig" : "Gilt nicht mehr";
        comment.classList.toggle("show", it.gone);
      } }, "×");
      const row = $("div", { class: "up-row" + (old == null ? " new" : "") }, $("div", { class: "up-edit" }, ed.el, x), comment);
      // Kommentarfeld erscheint, sobald sich etwas ändert
      const watch = () => comment.classList.toggle("show", it.gone || !same(ed.get(), old));
      row.addEventListener("input", watch); row.addEventListener("change", watch);
      it.row = row; rows.push(it); list.append(row);
      if (old == null) row.querySelector("input")?.focus();
    };
    const vals = f.values.length ? f.values : [{ value: null }];
    vals.forEach((v) => addRow(v.value));
    return $("div", { class: "f up-field" }, $("span", { class: "up-label" }, f.name), list,
      f.multi ? $("button", { class: "vk-more", type: "button", onclick: () => addRow(null) }, `+ weitere ${f.type === "phone" ? "Nummer" : f.type === "email" ? "Adresse" : "Angabe"}`) : null);
  };
  const name = $("input", { class: "input", value: d.name, autocomplete: "name", "data-1p-ignore": true });
  const msg = $("textarea", { class: "input", rows: 3, placeholder: `Noch etwas für ${d.owner_first}?`, "data-1p-ignore": true });
  const trap = $("input", { name: "website", tabindex: "-1", autocomplete: "off", class: "vk-trap", "aria-hidden": "true" });
  const err = $("p", { class: "vk-err" });
  const send = $("button", { class: "btn primary vk-send", type: "submit" }, `An ${d.owner_first} schicken`);
  const form = $("form", { class: "vk-form", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    const fields = {};
    for (const it of rows) {
      const now = it.gone ? null : it.ed.get();
      if (same(now, it.old)) continue;
      if (it.old == null && now == null) continue;
      (fields[it.f.id] ||= []).push({ old: it.old, value: now, comment: it.comment.value.trim() || null });
    }
    const changedName = name.value.trim() && name.value.trim() !== d.name;
    if (!Object.keys(fields).length && !changedName && !msg.value.trim()) { err.textContent = "Du hast nichts geändert – passt also alles? Dann einfach schließen."; return; }
    send.disabled = true;
    try {
      const r = await fetch(`/api/v1/public/update/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: changedName ? name.value.trim() : null, fields, message: msg.value, website: trap.value }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Das hat nicht geklappt.");
      form.replaceWith($("div", { class: "vk-done" }, $("h2", {}, "Danke!"), $("p", {}, `${d.owner_first} sieht deine Änderungen und übernimmt sie. Du kannst den Link bis ${until} noch einmal öffnen, falls dir etwas einfällt.`)));
    } catch (ex) { err.textContent = ex.message; send.disabled = false; }
  } },
    $("h1", {}, `Hallo ${d.first_name || ""}!`.replace(" !", "!")),
    $("p", { class: "vk-sub" }, `${d.owner} hat diese Angaben von dir. Stimmt noch alles? Ändere, was nicht passt, oder streich, was nicht mehr gilt – ${d.owner_first} bekommt es als Vorschlag und übernimmt es selbst.`),
    $("label", { class: "f" }, "Dein Name", name),
    d.fields.map(fieldBox),
    $("label", { class: "f" }, "Nachricht (optional)", msg), trap, err, send,
    $("p", { class: "up-note" }, `Du siehst nur deine Kontaktdaten. Der Link gilt bis ${until}.`));
  root.replaceChildren($("div", { class: "vk-card" }, form),
    $("a", { class: "vk-foot", href: SYN_SITE, target: "_blank", rel: "noopener" }, "Kontaktbuch ", $("span", { class: "logo" }, "syn", $("b", {}, "."))));
}
initI18n().finally(main);
