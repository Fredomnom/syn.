"""Fotos aus Immich auf der Personenseite: Liste je Person und ein Durchreicher für die Bilder.

Der Browser spricht nie direkt mit Immich – der API-Schlüssel bleibt auf dem Server. Durchgereicht wird nur ein Foto,
das syn beim Import einer Person dieses Kontos zugeordnet hat.
"""
import random

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from .. import db, model
from ..auth import Ctx, current
from ..importe import get_config
from ..importers.immich import base_url

router = APIRouter(prefix="/api/v1", tags=["Fotos"])
_client = httpx.Client(timeout=30, follow_redirects=True)


def person_ids(uid, eid) -> list[str]:
    """Immich-Personen, die zu diesem Eintrag gehören (Profil-Feld mit Dienst „immich“)."""
    vals = model.get_values("entity", eid, include_deprecated=True).get("f_profile", [])
    return [str(v["value"].get("id")) for v in vals
            if isinstance(v["value"], dict) and v["value"].get("service") == "immich" and v["value"].get("id")]


@router.get("/entities/{eid}/photos")
def photos(eid: str, random_n: int | None = None, limit: int = 500, ctx: Ctx = Depends(current)):
    """Fotos einer Person, neueste zuerst. random_n=8 liefert eine zufällige Auswahl (für die Diashow)."""
    model.get_entity(ctx.uid, eid)
    pids = person_ids(ctx.uid, eid)
    if not pids:
        return {"total": 0, "items": [], "immich": None}
    q = ",".join("?" * len(pids))
    rows = db.q(f"SELECT asset_id, MAX(taken_at) AS taken_at FROM immich_assets WHERE user_id=? AND person_id IN ({q}) "
                f"GROUP BY asset_id ORDER BY taken_at DESC", ctx.uid, *pids)
    faces = {r["asset_id"]: r for r in db.q(f"SELECT asset_id, x, y FROM immich_faces WHERE user_id=? AND person_id IN ({q})",
                                            ctx.uid, *pids)}
    items = [{"id": r["asset_id"], "taken_at": r["taken_at"],
              "face": ({"x": faces[r["asset_id"]]["x"], "y": faces[r["asset_id"]]["y"]} if r["asset_id"] in faces
                       and faces[r["asset_id"]]["x"] is not None else None)} for r in rows]
    total = len(items)
    if random_n:
        items = random.sample(items, min(random_n, total))
    base = base_url(get_config(ctx.uid, "immich"))
    return {"total": total, "items": items[:max(1, min(limit, 5000))], "immich": base or None}


@router.get("/immich/assets/{asset_id}")
def asset(asset_id: str, size: str = "thumbnail", ctx: Ctx = Depends(current)):
    if size not in ("thumbnail", "preview"):
        raise HTTPException(400, "Größe: thumbnail oder preview")
    if not db.val("SELECT 1 FROM immich_assets WHERE user_id=? AND asset_id=?", ctx.uid, asset_id):
        raise HTTPException(404, "Foto nicht gefunden")
    cfg = get_config(ctx.uid, "immich")
    if not cfg.get("api_key"):
        raise HTTPException(404, "Immich ist nicht verbunden")
    try:
        r = _client.get(f"{base_url(cfg)}/api/assets/{asset_id}/thumbnail", params={"size": size},
                        headers={"x-api-key": cfg["api_key"].strip()})
    except httpx.HTTPError:
        raise HTTPException(502, "Immich nicht erreichbar") from None
    if r.status_code != 200:
        raise HTTPException(502 if r.status_code >= 500 else 404, "Immich liefert das Foto nicht")
    return Response(r.content, media_type=r.headers.get("content-type", "image/jpeg"),
                    headers={"Cache-Control": "private, max-age=604800, immutable"})


@router.get("/entities/{eid}/photos/{asset_id}/face")
def face(eid: str, asset_id: str, ctx: Ctx = Depends(current)):
    """Wo auf dem Foto das Gesicht dieser Person ist ({x, y} als Anteil 0–1) – für den Bildausschnitt.
    Wird einmal bei Immich nachgefragt und dann gemerkt (auch „kein Gesicht gefunden“)."""
    model.get_entity(ctx.uid, eid)
    pids = person_ids(ctx.uid, eid)
    if not pids or not db.val(f"SELECT 1 FROM immich_assets WHERE user_id=? AND asset_id=? AND person_id IN ({','.join('?' * len(pids))})",
                              ctx.uid, asset_id, *pids):
        raise HTTPException(404, "Foto nicht gefunden")
    q = ",".join("?" * len(pids))
    hit = db.q1(f"SELECT x, y FROM immich_faces WHERE user_id=? AND asset_id=? AND person_id IN ({q})", ctx.uid, asset_id, *pids)
    if hit:
        return {"x": hit["x"], "y": hit["y"]} if hit["x"] is not None else {"x": None, "y": None}
    cfg = get_config(ctx.uid, "immich")
    if not cfg.get("api_key"):
        raise HTTPException(404, "Immich ist nicht verbunden")
    try:
        r = _client.get(f"{base_url(cfg)}/api/faces", params={"id": asset_id}, headers={"x-api-key": cfg["api_key"].strip()})
        r.raise_for_status()
        faces = r.json()
    except (httpx.HTTPError, ValueError):
        return {"x": None, "y": None}  # nicht merken – vielleicht klappt es beim nächsten Mal
    x = y = None
    for f in faces:
        if (f.get("person") or {}).get("id") in pids and f.get("imageWidth") and f.get("imageHeight"):
            x = (f["boundingBoxX1"] + f["boundingBoxX2"]) / 2 / f["imageWidth"]
            y = (f["boundingBoxY1"] + f["boundingBoxY2"]) / 2 / f["imageHeight"]
            x, y = round(min(1, max(0, x)), 4), round(min(1, max(0, y)), 4)
            break
    db.ex("INSERT OR REPLACE INTO immich_faces(user_id, asset_id, person_id, x, y) VALUES(?,?,?,?,?)",
          ctx.uid, asset_id, pids[0], x, y)
    return {"x": x, "y": y}
