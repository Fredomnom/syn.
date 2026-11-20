"""Dateien (Profilbilder, Fotos, Import-Dateien) und gespeicherte Ansichten."""
import mimetypes

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from .. import config, db
from ..auth import Ctx, current
from ..model import Bad
from ..util import new_id, now

router = APIRouter(prefix="/api/v1", tags=["Dateien", "Ansichten"])
MAX = 25 * 1024 * 1024


def store_bytes(uid, data: bytes, mime: str) -> str:
    fid = new_id("file", 12)
    d = config.FILES_DIR / uid
    d.mkdir(parents=True, exist_ok=True)
    ext = mimetypes.guess_extension(mime or "") or ".bin"
    p = d / (fid + ext)
    p.write_bytes(data)
    db.insert("files", {"id": fid, "user_id": uid, "mime": mime, "path": str(p.relative_to(config.FILES_DIR)),
                        "created_at": now()})
    return fid


def read_bytes(uid, fid):
    f = db.q1("SELECT * FROM files WHERE id=? AND user_id=?", fid, uid)
    if not f:
        return None, None
    p = config.FILES_DIR / f["path"]
    return (p.read_bytes(), f["mime"]) if p.exists() else (None, None)


@router.post("/files")
async def upload(file: UploadFile = File(...), ctx: Ctx = Depends(current)):
    data = await file.read()
    if len(data) > MAX:
        raise Bad("Datei zu groß (max. 25 MB)")
    fid = store_bytes(ctx.uid, data, file.content_type or "application/octet-stream")
    return {"id": fid, "url": f"/api/v1/files/{fid}", "mime": file.content_type, "size": len(data)}


@router.get("/files/{fid}")
def download(fid: str, ctx: Ctx = Depends(current)):
    f = db.q1("SELECT * FROM files WHERE id=? AND user_id=?", fid, ctx.uid)
    if not f:
        raise HTTPException(404, "Datei nicht gefunden")
    return FileResponse(config.FILES_DIR / f["path"], media_type=f["mime"],
                        headers={"Cache-Control": "private, max-age=86400"})


# ---------------------------------------------------------------- gespeicherte Ansichten

VIEWS = ("grid", "list", "table", "rings", "axes", "net", "duplicates", "circles", "circle_members", "areas")


@router.get("/views")
def views(ctx: Ctx = Depends(current)):
    rows = db.q("SELECT * FROM saved_views WHERE user_id=? ORDER BY position, name", ctx.uid)
    for r in rows:
        r["config"] = db.jl(r["config"], {})
    return rows


@router.post("/views")
def save_view(body: dict, ctx: Ctx = Depends(current)):
    if body.get("view") not in VIEWS:
        raise Bad(f"view muss einer von {', '.join(VIEWS)} sein")
    vid = new_id("v")
    n = db.val("SELECT COUNT(*) FROM saved_views WHERE user_id=?", ctx.uid)
    db.insert("saved_views", {"id": vid, "user_id": ctx.uid, "name": body.get("name") or "Ansicht",
                              "tab": body.get("tab", "people"), "view": body["view"],
                              "config": db.jd(body.get("config") or {}), "position": n})
    return {"id": vid}


@router.put("/views/{vid}")
def update_view(vid: str, body: dict, ctx: Ctx = Depends(current)):
    upd = {k: body[k] for k in ("name", "view", "tab", "position") if k in body}
    if "config" in body:
        upd["config"] = db.jd(body["config"])
    db.update("saved_views", {"id": vid, "user_id": ctx.uid}, upd)
    return {"ok": True}


@router.delete("/views/{vid}")
def delete_view(vid: str, ctx: Ctx = Depends(current)):
    db.ex("DELETE FROM saved_views WHERE id=? AND user_id=?", vid, ctx.uid)
    return {"ok": True}
