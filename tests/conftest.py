import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("SYN_DATA", str(tmp_path))
    monkeypatch.setenv("SYN_SCHEDULER", "0")
    from syn import config, crypto
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "syn.db")
    monkeypatch.setattr(config, "FILES_DIR", tmp_path / "files")
    monkeypatch.setattr(config, "SCHEDULER", False)
    crypto.reset()
    import main
    return main.create_app()


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient
    c = TestClient(app)
    r = c.post("/api/v1/instance/setup", json={"username": "fred", "password": "geheim123", "display_name": "Fred"})
    assert r.status_code == 200, r.text
    tok = r.json()["token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    c.post("/api/v1/me/setup", json={"use_levels": True, "use_ist": True,
                                     "sync": {"mode": "rule", "match": "any", "rules": [{"type": "level", "max": 3}]}})
    return c
