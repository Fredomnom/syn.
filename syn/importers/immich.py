"""Immich: jede Person aus der Gesichtserkennung wird eine Person in syn (wie bei anderen Diensten alle Kontakte –
auch ohne Namen: dann als Eintrag ohne Namen, den du später benennst) – mit Gesichtsbild, Geburtstag
und den Fotos, auf denen sie zu sehen ist (als Verweise; die Bilder bleiben in Immich und werden über syn gezeigt).

API (Immich ≥ 1.100, getestet gegen 3.x):
  GET  /api/people?page&size&withHidden=false          benannte und unbenannte Personen
  GET  /api/people/{id}/thumbnail                      Gesichtsausschnitt
  POST /api/search/metadata {personIds, page, size}    Fotos einer Person
Anmeldung: API-Schlüssel im Header x-api-key (Immich → Kontoeinstellungen → API-Schlüssel).
"""
from .. import db
from ..importe import Contact, Importer

PAGE = 500
MAX_PER_PERSON = 2000  # Obergrenze je Person, damit ein Lauf überschaubar bleibt


def base_url(cfg) -> str:
    url = (cfg.get("url") or "").strip().rstrip("/")
    if url and not url.startswith("http"):
        url = "http://" + url
    return url.removesuffix("/api")


class Immich(Importer):
    id = "immich"
    name = "Immich"
    service = "immich"
    way = "Immich-API mit eigenem API-Schlüssel"
    official = "ja"
    brings = "Alle Personen aus der Gesichtserkennung mit Gesichtsbild, Geburtstag und ihren Fotos; Namen aus syn gehen zurück"
    rate = 0.0
    match_by_name = True  # die Namen hast du in Immich selbst vergeben
    steps = [
        'Öffne Immich → Konto (oben rechts) → Kontoeinstellungen → API-Schlüssel → „Neuer API-Schlüssel“.',
        'Rechte: „person.read“, „person.update“ (Namen aus syn zurückschreiben), „asset.read“ und „asset.view“ – oder einfach alle.',
        'Trag hier die Adresse deiner Immich-Instanz ein (z.B. http://192.168.178.76:2283) und den Schlüssel.',
        'Importiert werden alle Personen aus der Gesichtserkennung – ohne Namen als Eintrag „Person von Fotos“. Die Fotos bleiben in Immich.',
    ]
    config = [
        {"key": "url", "label": "Immich-Adresse", "type": "text", "required": True,
         "help": "So, wie syn Immich erreicht, z.B. http://192.168.178.76:2283"},
        {"key": "api_key", "label": "API-Schlüssel", "type": "secret", "required": True,
         "help": "Immich → Kontoeinstellungen → API-Schlüssel"},
        {"key": "min_photos", "label": "Personen ohne Namen erst ab … Fotos", "type": "number", "placeholder": "1",
         "help": "1 = alle. Mit 3 bleiben Zufallsgesichter (nur ein, zwei Fotos) draußen. Benannte Personen kommen immer."},
    ]

    def fetch(self, cfg, run):
        base = base_url(cfg)
        h = {"x-api-key": cfg["api_key"].strip(), "Accept": "application/json"}
        people, page = [], 1
        run.progress(phase="Personen laden")
        while True:
            r = run.get(f"{base}/api/people", headers=h, params={"page": page, "size": PAGE, "withHidden": "true"}).json()
            people += r.get("people", [])
            if not r.get("hasNextPage"):
                break
            page += 1
        named = sum(1 for p in people if (p.get("name") or "").strip())
        run.log(f"{len(people)} Personen, davon {named} mit Namen")
        out, total_assets = [], 0
        run.progress(done=0, total=len(people), phase="Fotos zuordnen")
        try:
            min_photos = max(1, int(cfg.get("min_photos") or 1))
        except ValueError:
            min_photos = 1
        skipped = 0
        for i, p in enumerate(people):
            assets = self._assets(run, base, h, p["id"])
            if not (p.get("name") or "").strip() and len(assets) < min_photos:
                skipped += 1  # unbenannt und zu wenige Fotos: eher ein Zufallsgesicht
                run.progress(done=i + 1)
                continue
            total_assets += len(assets)
            self._store(run.ctx.uid, p["id"], assets)
            name = (p.get("name") or "").strip() or None
            out.append(Contact(
                service_id=p["id"], handle=name, name=name,
                description=None if name else f"Person von Fotos ({len(assets)} Foto{'' if len(assets) == 1 else 's'})",
                url=f"{base}/people/{p['id']}", birthday=p.get("birthDate") or None,
                avatar_url=f"{base}/api/people/{p['id']}/thumbnail", avatar_headers={"x-api-key": h["x-api-key"]},
                seen=assets[0][1][:10] if assets and assets[0][1] else None,  # letztes gemeinsames Foto
            ))
            run.progress(done=i + 1)
        run.log(f"{total_assets} Fotos zugeordnet" + (f", {skipped} unbenannte Personen mit weniger als {min_photos} Fotos übersprungen" if skipped else ""))
        return out

    @staticmethod
    def _assets(run, base, h, person_id):
        """Fotos (und Videos) einer Person, neueste zuerst: [(asset_id, Aufnahmezeit)]"""
        out, page = [], 1
        while page and len(out) < MAX_PER_PERSON:
            r = run.post(f"{base}/api/search/metadata", headers=h,
                         json={"personIds": [person_id], "page": page, "size": 250, "order": "desc"}).json()
            a = r.get("assets") or {}
            for it in a.get("items", []):
                out.append((it["id"], it.get("localDateTime") or it.get("fileCreatedAt") or ""))
            page = a.get("nextPage")
            page = int(page) if page else None
        return out

    @staticmethod
    def _store(uid, person_id, assets):
        with db.tx():
            db.ex("DELETE FROM immich_assets WHERE user_id=? AND person_id=?", uid, person_id)
            for aid, at in assets:
                db.ex("INSERT OR IGNORE INTO immich_assets(user_id, person_id, asset_id, taken_at) VALUES(?,?,?,?)",
                      uid, person_id, aid, at or None)


IMPORTER = Immich()


def push_names(uid, eid):
    """Name aus syn nach Immich schreiben – für jede Immich-Person dieses Eintrags, deren Name dort abweicht.
    Braucht das Recht „person.update“. Fehler bremsen syn nicht aus, sie landen nur im Log."""
    import logging

    import httpx

    from ..importe import get_config
    log = logging.getLogger("syn.immich")
    cfg = get_config(uid, "immich")
    e = db.q1("SELECT name, name_uncertain FROM entities WHERE id=? AND user_id=?", eid, uid)
    if not cfg.get("api_key") or not e or not e["name"] or e["name_uncertain"]:
        return 0
    name, n = e["name"], 0
    for v in db.q("SELECT id, value FROM field_values WHERE user_id=? AND owner_type='entity' AND owner_id=? "
                  "AND field_id='f_profile'", uid, eid):
        val = db.jl(v["value"])
        if not isinstance(val, dict) or val.get("service") != "immich" or not val.get("id") or val.get("handle") == name:
            continue
        try:
            r = httpx.put(f"{base_url(cfg)}/api/people/{val['id']}", json={"name": name}, timeout=6,
                          headers={"x-api-key": cfg["api_key"].strip()})
            r.raise_for_status()
        except httpx.HTTPError as ex:
            log.warning("Name nach Immich schreiben (%s): %s", val["id"], ex)
            continue
        val["handle"] = name
        db.ex("UPDATE field_values SET value=? WHERE id=?", db.jd(val), v["id"])
        n += 1
    return n
