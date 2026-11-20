"""Legt Beispieldaten über die API an (alle Namen ausgedacht).

  python scripts/demo_daten.py http://localhost:8080 benutzer passwort
Beim ersten Start legt das Skript das Konto als Admin an.
"""
import sys
from datetime import date, timedelta

import httpx

base, user, pw = (sys.argv[1:4] + [None] * 3)[:3]
base = base or "http://localhost:8080"
user, pw = user or "demo", pw or "demo1234"
c = httpx.Client(base_url=base + "/api/v1", timeout=30)
if c.get("/instance").json()["needs_setup"]:
    tok = c.post("/instance/setup", json={"username": user, "password": pw, "display_name": "Fred"}).json()["token"]
else:
    tok = c.post("/auth/login", json={"username": user, "password": pw}).json()["token"]
c.headers["Authorization"] = f"Bearer {tok}"
c.post("/me/setup", json={"use_levels": True, "use_ist": True,
                          "sync": {"mode": "rule", "match": "any", "rules": [{"type": "level", "max": 3}]}})
c.patch("/me/settings", json={"notes_enabled": True})
d = lambda n: (date.today() - timedelta(days=n)).isoformat()


def circle(name, kind, parent=None):
    return c.post("/circles", json={"name": name, "kind_id": kind, "parent_id": parent}).json()["id"]


def person(name, circles=(), level=None, fields=None, kind="person", desc=None, unsure=False):
    body = {"name": name, "description": desc, "kind": kind, "circles": list(circles), "level": level,
            "fields": fields or {}, "name_uncertain": unsure}
    r = c.post("/entities", json=body)
    r.raise_for_status()
    return r.json()["id"]


fam = circle("Familie", "familie")
fr = circle("Freunde", "freundschaft")
schule = circle("Gymnasium", "schule")
klasse = circle("Klasse PBM3H25A", "schule", schule)
arbeit = circle("Agentur", "arbeit")
boulder = circle("Bouldern", "hobby")
fit = circle("Fitnessstudio", "hobby")

mama = person("Mama", [fam], 1, {"f_seen": d(4), "f_bday": "1965-05-04", "f_phone": ["+49 171 5550001"], "f_meet": 40})
papa = person("Papa", [fam], 1, {"f_seen": d(4), "f_bday": "1963-11-30", "f_phone": ["+49 171 5550002"]})
heinz = person("Opa Heinz", [fam], 2, {"f_seen": d(77), "f_bday": "Herbst 1940"})
person("Bello", [fam], 2, {"f_species": "Hund", "f_breed": "Beagle", "f_seen": d(4)}, kind="pet")
lisa = person("Lisa Krämer", [fr, boulder], 2, {"f_seen": d(8), "f_bday": "????-03-14", "f_phone": ["+49 151 5550678"],
                                                "f_email": ["lisa.k@example.com"], "f_city": "Köln",
                                                "f_profile": [{"service": "instagram", "handle": "lisa.kraemer"}],
                                                "f_study": "Mediendesign", "f_met": "2025-05", "f_meet": 12})
c.put(f"/entities/{lisa}/ihr-zwei", json={"kind_id": "freundschaft"})
c.patch(f"/entities/{lisa}", json={"aliases": ["Lisi"]})
ben = person("Ben Koch", [fr], 2, {"f_seen": d(56), "f_bday": "2005-04-09", "f_phone": ["+49 152 5550334"]})
noah = person("Noah", [fr], 3, {"f_seen": d(20)})
mia = person("Mia", [fr], 3, {"f_seen": d(15), "f_profile": [{"service": "instagram", "handle": "mia.draws"}]})
clara = person("Clara Seidel", [fr], 4, {"f_seen": d(110), "f_met": "2024-08"})
kai = person("Kai Reuter", [klasse], None, {"f_phone": ["0151 5550911"]})
mx = person("Max Berger", [klasse], 3, {"f_seen": d(2), "f_bday": "2004-07-02", "f_profile": [{"service": "github", "handle": "maxb"}]})
jonas = person("Jonas", [klasse], 3, {"f_seen": d(1)}, unsure=True)
person("Elif Yıldız", [schule], 4, {"f_profile": [{"service": "instagram", "handle": "elif.y"}]})
tim = person("Tim Okafor", [arbeit], 3, {"f_seen": d(49), "f_company": "Agentur", "f_position": "Designer"})
person("Sandra", [arbeit], 4, {"f_bday": "1990-06-??"})
sophie = person("Sophie Wendt", [boulder], 2, {"f_seen": d(11), "f_phone": ["+49 160 5550391"], "f_train": ["Mittwoch"]})
person("Leo", [boulder], None, {"f_seen": d(30)})
person(None, [], None, {"f_seen": d(0), "f_met": d(0)}, desc="Typ aus dem Fitnessstudio", unsure=True)
person(None, [], None, {}, desc="Barista mit Tattoo", unsure=True)
person("Nachbarin", [], None, {"f_city": "Köln"})
for a, b, k in [(noah, ben, "freundschaft"), (noah, mia, "freundschaft"), (noah, clara, "freundschaft"), (ben, mia, "freundschaft"),
                (ben, clara, "freundschaft"), (mia, clara, "freundschaft"), (mama, papa, "partnerschaft"), (lisa, sophie, "trainingspartner"),
                (kai, mx, "freundschaft"), (heinz, mama, "eltern_kind")]:
    c.post("/bunds", json={"a_id": a, "b_id": b, "kind_id": k})
c.post("/notes", json={"text": "Mit Lisa und Sophie gebouldert. Max kommt nächstes Mal mit.", "dabei": [lisa, sophie], "day": d(11)})
print("Beispieldaten angelegt.")
