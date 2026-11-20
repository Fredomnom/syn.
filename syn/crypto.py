"""Verschlüsselung für Import-Zugangsdaten und OAuth-Tokens.

Jeder Nutzer hat einen eigenen Schlüssel. Dieser liegt verschlüsselt mit dem Server-Schlüssel
(data/secret.key) in der Datenbank. Ohne secret.key sind die gespeicherten Tokens unlesbar.
"""
import json
import os

from cryptography.fernet import Fernet, InvalidToken

from . import config, db

_master = None


def master() -> Fernet:
    global _master
    if _master is None:
        env = os.environ.get("SYN_SECRET_KEY")
        if env:
            key = env.encode()
        else:
            p = config.DATA_DIR / "secret.key"
            if not p.exists():
                p.write_bytes(Fernet.generate_key())
                os.chmod(p, 0o600)
            key = p.read_bytes().strip()
        _master = Fernet(key)
    return _master


def reset():
    global _master
    _master = None


def user_key(user_id: str) -> Fernet:
    row = db.q1("SELECT enc_key FROM users WHERE id=?", user_id)
    if not row:
        raise KeyError(user_id)
    if not row["enc_key"]:
        k = Fernet.generate_key()
        db.ex("UPDATE users SET enc_key=? WHERE id=?", master().encrypt(k).decode(), user_id)
        return Fernet(k)
    return Fernet(master().decrypt(row["enc_key"].encode()))


def seal(user_id: str, data) -> str:
    return user_key(user_id).encrypt(json.dumps(data).encode()).decode()


def unseal(user_id: str, blob: str, default=None):
    if not blob:
        return default
    try:
        return json.loads(user_key(user_id).decrypt(blob.encode()))
    except (InvalidToken, ValueError):
        return default
