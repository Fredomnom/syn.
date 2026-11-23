// Kreise auf der Personenseite als Blasen: Profilbild hineinziehen = Mitglied, herausziehen = austragen.
// Vorschläge (blass) per Klick aufnehmen, „+“ sucht alle Kreise. Menüs hängen am Seitenrand (popover) – nichts klippt.
// Änderungen gelten sofort lokal (Blasen gleiten in ihre neue Lage), der Server bekommt sie im Hintergrund.
import { S, h, icon, GET, POST, PATCH, avatar, circleColors, menu, pickCircle, toast, invalidate, reloadCircles, modal, isMobile } from "./core.js";

let W = 560, H = 400, K = 1;   // logische Bühne, auf die Kartenbreite skaliert; am Handy eine eigene, kleinere
const LS = (k, d) => { try { return JSON.parse(localStorage.getItem("syn." + k)) ?? d; } catch (_) { return d; } };
const SAVE = (k, v) => { try { localStorage.setItem("syn." + k, JSON.stringify(v)); } catch (_) {} };
const MAX_BUBBLES = 6;          // mehr Kreise → Liste
const radius = (count, member) => Math.round(K * ((member ? 74 : 44) + Math.min(56, Math.sqrt(count || 1) * (member ? 11 : 5))));

function layout(memberIds, suggIds) {
  const cx = W / 2, cy = H / 2 - 6;
  const ms = memberIds.map((id) => ({ id, member: true, r: radius(S.circles[id]?.count, true) }));
  const avg = ms.length ? ms.reduce((a, c) => a + c.r, 0) / ms.length : 80 * K;
  const d = ms.length <= 1 ? 0 : avg * (ms.length === 2 ? 0.55 : 0.72);        // alle überlappen in der Mitte
  ms.forEach((c, i) => { const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ms.length) + 0.4; c.x = cx + Math.cos(a) * d; c.y = cy + Math.sin(a) * d; });
  const outer = d + avg + 30 * K;
  const ss = suggIds.map((id, i) => {
    const r = radius(S.circles[id]?.count, false), a = -Math.PI / 2 + 0.9 + (2 * Math.PI * (i + 0.5)) / Math.max(3, suggIds.length + 1);
    return { id, member: false, r, x: Math.min(W - r - 6, Math.max(r + 6, cx + Math.cos(a) * (outer + r * 0.35))), y: Math.min(H - r - 6, Math.max(r + 6, cy + Math.sin(a) * (outer * 0.7 + r * 0.3))) };
  });
  const me = ms.length ? { x: ms.reduce((a, c) => a + c.x, 0) / ms.length, y: ms.reduce((a, c) => a + c.y, 0) / ms.length } : { x: 70 * K, y: H - 60 * K };
  for (const c of ms) { // Beschriftung auf der Seite, die von der Person weg zeigt (dort ist der Kreis frei)
    let dx = c.x - me.x, dy = c.y - me.y; const l = Math.hypot(dx, dy);
    if (l < 1) { dx = 0; dy = -1; } else { dx /= l; dy /= l; }
    c.lx = c.r + dx * c.r * 0.4; c.ly = c.r + dy * c.r * 0.42;
  }
  return { ms, ss, me };
}

// Vorschläge: Kreise der Leute, mit denen die Person Bünde hat; sonst die größten
function suggestions(e, all, have) {
  const byId = Object.fromEntries(all.map((r) => [r.id, r]));
  const score = new Map();
  for (const b of e.bunds || []) for (const cid of byId[b.other_id]?.circles || []) if (!have.has(cid)) score.set(cid, (score.get(cid) || 0) + 1);
  let ids = [...score].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (ids.length < 3) ids = ids.concat(Object.values(S.circles).filter((c) => !have.has(c.id) && !ids.includes(c.id)).sort((a, b) => (b.count || 0) - (a.count || 0)).map((c) => c.id));
  return ids.filter((id) => S.circles[id]).slice(0, 3);
}

export function circleBoard(e, all, reload, { list } = {}) {
  const mobile = isMobile();
  if (mobile) { W = 360; H = 330; K = 0.72; } else { W = 560; H = 400; K = 1; }
  const todayIso = new Date().toISOString().slice(0, 10);
  // lokaler Zustand: „Austragen“ setzt bis = heute, hier gilt das sofort (sonst bliebe der Kreis bis morgen „drin“)
  const mem = new Map(e.memberships.filter((m) => m.active && !(m.valid_to && m.valid_to <= todayIso)).map((m) => [m.circle_id, { ...m }]));
  let main = e.main_circle_id;
  let sugg = suggestions(e, all, new Set(mem.keys()));
  let mode = mem.size > MAX_BUBBLES ? "list" : LS("circleview", "bubbles");
  const name = (cid) => S.circles[cid]?.name || "Kreis";
  const body = h("div.cb-body");
  const seg = h("div.seg.sm.cb-seg", [["bubbles", "circles", "Kreise"], ["list", "list", "Liste"]].map(([k, ic, l]) =>
    h("button" + (mode === k ? ".on" : ""), { type: "button", title: l, on: { click: () => { mode = k; SAVE("circleview", k); if (dirty) return reload(); [...seg.children].forEach((b, i) => b.classList.toggle("on", ["bubbles", "list"][i] === k)); drawMode(); } } }, icon(ic))));

  // Server im Hintergrund; schlägt etwas fehl, zeigt die Seite neu den echten Stand
  let dirty = false;
  const server = async (fn, msg) => {
    try { await fn(); dirty = true; invalidate(); if (msg) toast(msg, { action: { label: "Rückgängig", run: () => dispatchEvent(new CustomEvent("syn-undo", { detail: "undo" })) } }); }
    catch (_) { toast("Das hat nicht geklappt", { err: true }); reload(); }
  };
  // Unterkreis ⇒ Oberkreis: wer in einem Unterkreis ist, ist auch im Kreis darüber (der Server erzwingt das ebenso)
  const parentOf = (cid) => S.circles[cid]?.parent_id || null;
  const kidsOf = (cid) => [...mem.keys()].filter((k) => parentOf(k) === cid);
  const join = (cid) => {
    if (!mem.has(cid)) mem.set(cid, { circle_id: cid, pending: true });
    if (!main) main = cid; sugg = sugg.filter((x) => x !== cid);
    const p = parentOf(cid); if (p && !mem.has(p)) join(p);
  };
  const joinServer = async (cid) => {
    const r = await POST(`/circles/${cid}/members`, { entity_id: e.id }); const m = mem.get(cid); if (m) { m.id = r.id; m.pending = false; }
    const p = parentOf(cid), pm = p && mem.get(p);
    if (pm && !pm.id) { // vom Server mit angelegt: dessen ID holen, damit späteres Austragen klappt
      const full = await GET("/entities/" + e.id); const x = full.memberships.find((y) => y.circle_id === p && y.active && !y.valid_to);
      if (x) { pm.id = x.id; pm.pending = false; }
    }
  };
  // Austragen aus einem Oberkreis nimmt die Unterkreise mit (die zuerst – sonst lehnt der Server ab)
  const leave = (cid) => {
    const kids = kidsOf(cid).flatMap((k) => leave(k));
    const m = mem.get(cid); mem.delete(cid); if (!sugg.includes(cid)) sugg = [cid, ...sugg].slice(0, 4); if (main === cid) main = mem.keys().next().value || null;
    return [...kids, m].filter(Boolean);
  };
  const leaveServer = async (ms) => { for (const m of [ms].flat()) if (m?.id) await POST(`/memberships/${m.id}/end`); };
  addEventListener("hashchange", () => { if (dirty) reloadCircles(); }, { once: true });

  const circleMenu = (anchor, cid) => {
    const m = mem.get(cid);
    menu(anchor, [
      { label: name(cid) },
      cid !== main ? { label: "Als Hauptkreis", icon: "star", action: () => { main = cid; render(); server(() => PATCH("/entities/" + e.id, { main_circle_id: cid }), `${name(cid)} ist jetzt Hauptkreis`); } } : null,
      m?.id ? { label: "Rolle, von, bis …", icon: "edit", action: async () => {
        const { dateInput } = await import("./date.js");
        const role = h("input.input", { value: m.role || "" }), vf = dateInput(m.valid_from || ""), vt = dateInput(m.valid_to || "");
        if (await modal("Mitgliedschaft · " + name(cid), h("div.col", h("label.f", "Rolle", role), h("label.f", "Von (leer = Erfasst-Datum, ungefähr)", vf), h("label.f", "Bis", vt)),
          [{ label: "Abbrechen" }, { label: "Speichern", primary: true, action: () => PATCH("/memberships/" + m.id, { role: role.value || null, valid_from: vf.value || null, valid_to: vt.value || null }) }])) {
          m.role = role.value || null; render(); dirty = true; invalidate();
        }
      } } : null,
      { label: "Austragen (bis heute)", icon: "x", action: () => { const old = leave(cid); render(); server(() => leaveServer(old), `Aus ${name(cid)} ausgetragen`); } },
      { label: "Kreis öffnen", icon: "right", action: () => (location.hash = "#/c/" + cid) },
    ], { align: "right" });
  };

  // ---------------------------------------------------------------- Bühne mit bleibenden Elementen
  const stage = h("div.cb-stage", { style: { width: W + "px", height: H + "px" } });
  const wrap = h("div.cb-wrap", stage);
  const fit = () => { const k = Math.min(1.25, (wrap.clientWidth || W) / W); stage.style.transform = `scale(${k})`; wrap.style.height = H * k + "px"; stage._k = k; };
  new ResizeObserver(fit).observe(wrap);
  const els = new Map();     // circle_id → Blase (bleibt, gleitet in die neue Lage)
  const lose = h("div.cb-lose", "In keinem Kreis – steht unter „Lose“. Profilbild in einen Kreis ziehen oder einen Vorschlag anklicken.");
  const meEl = h("div.cb-me", avatar(e, 44));
  const plus = h("button.cb-plus", { type: "button", "aria-label": "Weiteren Kreis wählen oder anlegen", title: "Alle Kreise", on: { click: (ev) => pickCircle(ev.currentTarget, { exclude: [...mem.keys()], onPick: (c) => {
    if (!S.circles[c.id]) S.circles[c.id] = c; // gerade neu angelegt
    join(c.id); render(); server(() => joinServer(c.id), `Neu in ${c.name}`);
  } }) } }, icon("plus"));
  stage.append(lose, plus, meEl);

  const bubbleEl = (cid) => {
    const b = h("button.cb-bubble.enter", { type: "button", on: { click: (ev) => {
      if (mem.has(cid)) return circleMenu(ev.currentTarget, cid);
      join(cid); render(); server(() => joinServer(cid), `Neu in ${name(cid)}`);
    } } });
    b._label = h("span.cb-label"); b.append(b._label);
    stage.insertBefore(b, lose);
    requestAnimationFrame(() => requestAnimationFrame(() => b.classList.remove("enter")));
    return b;
  };

  function render() {
    const { ms, ss, me } = layout([...mem.keys()], sugg);
    const seen = new Set();
    for (const c of [...ss, ...ms]) {
      seen.add(c.id);
      const b = els.get(c.id) || els.set(c.id, bubbleEl(c.id)).get(c.id);
      const col = circleColors(c.id), isMain = c.member && c.id === main;
      b.classList.toggle("on", c.member); b.classList.toggle("sugg", !c.member); b.classList.toggle("main", isMain);
      b.setAttribute("aria-label", name(c.id) + (c.member ? " – Mitglied, Menü" : " – Vorschlag, aufnehmen"));
      Object.assign(b.style, { left: c.x - c.r + "px", top: c.y - c.r + "px", width: 2 * c.r + "px", height: 2 * c.r + "px" });
      b.style.setProperty("--c", col.fg);
      const role = mem.get(c.id)?.role;
      const key = [c.member, isMain, role].join("|");
      if (b._key !== key) { // Beschriftung nur neu bauen, wenn sich etwas daran ändert
        b._key = key;
        b._label.replaceChildren(...[h("span.cb-name", name(c.id)), c.member ? h("span.cb-sub", (isMain ? "★ Hauptkreis" : col.kind) + (role ? " · " + role : "")) : null,
          c.member && !mobile ? h("span.cb-people", all.filter((r) => r.id !== e.id && !r.is_self && r.circles.includes(c.id)).slice(0, 3).map((r) => avatar(r, 14))) : null].filter(Boolean)); // null würde als Text „null“ erscheinen
      }
      // Beschriftung gleitet mit: Mitglied → zur freien Seite, Vorschlag → in die Mitte
      Object.assign(b._label.style, c.member ? { left: c.lx + "px", top: c.ly + "px", maxWidth: Math.round(c.r * 1.0) + "px" } : { left: c.r + "px", top: c.r + "px", maxWidth: Math.round(c.r * 1.6) + "px" });
    }
    for (const [id, b] of els) if (!seen.has(id)) { els.delete(id); b.classList.add("leave"); setTimeout(() => b.remove(), 450); }
    meEl.style.left = me.x + "px"; meEl.style.top = me.y + "px";
    lose.hidden = mem.size > 0;
  }

  // Profilbild ziehen und loslassen (Desktop); am Handy Kreise antippen
  if (!mobile) {
    let drag = null;
    const local = (ev) => { const r = stage.getBoundingClientRect(), k = stage._k || 1; return { x: (ev.clientX - r.left) / k, y: (ev.clientY - r.top) / k }; };
    meEl.addEventListener("pointerdown", (ev) => { drag = true; meEl.setPointerCapture(ev.pointerId); meEl.classList.add("drag"); ev.preventDefault(); });
    meEl.addEventListener("pointermove", (ev) => {
      if (!drag) return; const p = local(ev);
      meEl.style.left = p.x + "px"; meEl.style.top = p.y + "px";
      for (const [, b] of els) { const r = b.getBoundingClientRect(); b.classList.toggle("hover", Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)) < r.width / 2); }
    });
    meEl.addEventListener("pointerup", (ev) => {
      if (!drag) return; drag = null; meEl.classList.remove("drag");
      const p = local(ev);
      const { ms, ss } = layout([...mem.keys()], sugg);
      const hit = new Set([...ms, ...ss].filter((c) => Math.hypot(p.x - c.x, p.y - c.y) < c.r).map((c) => c.id));
      for (const [, b] of els) b.classList.remove("hover");
      // Oberkreise der getroffenen Kreise gelten als getroffen (Unterkreis ⇒ Oberkreis)
      for (const id of [...hit]) { let p = parentOf(id); while (p) { hit.add(p); p = parentOf(p); } }
      const add = [...hit].filter((id) => !mem.has(id)), drop = [...mem.keys()].filter((id) => !hit.has(id));
      const gone = drop.filter((id) => mem.has(id)).flatMap((id) => leave(id));
      add.forEach(join);
      render();
      if (!add.length && !drop.length) return;
      server(async () => { for (const id of add) await joinServer(id); for (const m of gone) await leaveServer(m); },
        [add.length ? "Neu in " + add.map(name).join(" und ") : "", drop.length ? "ausgetragen aus " + drop.map(name).join(" und ") : ""].filter(Boolean).join(" · "));
    });
  }

  const hint = h("p.tiny.t3.cb-hint", mobile ? "Vorschlag antippen = aufnehmen · Kreis antippen = Menü · „+“ für alle Kreise"
    : "Profilbild in Kreise ziehen (oder heraus) · Vorschlag anklicken · Kreis anklicken für Hauptkreis, Rolle und Austragen");
  const bubblesView = h("div.col", { style: { gap: "6px" } }, wrap, hint);
  const drawMode = () => { body.replaceChildren(mode === "list" ? list() : bubblesView); if (mode !== "list") { render(); requestAnimationFrame(fit); } };
  drawMode();
  return { seg: mem.size > MAX_BUBBLES ? null : seg, body };
}
