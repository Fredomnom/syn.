// Bausteine, die Handy und Desktop teilen: Person bearbeiten, Feld hinzufügen, Ring wählen, Doppelte-Hinweis.
import { S, h, icon, rows, api, GET, POST, PUT, PATCH, DEL, clear, modal, confirmDlg, invalidate, avatar, circleChip, toast,
  RING, ringMini, pickCircle, reloadFields, popover, closePop } from "./core.js";
import { fieldsFor, editField, TYPE_NAMES, inputFor, sourceName } from "./fields.js";
import { dateInput } from "./date.js";
import { pickAndCrop } from "./crop.js";
import { switchInput, segInput, tagInput } from "./controls.js";

export async function editPerson(e) {
  let avatarUrl = e.avatar;
  const photo = h("div.pd-photo", { title: "Profilbild ändern" });
  const file = h("input", { type: "file", accept: "image/*", style: { display: "none" }, "data-ctl": "1" });
  const drawPhoto = () => clear(photo, avatar({ ...e, avatar: avatarUrl }, 96, { exact: true, self: e.is_self }), h("span.pd-cam", icon("upload")));
  drawPhoto();
  const takeFile = async (f) => { const u = await pickAndCrop(f); if (u) { avatarUrl = u; drawPhoto(); drawHero(); } };
  file.addEventListener("change", () => { takeFile(file.files[0]); file.value = ""; });
  photo.addEventListener("click", () => file.click());
  photo.addEventListener("dragover", (ev) => { ev.preventDefault(); photo.classList.add("drag"); });
  photo.addEventListener("dragleave", () => photo.classList.remove("drag"));
  photo.addEventListener("drop", (ev) => { ev.preventDefault(); photo.classList.remove("drag"); if (ev.dataTransfer.files[0]) takeFile(ev.dataTransfer.files[0]); });
  const heroText = h("div.pd-hero-text");
  const drawHero = () => clear(heroText,
    h("b", e.is_self ? "Dein Profilbild" : "Profilbild"),
    h("span.hint-t", "Klicken oder ein Bild hierher ziehen. Danach kannst du den Ausschnitt wählen."),
    h("div.row", h("button.btn.sm", { type: "button", on: { click: () => file.click() } }, icon("upload"), avatarUrl ? "Ändern" : "Bild wählen"),
      avatarUrl ? h("button.btn.sm.ghost", { type: "button", on: { click: () => { avatarUrl = null; drawPhoto(); drawHero(); } } }, "Entfernen") : null));
  drawHero();
  const first = h("input.input.pd-name", { value: e.first_name || (!e.last_name ? e.name || "" : ""), placeholder: "Vorname" });
  const middle = h("input.input", { value: e.middle_names || "", placeholder: "Weitere Vornamen" });
  const last = h("input.input.pd-name", { value: e.last_name || "", placeholder: "Nachname" });
  const middleRow = h("label.f" + (e.middle_names ? "" : ".hidden"), "Weitere Vornamen", middle);
  const showMiddle = h("button.btn.sm.ghost" + (e.middle_names ? ".hidden" : ""), { type: "button", style: { alignSelf: "flex-start" }, on: { click: () => { middleRow.classList.remove("hidden"); showMiddle.classList.add("hidden"); middle.focus(); } } }, icon("plus"), "Weitere Vornamen");
  const lastFirst = S.settings.name_order === "last";
  const nameBlock = h("div.pd-names.full",
    lastFirst ? [h("label.f", "Nachname", last), h("label.f", "Vorname", first)] : [h("label.f", "Vorname", first), h("label.f", "Nachname", last)],
    middleRow, showMiddle);
  const unsure = switchInput(e.name_uncertain, "Name unsicher", "Wird gestrichelt mit „?“ angezeigt");
  const desc = h("input.input", { value: e.description || "", placeholder: "z.B. Typ aus dem Fitnessstudio" });
  const aliases = tagInput(e.aliases || [], "Alias eingeben, Enter");
  const kind = segInput([["person", "Mensch"], ["pet", "Haustier"]], e.kind);
  const phone = switchInput(e.on_phone, "Mit Handy synchronisieren", "Unabhängig von der Sync-Regel");
  const vf = dateInput(e.valid_from || "", { placeholder: "leer = Erfasst-Datum" });
  const body = h("div.pd", h("div.pd-hero", photo, heroText, file),
    h("div.pd-grid",
      nameBlock,
      e.is_self ? null : h("div.full", unsure.el),
      e.is_self ? null : h("label.f", "Beschreibung", desc),
      e.is_self ? null : h("div.f", "Art", kind.el),
      h("div.f.full", "Aliase – Suchen treffen auch diese", aliases.el),
      e.is_self ? null : h("label.f", "Kennst du seit (gültig von)", vf),
      e.is_self ? null : h("div.full", phone.el)));
  const r = await modal(e.is_self ? "Mein Profil" : "Person bearbeiten", body, [
    e.is_self ? null : { label: "Löschen", danger: true, action: async () => {
      if (!(await confirmDlg("Wirklich löschen?", `„${e.display}“ und alle Werte werden gelöscht. Mit Rückgängig lässt sich das zurückholen.`, "Löschen", true))) return false;
      await DEL("/entities/" + e.id); invalidate(); location.hash = "#/"; return "deleted"; } },
    { label: "Abbrechen", value: null },
    { label: "Speichern", primary: true, action: async () => {
      const body = { first_name: first.value, middle_names: middle.value, last_name: last.value, aliases: aliases.get(), avatar: avatarUrl };
      if (!e.is_self) Object.assign(body, { name_uncertain: unsure.get(), description: desc.value, kind: kind.get(), on_phone: phone.get(), valid_from: vf.value || null });
      try { return await PATCH("/entities/" + e.id, body); } catch (_) { return false; }
    } }].filter(Boolean));
  if (r) invalidate();
  return r;
}

// Feld hinzufügen: vorhandenes Feld wählen oder neues Feld anlegen
export async function addField(e, { onDone } = {}) {
  const has = (f) => (e.fields?.[f.id] || []).some((v) => !v.deprecated);
  const all = fieldsFor(e.kind);
  const close = () => document.querySelector(".backdrop:not(.leaving)")?._close?.(null);
  const open = async (f, addNew) => { close(); const r = await editField(f, e.fields?.[f.id] || [], `/entities/${e.id}/fields/${f.id}`, { addNew }); if (r) onDone?.(r); };
  const item = (f, hint) => h("button", { on: { click: () => open(f, has(f)) } }, h("span.grow", f.name), hint ? h("span.t3.small", hint) : null, h("span.tag", TYPE_NAMES[f.type]));
  const fresh = all.filter((f) => !has(f));
  const more = all.filter((f) => has(f) && f.multi);
  const single = all.filter((f) => has(f) && !f.multi);
  const q = h("input.input", { placeholder: "Feld suchen …" });
  const list = h("div.menu", { style: { maxHeight: "46vh", overflow: "auto" } });
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const m = (f) => !t || f.name.toLowerCase().includes(t);
    clear(list,
      fresh.filter(m).length ? [h("div.lbl", "Neu"), fresh.filter(m).map((f) => item(f))] : null,
      more.filter(m).length ? [h("div.lbl", "Weiteren Wert ergänzen"), more.filter(m).map((f) => item(f, `${(e.fields[f.id] || []).filter((v) => !v.deprecated).length} vorhanden`))] : null,
      single.filter(m).length ? [h("div.lbl", "Schon ausgefüllt – bearbeiten"), single.filter(m).map((f) => item(f, "bearbeiten"))] : null);
  };
  q.addEventListener("input", draw);
  draw();
  const list0 = h("div.col", { style: { gap: "8px" } }, q, list);
  const nn = h("input.input", { placeholder: "Neues Feld, z.B. Lieblingsband" });
  const nt = h("select.input", Object.entries(TYPE_NAMES).map(([k, v]) => h("option", { value: k }, v)));
  const multi = h("input", { type: "checkbox" });
  await modal("Feld hinzufügen", h("div.col", list0, h("div.sep"),
    h("h3", "Eigenes Feld anlegen"), h("div.row", nn, nt), h("label.check", multi, "mehrere Werte mit Label"),
    h("button.btn", { style: { alignSelf: "flex-start" }, on: { click: async () => {
      if (!nn.value.trim()) return;
      const f = await POST("/fields", { name: nn.value.trim(), type: nt.value, scope: e.kind, multi: multi.checked,
        options: nt.value === "choice" ? { choices: [], multiple: true } : {} });
      await reloadFields();
      document.querySelector(".backdrop:not(.leaving)")?._close?.(null);
      const r = await editField(S.fields[f.id], [], `/entities/${e.id}/fields/${f.id}`); if (r) onDone?.(r);
    } } }, icon("plus"), "Anlegen")), []);
}

export function ringPopup(anchor, current, onPick) {
  const names = RING();
  const box = h("div.ring-pop",
    h("div.small.t2", { style: { marginBottom: "8px" } }, "Ring"),
    h("div.ring-opts", [1, 2, 3, 4].map((n) => h("button.btn" + (current === n ? ".primary" : ""), {
      on: { click: () => { closePop(); onPick(n); } } }, h("b", n), h("span.tiny", names[n])))),
    h("button.btn.sm.ghost", { style: { marginTop: "6px", width: "100%" }, on: { click: () => { closePop(); onPick(null); } } }, "Ohne Ring"),
    h("div.tiny.t3", { style: { marginTop: "6px" } }, "Tasten 1–4 im Diagramm, oder ziehen."));
  const p = popover(anchor, box);
  const key = (ev) => { if (/^[1-4]$/.test(ev.key)) { closePop(); onPick(+ev.key); } if (ev.key === "Escape" || !document.body.contains(p)) document.removeEventListener("keydown", key); };
  document.addEventListener("keydown", key);
  return p;
}

export async function setRing(eid, level) {
  await PUT(`/entities/${eid}/ring`, { level }); invalidate();
}

export function dupHint(e, { desktop = false, onChange } = {}) {
  if (!e.duplicates?.length) return null;
  const d = e.duplicates[0];
  return h("div.hint", icon("eye"),
    h("div.grow", h("b", "Vielleicht schon bekannt? "), `„${d.other_name}“ – ${d.reasons.join(", ")}.`,
      h("div.row.wrap", { style: { marginTop: "8px" } },
        desktop ? h("a.btn.sm.dark", { href: `#/merge/${d.other_id}/${e.id}` }, icon("merge"), "Zusammenführen") : h("span.small.t2", "Am Desktop prüfen und zusammenführen."),
        h("a.btn.sm", { href: "#/p/" + d.other_id }, "Ansehen"),
        h("button.btn.sm", { on: { click: async () => { await POST("/duplicates/distinct", { a: d.a, b: d.b }); toast("Als verschiedene Personen markiert"); onChange?.(); } } }, "Verschiedene Personen"),
        h("button.btn.sm.ghost", { on: { click: async () => { await POST("/duplicates/later", { a: d.a, b: d.b }); onChange?.(); } } }, "Später"))));
}

export function bundKindName(id) { return S.bundKinds.find((k) => k.id === id)?.name || "–"; }

// Bund-Editor: links die eine, rechts die andere Seite, dazwischen die Linie mit der Bund-Art.
// Unter den Namen stehen die Rollen; der Knopf in der Mitte tauscht sie.
function bundEditor(left, right, { kind_id = "", roleLeft = "", roleRight = "" } = {}) {
  let kind = kind_id || "";
  const kindOf = () => S.bundKinds.find((k) => k.id === kind);
  const rl = h("input.bd-role", { value: roleLeft || kindOf()?.role_a || "", placeholder: "Rolle" });
  const rr = h("input.bd-role", { value: roleRight || kindOf()?.role_b || "", placeholder: "Rolle" });
  const sel = h("select.input.bd-kind", h("option", { value: "" }, "Ohne Art"), S.bundKinds.map((k) => h("option", { value: k.id, selected: k.id === kind }, k.name)));
  sel.addEventListener("change", () => { kind = sel.value; const k = kindOf(); rl.value = k?.role_a || ""; rr.value = k?.role_b || ""; });
  const swap = h("button.btn.sm.icon.bd-swap", { type: "button", title: "Rollen tauschen", on: { click: () => { [rl.value, rr.value] = [rr.value, rl.value]; swap.classList.toggle("spin"); } } }, icon("refresh"));
  const side = (row, role) => h("div.bd-side", avatar(row, 76, { exact: true, self: row.is_self }), h("div.bd-name", row.is_self ? "Du" : row.display || row.name), role);
  const el = h("div.bd", side(left, rl), h("div.bd-mid", h("div.bd-line"), sel, h("div.bd-line"), swap), side(right, rr));
  return { el, get: () => ({ kind_id: kind || null, roleLeft: rl.value.trim() || null, roleRight: rr.value.trim() || null }) };
}
async function selfRow() {
  const all = await rows();
  return all.find((r) => r.is_self) || { is_self: true, display: "Du" };
}

export async function editIhrZwei(e) {
  const me = await selfRow();
  const iz = e.ihr_zwei || {};
  const selfIsA = !iz.a_id || iz.a_id === me.id;
  const ed = bundEditor(me, e, { kind_id: iz.kind_id, roleLeft: selfIsA ? iz.role_a : iz.role_b, roleRight: selfIsA ? iz.role_b : iz.role_a });
  const r = await modal("Ihr zwei", h("div.col", ed.el, h("p.small.t3", "Die Bund-Art setzt die Rollen beider Seiten. Rollen lassen sich auch frei benennen.")),
    [{ label: "Abbrechen" }, { label: "Speichern", primary: true, action: () => {
      const v = ed.get();
      return PUT(`/entities/${e.id}/ihr-zwei`, { kind_id: v.kind_id, role_a: selfIsA ? v.roleLeft : v.roleRight, role_b: selfIsA ? v.roleRight : v.roleLeft }).catch(() => false);
    } }]);
  if (r) invalidate();
  return r;
}

export async function editBund(e, b) {
  const all = await rows();
  const other = all.find((r) => r.id === b.other_id) || { display: b.other_name, name: b.other_name };
  const ed = bundEditor(e, other, { kind_id: b.kind_id, roleLeft: b.role_self, roleRight: b.role_other });
  const r = await modal("Bund", h("div.col", ed.el), [{ label: "Abbrechen" }, { label: "Speichern", primary: true, action: () => {
    const v = ed.get();
    return PATCH("/bunds/" + b.id, { kind_id: v.kind_id, role_a: b.self_is_a ? v.roleLeft : v.roleRight, role_b: b.self_is_a ? v.roleRight : v.roleLeft }).catch(() => false);
  } }]);
  if (r) invalidate();
  return r;
}

export async function addBund(e, otherRow) {
  const first = S.bundKinds[0];
  const ed = bundEditor(e, otherRow, { kind_id: first?.id });
  const since = dateInput("", { placeholder: "seit (optional)" });
  const r = await modal("Neuer Bund", h("div.col", ed.el, h("label.f", "Gültig von", since),
    h("p.small.t3", "Ein Bund ist eine Beziehung zwischen genau zwei Lebewesen.")),
    [{ label: "Abbrechen" }, { label: "Anlegen", primary: true, action: () => {
      const v = ed.get();
      return POST("/bunds", { a_id: e.id, b_id: otherRow.id, kind_id: v.kind_id, role_a: v.roleLeft, role_b: v.roleRight, valid_from: since.value || null }).catch(() => false);
    } }]);
  if (r) invalidate();
  return r;
}

export function addToCircle(anchor, e, onDone) {
  pickCircle(anchor, { exclude: (e.memberships || []).filter((m) => m.active).map((m) => m.circle_id), onPick: async (c) => {
    await POST(`/circles/${c.id}/members`, { entity_id: e.id }); invalidate(); onDone?.();
  } });
}

export function historyText(ev) {
  const v = (x) => x === null || x === undefined ? "–" : Array.isArray(x) ? (x.join(", ") || "–") : typeof x === "object" ? (x.type === "service" ? sourceName(x.id) : x.name || x.handle || S.circles[x.id]?.name || (S.rows || []).find((r) => r.id === x.id)?.display || x.id || JSON.stringify(x)) : String(x);
  if (ev.attr === "avatar") return ev.new ? (ev.old ? "Profilbild geändert" : "Profilbild hinzugefügt") : "Profilbild entfernt";
  if (ev.attr === "on_phone") return ev.new ? "Mit Handy synchronisiert" : "Nicht mehr mit Handy synchronisiert";
  if (ev.attr === "role_a" || ev.attr === "role_b") return `Rolle: ${v(ev.old)} → ${v(ev.new)}`;
  if (ev.attr === "kind_id") return `Bund-Art: ${bundKindName(ev.new)}`;
  if (ev.attr === "created") return `Angelegt als „${ev.new?.name || ev.new?.description}“`;
  if (ev.attr === "membership") return ev.new?.until ? `Kreis ${ev.new.name}: bis ${ev.new.until}` : ev.new ? `Kreis ${ev.new.name} hinzugefügt` : `Kreis entfernt`;
  if (ev.attr === "bund") return ev.new ? `Bund mit ${ev.new.name || "?"}` : "Bund entfernt";
  if (ev.attr === "merged") return `Zusammengeführt mit „${ev.old?.name}“`;
  if (ev.attr.endsWith(":meta")) return `${ev.label}: ${Object.keys(ev.new || {}).map((k) => ({ deprecated: "veraltet", uncertain: "unsicher", label: "Label", valid_from: "gültig von", valid_to: "bis" })[k] || k).join(", ")} geändert`;
  if (ev.old === null || ev.old === undefined) return `${ev.label}: ${v(ev.new)}`;
  if (ev.new === null || ev.new === undefined) return `${ev.label} entfernt (${v(ev.old)})`;
  return `${ev.label}: ${v(ev.old)} → ${v(ev.new)}`;
}
