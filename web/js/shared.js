// Bausteine, die Handy und Desktop teilen: Person bearbeiten, Feld hinzufügen, Ring wählen, Doppelte-Hinweis.
import { S, h, icon, api, GET, POST, PUT, PATCH, DEL, clear, modal, confirmDlg, invalidate, avatar, circleChip, toast,
  RING, ringMini, pickCircle, reloadFields, popover, closePop } from "./core.js";
import { fieldsFor, editField, TYPE_NAMES, inputFor } from "./fields.js";
import { dateInput } from "./date.js";
import { pickAndCrop } from "./crop.js";

export async function editPerson(e) {
  const name = h("input.input", { value: e.name || "", placeholder: "Name" });
  const unsure = h("input", { type: "checkbox", checked: e.name_uncertain });
  const desc = h("input.input", { value: e.description || "", placeholder: "z.B. Typ aus dem Fitnessstudio" });
  const aliases = h("input.input", { value: (e.aliases || []).join(", "), placeholder: "kommagetrennt" });
  const kind = h("select.input", h("option", { value: "person", selected: e.kind === "person" }, "Mensch"), h("option", { value: "pet", selected: e.kind === "pet" }, "Haustier"));
  const phone = h("input", { type: "checkbox", checked: e.on_phone });
  let avatarUrl = e.avatar;
  const img = h("span", avatar({ ...e, avatar: avatarUrl }, 56));
  const file = h("input", { type: "file", accept: "image/*", on: { change: async () => {
    const u = await pickAndCrop(file.files[0]); file.value = ""; if (u) { avatarUrl = u; clear(img, avatar({ ...e, avatar: avatarUrl }, 56)); } } } });
  const vf = dateInput(e.valid_from || "", { placeholder: "leer = Erfasst-Datum" });
  const body = h("div.col",
    h("div.row", img, h("div.col", file, avatarUrl ? h("button.btn.sm.ghost", { type: "button", on: { click: () => { avatarUrl = null; clear(img, avatar({ ...e, avatar: null }, 56)); } } }, "Bild entfernen") : null)),
    h("label.f", "Name", name), e.is_self ? null : h("label.check", unsure, "Name unsicher (wird mit „?“ gezeigt)"),
    e.is_self ? null : h("label.f", "Beschreibung (solange der Name fehlt)", desc),
    h("label.f", "Aliase – Suchen treffen auch diese", aliases),
    e.is_self ? null : h("label.f", "Art", kind),
    e.is_self ? null : h("label.f", "Gültig von (z.B. seit wann du die Person kennst)", vf),
    e.is_self ? null : h("label.check", phone, "Mit Handy synchronisieren – unabhängig von der Regel"));
  const r = await modal(e.is_self ? "Mein Profil" : "Bearbeiten", body, [
    e.is_self ? null : { label: "Löschen", danger: true, action: async () => {
      if (!(await confirmDlg("Wirklich löschen?", `„${e.display}“ und alle Werte werden gelöscht. Der Verlauf bleibt nicht erhalten.`, "Löschen", true))) return false;
      await DEL("/entities/" + e.id); invalidate(); location.hash = "#/"; return "deleted"; } },
    { label: "Abbrechen", value: null },
    { label: "Speichern", primary: true, action: async () => {
      const body = { name: name.value, aliases: aliases.value.split(",").map((s) => s.trim()).filter(Boolean), avatar: avatarUrl };
      if (!e.is_self) Object.assign(body, { name_uncertain: unsure.checked, description: desc.value, kind: kind.value, on_phone: phone.checked, valid_from: vf.value || null });
      try { return await PATCH("/entities/" + e.id, body); } catch (_) { return false; }
    } }].filter(Boolean));
  if (r) invalidate();
  return r;
}

// Feld hinzufügen: vorhandenes Feld wählen oder neues Feld anlegen
export async function addField(e, { onDone } = {}) {
  const used = new Set(Object.keys(e.fields || {}).filter((k) => (e.fields[k] || []).length));
  const free = fieldsFor(e.kind).filter((f) => !used.has(f.id));
  const list = h("div.menu", free.map((f) => h("button", { on: { click: async () => {
    document.querySelector(".backdrop:not(.leaving)")?._close?.(null);
    const r = await editField(f, [], `/entities/${e.id}/fields/${f.id}`); if (r) onDone?.(r);
  } } }, h("span.grow", f.name), h("span.tag", TYPE_NAMES[f.type]))));
  const nn = h("input.input", { placeholder: "Neues Feld, z.B. Lieblingsband" });
  const nt = h("select.input", Object.entries(TYPE_NAMES).map(([k, v]) => h("option", { value: k }, v)));
  const multi = h("input", { type: "checkbox" });
  await modal("Feld hinzufügen", h("div.col", list.children.length ? list : h("p.t3", "Alle Felder sind schon belegt."), h("div.sep"),
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
  const box = h("div", { style: { width: "250px", padding: "6px" } },
    h("div.small.t2", { style: { marginBottom: "8px" } }, "Ring"),
    h("div.row", { style: { gap: "6px" } }, [1, 2, 3, 4].map((n) => h("button.btn" + (current === n ? ".primary" : ""), { style: { flexDirection: "column", height: "52px", flex: 1, gap: "2px" },
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

export async function editIhrZwei(e) {
  const kind = h("select.input", h("option", { value: "" }, "–"), S.bundKinds.map((k) => h("option", { value: k.id, selected: e.ihr_zwei?.kind_id === k.id }, k.name)));
  const r = await modal("Ihr zwei", h("label.f", "Bund-Art", kind), [{ label: "Abbrechen" }, { label: "Speichern", primary: true, action: () => PUT(`/entities/${e.id}/ihr-zwei`, { kind_id: kind.value || null }) }]);
  if (r) invalidate();
  return r;
}

export async function addBund(e, otherRow) {
  const kind = h("select.input", S.bundKinds.map((k) => h("option", { value: k.id }, k.name)));
  const roleA = h("input.input", { placeholder: `Rolle von ${e.display}` });
  const roleB = h("input.input", { placeholder: `Rolle von ${otherRow.display}` });
  const since = dateInput("", { placeholder: "seit (optional)" });
  const r = await modal(`Bund: ${e.display} & ${otherRow.display}`, h("div.col", h("label.f", "Art", kind), h("div.row", roleA, roleB), h("label.f", "Gültig von", since),
    h("p.small.t3", "Ein Bund ist eine Beziehung zwischen genau zwei Lebewesen. Rollen leer lassen = Standard der Bund-Art.")),
    [{ label: "Abbrechen" }, { label: "Anlegen", primary: true, action: () => POST("/bunds", { a_id: e.id, b_id: otherRow.id, kind_id: kind.value, role_a: roleA.value || null, role_b: roleB.value || null, valid_from: since.value || null }).catch(() => false) }]);
  if (r) invalidate();
  return r;
}

export function addToCircle(anchor, e, onDone) {
  pickCircle(anchor, { exclude: (e.memberships || []).filter((m) => m.active).map((m) => m.circle_id), onPick: async (c) => {
    await POST(`/circles/${c.id}/members`, { entity_id: e.id }); invalidate(); onDone?.();
  } });
}

export function historyText(ev) {
  const v = (x) => x === null || x === undefined ? "–" : Array.isArray(x) ? (x.join(", ") || "–") : typeof x === "object" ? (x.name || x.handle || S.circles[x.id]?.name || x.id || JSON.stringify(x)) : String(x);
  if (ev.attr === "avatar") return ev.new ? (ev.old ? "Profilbild geändert" : "Profilbild hinzugefügt") : "Profilbild entfernt";
  if (ev.attr === "on_phone") return ev.new ? "Mit Handy synchronisiert" : "Nicht mehr mit Handy synchronisiert";
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
