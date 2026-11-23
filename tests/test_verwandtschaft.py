"""Verwandtschaft: aus Familien-Bünden folgen weitere – berechnet, nicht gespeichert."""
from syn.modules.verwandtschaft import role_path, simplify


def test_rollen_und_wege():
    assert role_path("Mutter") == ("U", "f") and role_path("Opa") == ("UU", "m") and role_path("Oma_")[0] is None
    assert simplify("UU") == "UU" and simplify("UD") == "S" and simplify("UUDD") == "USD" and simplify("SU") == "U"
    assert simplify("DU") is None and simplify("UP") is None


def _bund(c, a, b, ra, rb):
    return c.post("/api/v1/bunds", json={"a_id": a, "b_id": b, "role_a": ra, "role_b": rb}).json()


def test_oma_tante_cousin(client):
    c = client
    me = c.get("/api/v1/me").json()["self_id"]
    mk = lambda n: c.post("/api/v1/entities", json={"name": n}).json()["id"]  # noqa: E731
    mama, oma, tante, cousin, freund, freundin = (mk(n) for n in ("Mama", "Oma Erna", "Tante Gabi", "Cousin Ben", "Freund", "Freundin vom Freund"))
    _bund(c, mama, me, "Mutter", "Sohn")
    _bund(c, oma, mama, "Mutter", "Tochter")
    _bund(c, tante, oma, "Tochter", None)       # nur eine Seite benannt
    _bund(c, cousin, tante, "Sohn", "Mutter")
    _bund(c, freund, me, "Freund", "Freund")     # Freundschaft: daraus folgt nichts
    _bund(c, freundin, freund, "Freundin", "Freund")
    kin = {r["b_id"]: r for r in c.get("/api/v1/kin", params={"entity_id": me}).json()}
    assert kin[oma]["role_b"] == "Oma" and kin[oma]["role_a"] == "Enkel" and kin[oma]["via_names"] == ["Mama"]
    assert kin[tante]["role_b"] == "Tante" and kin[cousin]["role_b"] == "Cousin"
    assert freundin not in kin
    # Stimmt nicht → weg; Stimmt → echter Bund, nicht mehr abgeleitet
    c.post("/api/v1/kin/hide", json={"a_id": me, "b_id": cousin})
    r = c.post("/api/v1/kin/confirm", json={"a_id": me, "b_id": oma}).json()
    assert {r["role_a"], r["role_b"]} == {"Oma", "Enkel"}
    kin = {r["b_id"] for r in c.get("/api/v1/kin", params={"entity_id": me}).json()}
    assert cousin not in kin and oma not in kin and tante in kin
    # Fällt die Verbindung Mama–Oma weg, folgt die Tante jetzt über die (bestätigte) Oma …
    b = next(x for x in c.get("/api/v1/bunds", params={"entity_id": oma}).json() if mama in (x["a_id"], x["b_id"]))
    c.delete(f"/api/v1/bunds/{b['id']}")
    kin = {r["b_id"]: r for r in c.get("/api/v1/kin", params={"entity_id": me}).json()}
    assert kin[tante]["via_names"] == ["Oma Erna"]
    # … und ohne jede Verbindung zur Oma verschwindet sie von selbst
    b = next(x for x in c.get("/api/v1/bunds", params={"entity_id": oma}).json() if me in (x["a_id"], x["b_id"]))
    c.delete(f"/api/v1/bunds/{b['id']}")
    assert tante not in {r["b_id"] for r in c.get("/api/v1/kin", params={"entity_id": me}).json()}
