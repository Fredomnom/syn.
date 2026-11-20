"""Konfiguration über Umgebungsvariablen."""
import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("SYN_DATA", Path(__file__).resolve().parent.parent / "data"))
DB_PATH = DATA_DIR / "syn.db"
FILES_DIR = DATA_DIR / "files"
HOST = os.environ.get("SYN_HOST", "0.0.0.0")
PORT = int(os.environ.get("SYN_PORT", "8080"))
# Lebensdauer von Login-Tokens (Web-App). Wird bei Benutzung verlängert.
SESSION_HOURS = int(os.environ.get("SYN_SESSION_HOURS", "24"))
# Kommagetrennte Liste von Importern, die global ausgeschaltet sind, z.B. "discord,whatsapp"
DISABLED_IMPORTERS = {s.strip() for s in os.environ.get("SYN_DISABLE_IMPORTERS", "").split(",") if s.strip()}
# Optionales Start-Konto für den Admin (nur, wenn noch kein Konto existiert)
ADMIN_USER = os.environ.get("SYN_ADMIN_USER")
ADMIN_PASSWORD = os.environ.get("SYN_ADMIN_PASSWORD")
# Scheduler für Routinen (in Tests aus)
SCHEDULER = os.environ.get("SYN_SCHEDULER", "1") == "1"
WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def ensure_dirs():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    FILES_DIR.mkdir(parents=True, exist_ok=True)
