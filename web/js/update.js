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
  // ---------------- Freundebuch: Foto (nur mit Immich), Fragen, Unterschrift
  const book = d.book;
  const answers = {};
  let sigDirty = false, sigCanvas = null, photoFile = null, avatarBox = null, avRow = null;
  const bookBox = book ? (() => {
    const qs = book.questions.map((q) => {
      const el = q.type === "note" ? $("textarea", { class: "fb-in", rows: 2, "data-1p-ignore": true }) : $("input", { class: "fb-in", "data-1p-ignore": true });
      el.value = q.value || ""; answers[q.id] = el;
      return $("label", { class: "fb-q" + (q.type === "note" ? " long" : "") }, $("span", { class: "fb-k" }, q.name), el);
    });
    let photo = null;
    if (book.photo) {
      const st = $("span", { class: "fb-ph-t" }, book.has_photo ? "Foto ist schon da – tippen für ein neues" : "Klebe hier dein Bild ein");
      // data-ctl: nicht von syns Bedienelementen umbauen lassen – das Polaroid ist selbst die Fläche (auch zum Hineinziehen)
      const pick = (f) => {
        if (!f || !f.type.startsWith("image/")) return;
        photoFile = f;
        photo.querySelector(".fb-ph-img")?.remove();
        photo.prepend($("img", { class: "fb-ph-img", src: URL.createObjectURL(f), alt: "" }));
        st.textContent = "Wird beim Absenden eingeklebt"; photo.classList.add("done"); avRow.hidden = false;
      };
      const file = $("input", { type: "file", accept: "image/*", class: "fb-file", "data-ctl": "aus", "aria-label": "Foto einkleben", onchange: () => pick(file.files[0]) });
      photo = $("label", { class: "fb-photo" + (book.has_photo ? " done" : ""),
        ondragover: (e) => { e.preventDefault(); photo.classList.add("over"); }, ondragleave: () => photo.classList.remove("over"),
        ondrop: (e) => { e.preventDefault(); photo.classList.remove("over"); pick(e.dataTransfer?.files?.[0]); } }, st, file);
      avatarBox = $("input", { type: "checkbox" });
      avRow = $("label", { class: "fb-av", hidden: true }, avatarBox, " Auch als mein Profilbild vorschlagen");
    }
    // Unterschrift: mit Finger oder Maus zeichnen
    sigCanvas = $("canvas", { class: "fb-sign", width: 600, height: 180 });
    const ctx = sigCanvas.getContext("2d"); ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#1d2a5b";
    let drawing = false;
    const pos = (e) => { const r = sigCanvas.getBoundingClientRect(); return [(e.clientX - r.left) * sigCanvas.width / r.width, (e.clientY - r.top) * sigCanvas.height / r.height]; };
    sigCanvas.addEventListener("pointerdown", (e) => { drawing = true; sigDirty = true; sigCanvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
    sigCanvas.addEventListener("pointermove", (e) => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
    sigCanvas.addEventListener("pointerup", () => (drawing = false));
    const clearSig = $("button", { type: "button", class: "vk-more", onclick: () => { ctx.clearRect(0, 0, sigCanvas.width, sigCanvas.height); sigDirty = false; } }, "Nochmal");
    return $("section", { class: "fb" },
      $("h2", { class: "fb-title" }, "Freundebuch"),
      $("p", { class: "fb-sub" }, `Schreib was für ${d.owner_first} rein – alles freiwillig.`),
      photo, avRow, $("div", { class: "fb-qs" }, qs),
      $("div", { class: "fb-signrow" }, $("span", { class: "fb-k" }, book.has_sign ? "Unterschrift (schon da – neu zeichnen ersetzt sie)" : "Unterschrift"), sigCanvas, clearSig));
  })() : null;

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
    const bookOut = {};
    if (book) for (const q of book.questions) { const v = answers[q.id].value.trim(); if (v && v !== (q.value || "")) bookOut[q.id] = v; }
    const signature = book && sigDirty ? sigCanvas.toDataURL("image/png") : null;
    if (!Object.keys(fields).length && !changedName && !msg.value.trim() && !Object.keys(bookOut).length && !signature && !photoFile) { err.textContent = "Du hast nichts geändert – passt also alles? Dann einfach schließen."; return; }
    send.disabled = true;
    try {
      if (photoFile) { // Foto zuerst – es geht direkt nach Immich
        send.textContent = "Foto wird eingeklebt …";
        const fd = new FormData(); fd.append("file", photoFile); if (avatarBox?.checked) fd.append("as_avatar", "1");
        const pr = await fetch(`/api/v1/public/update/${encodeURIComponent(token)}/photo`, { method: "POST", body: fd });
        if (!pr.ok) throw new Error((await pr.json().catch(() => ({}))).detail || "Das Foto hat nicht geklappt.");
        photoFile = null;
      }
      const r = await fetch(`/api/v1/public/update/${encodeURIComponent(token)}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: changedName ? name.value.trim() : null, fields, message: msg.value, website: trap.value, book: bookOut, signature }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Das hat nicht geklappt.");
      form.replaceWith($("div", { class: "vk-done" }, $("h2", {}, "Danke!"), $("p", {}, (book ? `Dein Freundebuch-Eintrag ist bei ${d.owner_first}. ` : "") + `Änderungen an deinen Kontaktdaten übernimmt ${d.owner_first} selbst. Du kannst den Link bis ${until} noch einmal öffnen, falls dir etwas einfällt.`)));
    } catch (ex) { err.textContent = ex.message; send.disabled = false; send.textContent = `An ${d.owner_first} schicken`; }
  } },
    $("h1", {}, `Hallo ${d.first_name || ""}!`.replace(" !", "!")),
    $("p", { class: "vk-sub" }, `${d.owner} hat diese Angaben von dir. Stimmt noch alles? Ändere, was nicht passt, oder streich, was nicht mehr gilt – ${d.owner_first} bekommt es als Vorschlag und übernimmt es selbst.`),
    $("div", { class: "up-cols" },
      $("div", { class: "up-col" }, $("label", { class: "f" }, "Dein Name", name), d.fields.map(fieldBox)),
      bookBox ? $("div", { class: "up-col up-col-book" }, bookBox) : null),
    $("label", { class: "f" }, "Nachricht (optional)", msg), trap, err, send,
    $("p", { class: "up-note" }, `Du siehst nur deine Kontaktdaten. Der Link gilt bis ${until}.`));
  root.classList.toggle("has-book", !!bookBox);
  root.replaceChildren($("div", { class: "vk-card" }, form),
    $("a", { class: "vk-foot", href: SYN_SITE, target: "_blank", rel: "noopener" }, "Kontaktbuch ", $("span", { class: "logo" }, "syn", $("b", {}, "."))));
}
initI18n().finally(main);
