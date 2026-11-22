"""Immich: jede benannte Person aus der Gesichtserkennung wird eine Person in syn – mit Gesichtsbild, Geburtstag
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
    brings = "Personen aus der Gesichtserkennung mit Gesichtsbild, Geburtstag und ihren Fotos"
    rate = 0.0
    match_by_name = True  # die Namen hast du in Immich selbst vergeben
    steps = [
        'Öffne Immich → Konto (oben rechts) → Kontoeinstellungen → API-Schlüssel → „Neuer API-Schlüssel“.',
        'Rechte: mindestens „person.read“, „asset.read“ und „asset.view“ – oder einfach alle.',
        'Trag hier die Adresse deiner Immich-Instanz ein (z.B. http://192.168.178.76:2283) und den Schlüssel.',
        'Importiert werden alle Personen, denen du in Immich einen Namen gegeben hast. Die Fotos bleiben in Immich.',
    ]
    config = [
        {"key": "url", "label": "Immich-Adresse", "type": "text", "required": True,
         "help": "So, wie syn Immich erreicht, z.B. http://192.168.178.76:2283"},
        {"key": "api_key", "label": "API-Schlüssel", "type": "secret", "required": True,
         "help": "Immich → Kontoeinstellungen → API-Schlüssel"},
    ]

    def fetch(self, cfg, run):
        base = base_url(cfg)
        h = {"x-api-key": cfg["api_key"].strip(), "Accept": "application/json"}
        people, page = [], 1
        run.progress(phase="Personen laden")
        while True:
            r = run.get(f"{base}/api/people", headers=h, params={"page": page, "size": PAGE, "withHidden": "false"}).json()
            people += [p for p in r.get("people", []) if (p.get("name") or "").strip() and not p.get("isHidden")]
            if not r.get("hasNextPage"):
                break
            page += 1
        run.log(f"{len(people)} benannte Personen")
        out, total_assets = [], 0
        run.progress(done=0, total=len(people), phase="Fotos zuordnen")
        for i, p in enumerate(people):
            assets = self._assets(run, base, h, p["id"])
            total_assets += len(assets)
            self._store(run.ctx.uid, p["id"], assets)
            out.append(Contact(
                service_id=p["id"], handle=p["name"].strip(), name=p["name"].strip(),
                url=f"{base}/people/{p['id']}", birthday=p.get("birthDate") or None,
                avatar_url=f"{base}/api/people/{p['id']}/thumbnail", avatar_headers={"x-api-key": h["x-api-key"]},
                seen=assets[0][1][:10] if assets and assets[0][1] else None,  # letztes gemeinsames Foto
            ))
            run.progress(done=i + 1)
        run.log(f"{total_assets} Fotos zugeordnet")
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
