// Notizen (optionales Modul): datiert, Namen werden erkannt, @ verlinkt oder legt neu an, „Dabei“-Zeile oben.
import { S, h, icon, GET, POST, PUT, DEL, clear, modal, rows, invalidate, avatar, pickPerson, today, toast, confirmDlg } from "./core.js";
import { fieldsFor, inputFor } from "./fields.js";

export async function noteEditor(n = null) {
  const all = await rows();
  const dabei = new Set((n?.links || []).filter((l) => l.role === "dabei").map((l) => l.entity_id));
  const day = h("input.input.mono", { value: n?.day || today(), style: { width: "140px" } });
  const ta = h("textarea.input", { rows: 9, value: n?.text || "", placeholder: "Was war los? Namen werden erkannt. @ verlinkt eine Person oder legt eine neue an." });
  const dabeiBox = h("div.row.wrap");
  const drawDabei = () => clear(dabeiBox, h("span.small.t2", "Dabei:"), [...dabei].map((id) => {
    const r = all.find((x) => x.id === id) || { display: id };
    return h("span.chip.sel", r.display, h("button", { on: { click: () => { dabei.delete(id); drawDabei(); } } }, icon("x")));
  }), h("button.btn.sm", { type: "button", on: { click: (e) => pickPerson(e.currentTarget, { exclude: [...dabei], onPick: (r) => { dabei.add(r.id); drawDabei(); } }) } }, icon("plus")));
  drawDabei();
  // @-Verlinkung
  ta.addEventListener("input", () => {
    const pos = ta.selectionStart; const before = ta.value.slice(0, pos);
    const m = /@([\wäöüÄÖÜß-]{0,30})$/.exec(before);
    if (!m) return;
    pickPerson(ta, { onPick: (r) => {
      ta.value = before.slice(0, m.index) + `@[${r.display}](${r.id}) ` + ta.value.slice(pos);
      ta.focus(); invalidate();
    } });
    setTimeout(() => { const i = document.querySelector(".pop input"); if (i) { i.value = m[1]; i.dispatchEvent(new Event("input")); } }, 30);
  });
  const takeBtn = n ? h("button.btn.sm", { type: "button", on: { click: () => takeValue(n, ta, all) } }, icon("download"), "Markierung in Feld übernehmen") : null;
  const seenBtn = n ? h("button.btn.sm", { type: "button", on: { click: async () => {
    for (const id of dabei) await POST("/bulk", { ids: [id], op: "set_field", field: "f_seen", value: day.value });
    invalidate(); toast("„Zuletzt gesehen“ gesetzt");
  } } }, icon("eye"), "Zuletzt gesehen setzen") : null;
  const save = async (extra = {}) => {
    const body = { day: day.value, text: ta.value, dabei: [...dabei], ...extra };
    return n ? PUT("/notes/" + n.id, body) : POST("/notes", body);
  };
  const res = await modal(n ? "Notiz" : "Neue Notiz", h("div.col", h("div.row", day, h("span.grow"), takeBtn, seenBtn), dabeiBox, ta,
    h("p.small.t3", "Dabei = wer dabei war. Alle anderen erkannten Namen gelten als „erwähnt“.")), [
    n ? { label: "Löschen", danger: true, action: async () => { if (!(await confirmDlg("Notiz löschen?", "Die Notiz wird gelöscht.", "Löschen", true))) return false; await DEL("/notes/" + n.id); return "deleted"; } } : null,
    { label: "Abbrechen" },
    { label: "Speichern", primary: true, action: async () => {
      let r = await save();
      if (r.questions?.length) {
        const resolve = {}, ignore = [];
        const body = h("div.col", h("p", "Mehrdeutige Namen – wen meinst du?"), r.questions.map((q) => h("div.col",
          h("b", q.text), h("div.row.wrap", q.candidates.map((c) => h("label.check", h("input", { type: "radio", name: "q" + q.text, on: { change: () => { resolve[q.text] = c.id; } } }), c.display)),
            h("label.check", h("input", { type: "radio", name: "q" + q.text, on: { change: () => { delete resolve[q.text]; ignore.push(q.text); } } }), "keine Person")))));
        await modal("Nachfrage", body, [{ label: "Übernehmen", primary: true, value: true }]);
        r = await PUT("/notes/" + r.id, { day: day.value, text: ta.value, dabei: [...dabei], resolve, ignore });
      }
      return r;
    } }].filter(Boolean), { wide: false });
  return res;
}

async function takeValue(n, ta, all) {
  const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
  const linked = n.links.map((l) => all.find((r) => r.id === l.entity_id)).filter(Boolean);
  const who = h("select.input", linked.map((r) => h("option", { value: r.id }, r.display)));
  const fsel = h("select.input");
  const valBox = h("div");
  let inp;
  const drawFields = () => {
    const r = all.find((x) => x.id === who.value);
    clear(fsel, [...fieldsFor(r?.kind || "person"), ...S.fieldList.filter((f) => f.scope === "bund")].map((f) => h("option", { value: f.id }, f.name)));
    drawVal();
  };
  const drawVal = () => { inp = inputFor(S.fields[fsel.value], sel); clear(valBox, inp.el); };
  who.addEventListener("change", drawFields); fsel.addEventListener("change", drawVal);
  if (!linked.length) return toast("Erst eine Person verlinken oder unter „Dabei“ eintragen");
  drawFields();
  const ok = await modal("Wert übernehmen", h("div.col", h("label.f", "Person", who), h("label.f", "Feld", fsel), h("label.f", "Wert", valBox)),
    [{ label: "Abbrechen" }, { label: "Übernehmen", primary: true, action: () => POST(`/notes/${n.id}/take`, { entity_id: who.value, field: fsel.value, value: inp.get() }) }]);
  if (ok) { invalidate(); toast("Übernommen"); }
}
