"""Notizen (optionales Modul, standardmäßig aus): datierte Notizen mit Namenserkennung.

Verknüpfungen im Text: @[Anzeigename](p_id). Eine „Dabei“-Liste trennt, wer dabei war, von den Erwähnten.
"""
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db, model
from ..auth import Ctx, current
from ..model import Bad
from ..util import fold, new_id, now, parse_date, today

router = APIRouter(prefix="/api/v1", tags=["Notizen"])
LINK = re.compile(r"@\[([^\]]+)\]\((p_[a-z0-9]+)\)")


def _on(ctx):
    if not ctx.settings.get("notes_enabled"):
        raise HTTPException(400, "Das Notizen-Modul ist ausgeschaltet (Einstellungen → Module)")


def analyze(ctx, text: str):
    """Erkennt Namen. Eindeutige werden verlinkt, mehrdeutige kommen mit Kandidaten zurück."""
    rows = [r for r in model.load_rows(ctx) if not r["is_self"]]
    full, first = {}, {}
    for r in rows:
        for n in [r["name"], *r["aliases"]]:
            if not n:
                continue
            f = fold(n.rstrip("?"))
            if not f:
                continue
            if len(f.split()) > 1:
                full.setdefault(f, set()).add(r["id"])
            first.setdefault(f.split()[0], set()).add(r["id"])
    disp = {r["id"]: r for r in rows}
    explicit = {m.group(2) for m in LINK.finditer(text)}
    plain = LINK.sub(lambda m: " " * len(m.group(0)), text)
    found = []
    taken = [False] * len(plain)
    words = list(re.finditer(r"[A-ZÄÖÜ][\wäöüß\-]+(?:\s+[A-ZÄÖÜ][\wäöüß\-]+)?", plain))
    for m in words:
        span = m.group(0)
        f = fold(span)
        ids = full.get(f)
        start, end = m.start(), m.end()
        if not ids:
            first_tok = span.split()[0]
            ids = first.get(fold(first_tok))
            end = start + len(first_tok)
            span = first_tok
        if not ids or any(taken[start:end]):
            continue
        for i in range(start, end):
            taken[i] = True
        cands = [{"id": i, "display": disp[i]["display"], "circle_id": disp[i]["main_circle_id"]} for i in ids]
        found.append({"text": span, "start": start, "end": end, "candidates": cands,
                      "resolved": cands[0]["id"] if len(cands) == 1 else None})
    return {"mentions": found, "explicit": sorted(explicit)}


@router.post("/notes/analyze")
def analyze_api(body: dict, ctx: Ctx = Depends(current)):
    _on(ctx)
    return analyze(ctx, body.get("text", ""))


class NoteIn(BaseModel):
    day: str | None = None
    text: str
    dabei: list[str] = []
    resolve: dict = {}  # Erwähnungstext -> entity_id (Antwort auf Rückfrage)
    ignore: list[str] = []  # Erwähnungen, die keine Person meinen


def _save_links(ctx, nid, body: NoteIn):
    db.ex("DELETE FROM note_links WHERE note_id=?", nid)
    links = {}
    a = analyze(ctx, body.text)
    for eid in a["explicit"]:
        links[eid] = "erwähnt"
    for m in a["mentions"]:
        if m["text"] in body.ignore:
            continue
        eid = body.resolve.get(m["text"]) or m["resolved"]
        if eid:
            links[eid] = "erwähnt"
    for eid in body.dabei:
        model.get_entity(ctx.uid, eid)
        links[eid] = "dabei"
    for eid, role in links.items():
        db.insert("note_links", {"note_id": nid, "entity_id": eid, "role": role})
    open_q = [m for m in a["mentions"] if not m["resolved"] and m["text"] not in body.resolve
              and m["text"] not in body.ignore]
    return open_q


def note_out(ctx, n):
    links = db.q("SELECT l.entity_id, l.role, e.name, e.description FROM note_links l JOIN entities e ON "
                 "e.id=l.entity_id WHERE l.note_id=?", n["id"])
    return {**n, "links": [{"entity_id": x["entity_id"], "role": x["role"],
                            "display": x["name"] or x["description"]} for x in links]}


@router.get("/notes")
def list_notes(q: str | None = None, entity_id: str | None = None, ctx: Ctx = Depends(current)):
    _on(ctx)
    if entity_id:
        rows = db.q("SELECT n.* FROM notes n JOIN note_links l ON l.note_id=n.id WHERE n.user_id=? AND "
                    "l.entity_id=? ORDER BY n.day DESC", ctx.uid, entity_id)
    else:
        rows = db.q("SELECT * FROM notes WHERE user_id=? ORDER BY day DESC, created_at DESC", ctx.uid)
    if q:
        fq = fold(q)
        rows = [r for r in rows if fq in fold(r["text"])]
    return [note_out(ctx, r) for r in rows]


@router.post("/notes")
def create_note(body: NoteIn, ctx: Ctx = Depends(current)):
    _on(ctx)
    nid = new_id("n")
    with db.tx():
        db.insert("notes", {"id": nid, "user_id": ctx.uid, "day": parse_date(body.day) if body.day else today(),
                            "text": body.text, "created_at": now(), "updated_at": now()})
        open_q = _save_links(ctx, nid, body)
    return {**note_out(ctx, db.q1("SELECT * FROM notes WHERE id=?", nid)), "questions": open_q}


@router.put("/notes/{nid}")
def update_note(nid: str, body: NoteIn, ctx: Ctx = Depends(current)):
    _on(ctx)
    if not db.val("SELECT 1 FROM notes WHERE id=? AND user_id=?", nid, ctx.uid):
        raise HTTPException(404, "Notiz nicht gefunden")
    with db.tx():
        db.ex("UPDATE notes SET text=?, day=?, updated_at=? WHERE id=?", body.text,
              parse_date(body.day) if body.day else today(), now(), nid)
        open_q = _save_links(ctx, nid, body)
    return {**note_out(ctx, db.q1("SELECT * FROM notes WHERE id=?", nid)), "questions": open_q}


@router.delete("/notes/{nid}")
def delete_note(nid: str, ctx: Ctx = Depends(current)):
    _on(ctx)
    db.ex("DELETE FROM note_links WHERE note_id=?", nid)
    db.ex("DELETE FROM notes WHERE id=? AND user_id=?", nid, ctx.uid)
    return {"ok": True}


@router.post("/notes/{nid}/take")
def take_value(nid: str, body: dict, ctx: Ctx = Depends(current)):
    """Aus einer Notiz einen Wert in ein Feld übernehmen."""
    _on(ctx)
    n = db.q1("SELECT * FROM notes WHERE id=? AND user_id=?", nid, ctx.uid)
    if not n:
        raise HTTPException(404, "Notiz nicht gefunden")
    if not body.get("entity_id") or not body.get("field"):
        raise Bad("entity_id und field fehlen")
    d = model.fdef(ctx.uid, body["field"])
    ot, oid = model.owner_for(ctx.uid, body["entity_id"], d)
    if d["multi"]:
        model.add_value(ctx.uid, ot, oid, d, body.get("value"), f"Notiz {n['day']}")
    else:
        model.set_single(ctx.uid, ot, oid, d, body.get("value"), f"Notiz {n['day']}")
    return {"ok": True}
