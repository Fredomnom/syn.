// Freundebuch-Teil (Foto, Fragen, Unterschrift) – gemeinsam für Pflege-Link und Visitenkarte
export function bookSection($, book, ownerFirst) {
  const answers = {};
  let sigDirty = false, sigCanvas = null, photoFile = null, avatarBox = null, avRow = null;
  const el = (() => {
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
      $("p", { class: "fb-sub" }, `Schreib was für ${ownerFirst} rein – alles freiwillig.`),
      photo, avRow, $("div", { class: "fb-qs" }, qs),
      $("div", { class: "fb-signrow" }, $("span", { class: "fb-k" }, book.has_sign ? "Unterschrift (schon da – neu zeichnen ersetzt sie)" : "Unterschrift"), sigCanvas, clearSig));
  })();

  return {
    el,
    /** Antworten, die sich gegenüber dem Stand geändert haben, und die Unterschrift (falls gezeichnet) */
    collect() {
      const out = {};
      for (const q of book.questions) { const v = answers[q.id].value.trim(); if (v && v !== (q.value || "")) out[q.id] = v; }
      return { book: out, signature: sigDirty ? sigCanvas.toDataURL("image/png") : null };
    },
    get photoFile() { return photoFile; },
    set photoFile(v) { photoFile = v; },
    get asAvatar() { return !!avatarBox?.checked; },
  };
}
