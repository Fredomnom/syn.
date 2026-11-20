"""Universelles Rückgängig/Wiederholen.

Jede ändernde API-Anfrage bildet eine Änderungsgruppe. Datenbank-Trigger halten jede betroffene Zeile vor und nach
der Änderung fest (siehe db.install_undo_triggers). Rückgängig stellt den alten Stand der letzten Gruppe wieder her,
Wiederholen den neuen. Eine neue Änderung nach einem Rückgängig verwirft den Wiederholen-Stapel.
"""
import asyncio
import re

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import db
from ..auth import Ctx, current
from ..util import new_id, now

router = APIRouter(prefix="/api/v1", tags=["Rückgängig"])
KEEP = 200  # Gruppen pro Nutzer

EXCLUDE = re.compile(r"^/api/v1/(auth|instance|tokens|me/password|admin|undo|redo|files|google|routines/test|notes/analyze)"
                     r"|^/api/v1/importers/[^/]+$")
LABELS = [
    (r"POST /entities/quick", "Person erfasst"), (r"POST /entities$", "Person angelegt"),
    (r"(PUT|PATCH) /entities/[^/]+/fields/", "Feld geändert"), (r"PUT /entities/[^/]+/ring", "Ring gesetzt"),
    (r"PUT /entities/[^/]+/ihr-zwei", "„Ihr zwei“ geändert"), (r"POST /entities/[^/]+/actions/", "Schnellaktion"),
    (r"PATCH /entities/", "Person bearbeitet"), (r"DELETE /entities/", "Person gelöscht"),
    (r"POST /seen-today/", "Heute gesehen"), (r"POST /bulk/cells", "Zellen geändert"), (r"POST /bulk", "Mehrere bearbeitet"),
    (r"POST /merge", "Zusammengeführt"), (r"/memberships/[^/]+/end", "Aus Kreis genommen"), (r"/memberships", "Mitgliedschaft geändert"),
    (r"POST /circles/[^/]+/members", "Zu Kreis hinzugefügt"), (r"POST /circles", "Kreis angelegt"), (r"DELETE /circles", "Kreis gelöscht"),
    (r"/circles", "Kreis geändert"), (r"/circle-kinds", "Kreis-Art geändert"), (r"/bund-kinds", "Bund-Art geändert"),
    (r"POST /bunds", "Bund angelegt"), (r"DELETE /bunds", "Bund gelöscht"), (r"/bunds", "Bund geändert"),
    (r"/routines/[^/]+/run", "Routine ausgeführt"), (r"/routines", "Routine geändert"), (r"/fields", "Feld-Definition geändert"),
    (r"/notes", "Notiz geändert"), (r"/suggestions", "Vorschlag"), (r"/duplicates", "Doppelte markiert"), (r"/views", "Ansicht geändert"),
    (r"/today", "Heute"), (r"/importers/[^/]+/run", "Import"), (r"/me/settings|/me/setup|/services", "Einstellungen geändert"),
]


def label_for(method, path):
    p = path.removeprefix("/api/v1")
    key = f"{method} {p}"
    for pat, lab in LABELS:
        if re.search(pat, key):
            return lab
    return "Änderung"


def wants_batch(request: Request) -> bool:
    return request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith("/api/v1/") \
        and not EXCLUDE.search(request.url.path)


def finish(batch: str, label: str):
    """Nach der Anfrage: Gruppe anlegen (falls etwas geändert wurde), Wiederholen-Stapel verwerfen, alte kürzen."""
    try:
        uid = db.val("SELECT user_id FROM undo_log WHERE batch=? AND user_id IS NOT NULL LIMIT 1", batch)
        if not uid:
            db.ex("DELETE FROM undo_log WHERE batch=?", batch)
            return
        with db.tx():
            for b in db.q("SELECT id FROM undo_batches WHERE user_id=? AND state='undone'", uid):
                db.ex("DELETE FROM undo_log WHERE batch=?", b["id"])
            db.ex("DELETE FROM undo_batches WHERE user_id=? AND state='undone'", uid)
            db.insert("undo_batches", {"id": batch, "user_id": uid, "label": label, "at": now(), "state": "done"})
            old = db.q("SELECT id FROM undo_batches WHERE user_id=? ORDER BY at DESC LIMIT -1 OFFSET ?", uid, KEEP)
            for b in old:
                db.ex("DELETE FROM undo_log WHERE batch=?", b["id"])
                db.ex("DELETE FROM undo_batches WHERE id=?", b["id"])
    finally:
        db.close()


def install(app):
    @app.middleware("http")
    async def batch_mw(request: Request, call_next):
        if not wants_batch(request):
            return await call_next(request)
        batch = new_id("ub", 12)
        token = db.BATCH.set(batch)
        try:
            resp = await call_next(request)
        finally:
            db.BATCH.reset(token)
        await asyncio.to_thread(finish, batch, label_for(request.method, request.url.path))
        return resp


def _cols(tbl):
    return [r["name"] for r in db.q(f"PRAGMA table_info({tbl})")]


def apply(batch_id, direction):
    """direction 'undo': alte Stände herstellen (rückwärts). 'redo': neue Stände (vorwärts)."""
    rows = db.q("SELECT * FROM undo_log WHERE batch=? ORDER BY id " + ("DESC" if direction == "undo" else "ASC"), batch_id)
    cache = {}
    with db.tx():
        for r in rows:
            tbl = r["tbl"]
            if tbl not in db.UNDO_TABLES:
                continue
            cols = cache.setdefault(tbl, _cols(tbl))
            want = db.jl(r["old"] if direction == "undo" else r["new"])
            if tbl == "users":  # nur Einstellungen und Name – nie Passwort oder Rechte
                if want:
                    db.ex("UPDATE users SET settings=?, display_name=? WHERE rowid=?", want.get("settings"),
                          want.get("display_name"), r["pk"])
                continue
            if want is None:
                db.ex(f"DELETE FROM {tbl} WHERE rowid=?", r["pk"])
            else:
                vals = [want.get(c) for c in cols]
                db.ex(f"INSERT OR REPLACE INTO {tbl}(rowid,{','.join(cols)}) VALUES(?,{','.join('?' * len(cols))})",
                      r["pk"], *vals)
    return len(rows)


@router.post("/undo")
def undo(ctx: Ctx = Depends(current)):
    b = db.q1("SELECT * FROM undo_batches WHERE user_id=? AND state='done' ORDER BY at DESC, rowid DESC LIMIT 1", ctx.uid)
    if not b:
        raise HTTPException(409, "Nichts zum Rückgängigmachen")
    n = apply(b["id"], "undo")
    db.ex("UPDATE undo_batches SET state='undone' WHERE id=?", b["id"])
    return {"ok": True, "label": b["label"], "rows": n, **state(ctx)}


@router.post("/redo")
def redo(ctx: Ctx = Depends(current)):
    b = db.q1("SELECT * FROM undo_batches WHERE user_id=? AND state='undone' ORDER BY at ASC, rowid ASC LIMIT 1", ctx.uid)
    if not b:
        raise HTTPException(409, "Nichts zum Wiederholen")
    n = apply(b["id"], "redo")
    db.ex("UPDATE undo_batches SET state='done' WHERE id=?", b["id"])
    return {"ok": True, "label": b["label"], "rows": n, **state(ctx)}


@router.get("/undo")
def state(ctx: Ctx = Depends(current)):
    u = db.q1("SELECT label FROM undo_batches WHERE user_id=? AND state='done' ORDER BY at DESC, rowid DESC LIMIT 1", ctx.uid)
    r = db.q1("SELECT label FROM undo_batches WHERE user_id=? AND state='undone' ORDER BY at ASC, rowid ASC LIMIT 1", ctx.uid)
    return {"undo": u["label"] if u else None, "redo": r["label"] if r else None}
