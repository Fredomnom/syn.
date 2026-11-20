"""API für Importe: einrichten, Zeitplan (als Routine), von Hand starten, Dateien hochladen."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import crypto, db
from ..auth import Ctx, current
from ..importe import get_config, registry, run_importer
from ..model import Bad
from ..util import new_id, now

router = APIRouter(prefix="/api/v1", tags=["Importe"])


def _routine(uid, iid):
    return db.q1("SELECT * FROM routines WHERE user_id=? AND system=?", uid, f"import:{iid}")


def _masked(imp, cfg):
    out = {}
    for c in imp.config:
        v = cfg.get(c["key"])
        if v in (None, ""):
            continue
        out[c["key"]] = "••••••" + str(v)[-4:] if c.get("type") == "secret" and len(str(v)) > 8 else (
            "••••" if c.get("type") == "secret" else v)
    return out


@router.get("/importers")
def list_importers(ctx: Ctx = Depends(current)):
    out = []
    for iid, imp in registry().items():
        row = db.q1("SELECT * FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid) or {}
        r = _routine(ctx.uid, iid)
        out.append({**imp.meta(), "enabled": bool(row.get("enabled")), "risk_ack": bool(row.get("risk_ack")),
                    "configured": _masked(imp, get_config(ctx.uid, iid)), "last_run_at": row.get("last_run_at"),
                    "last_status": row.get("last_status"), "last_log": row.get("last_log"),
                    "schedule": db.jl(r["trigger"]) if r else None, "routine_id": r["id"] if r else None})
    return out


class Setup(BaseModel):
    enabled: bool | None = None
    config: dict | None = None
    risk_ack: bool | None = None
    schedule: dict | None = None  # {"every": "daily"|"weekly"|"hourly"|"monthly"|"never", "time": "04:00"}


@router.put("/importers/{iid}")
def setup(iid: str, body: Setup, ctx: Ctx = Depends(current)):
    imp = registry().get(iid)
    if not imp:
        raise HTTPException(404, "Importer ausgeschaltet oder unbekannt")
    row = db.q1("SELECT * FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid)
    if not row:
        db.insert("importer_configs", {"user_id": ctx.uid, "importer_id": iid, "enabled": 0, "state": "{}"})
        row = db.q1("SELECT * FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid)
    if body.risk_ack:
        db.ex("UPDATE importer_configs SET risk_ack=1 WHERE user_id=? AND importer_id=?", ctx.uid, iid)
        row["risk_ack"] = 1
    if body.config is not None:
        cur = get_config(ctx.uid, iid)
        for k, v in body.config.items():
            if isinstance(v, str) and v.startswith("••"):
                continue  # maskierter Wert unverändert
            cur[k] = v
        db.ex("UPDATE importer_configs SET config_enc=? WHERE user_id=? AND importer_id=?",
              crypto.seal(ctx.uid, cur), ctx.uid, iid)
    if body.enabled is not None:
        if body.enabled and imp.unofficial and not row["risk_ack"]:
            raise HTTPException(409, imp.risk or "Inoffizieller Weg – bitte Risiko bestätigen (risk_ack)")
        db.ex("UPDATE importer_configs SET enabled=? WHERE user_id=? AND importer_id=?", int(body.enabled), ctx.uid,
              iid)
    sched = body.schedule
    r = _routine(ctx.uid, iid)
    if body.enabled and not r and sched is None and not imp.accepts_files:
        sched = {"every": "daily", "time": "04:00"}
    if sched is not None:
        if sched.get("every") in (None, "never") or imp.accepts_files and not imp.config:
            if r:
                db.ex("DELETE FROM routines WHERE id=?", r["id"])
        else:
            trig = {"type": "schedule", "every": sched["every"], "time": sched.get("time", "04:00"),
                    "weekday": sched.get("weekday", 0), "day": sched.get("day", 1)}
            if r:
                db.ex("UPDATE routines SET trigger=? WHERE id=?", db.jd(trig), r["id"])
            else:
                db.insert("routines", {"id": new_id("r"), "user_id": ctx.uid, "name": f"Import: {imp.name}",
                                       "enabled": 1, "trigger": db.jd(trig), "conditions": "[]",
                                       "actions": db.jd([{"type": "import", "importer": iid}]), "created_at": now(),
                                       "system": f"import:{iid}"})
    return next(i for i in list_importers(ctx) if i["id"] == iid)


@router.post("/importers/{iid}/run")
async def run(iid: str, request: Request, ctx: Ctx = Depends(current)):
    """Von Hand starten. Datei-Importer: Dateien als multipart (Feld „files“) mitschicken."""
    imp = registry().get(iid)
    if not imp:
        raise HTTPException(404, "Importer ausgeschaltet oder unbekannt")
    files = []
    if request.headers.get("content-type", "").startswith("multipart/"):
        form = await request.form()
        for f in form.getlist("files"):
            files.append((f.filename, await f.read()))
    if imp.accepts_files and not files and not any(c.get("required") for c in imp.config):
        raise Bad("Bitte eine Datei auswählen")
    import asyncio
    status = await asyncio.to_thread(_run_thread, ctx, iid, files)
    row = db.q1("SELECT last_status, last_log FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid)
    return {"status": status, "log": row["last_log"] if row else ""}


def _run_thread(ctx, iid, files):
    try:
        return run_importer(ctx, iid, files)
    finally:
        db.close()


@router.delete("/importers/{iid}")
def reset(iid: str, ctx: Ctx = Depends(current)):
    """Zugangsdaten löschen. Importierte Werte bleiben."""
    db.ex("DELETE FROM importer_configs WHERE user_id=? AND importer_id=?", ctx.uid, iid)
    r = _routine(ctx.uid, iid)
    if r:
        db.ex("DELETE FROM routines WHERE id=?", r["id"])
    return {"ok": True}
