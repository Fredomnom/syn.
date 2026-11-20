"""SQLite-Zugriff. Eine Verbindung pro Thread, Schema wird beim Start angelegt."""
import contextvars
import json
import sqlite3
import threading
from contextlib import contextmanager

from . import config

_local = threading.local()
_path = None
# Änderungsgruppe der laufenden Anfrage (für Rückgängig/Wiederholen). None = nicht protokollieren.
BATCH = contextvars.ContextVar("syn_batch", default=None)
# Tabellen, deren Änderungen rückgängig gemacht werden können, und wie der Besitzer ermittelt wird
UNDO_TABLES = {
    "entities": "user_id", "field_values": "user_id", "history": "user_id", "memberships": "user_id", "bunds": "user_id",
    "circles": "user_id", "field_defs": "user_id", "circle_kinds": "user_id", "bund_kinds": "user_id",
    "routines": "user_id", "notes": "user_id", "saved_views": "user_id", "suggestions": "user_id", "dup_marks": "user_id",
    "today_items": "user_id", "contact_signals": "user_id", "users": "id", "import_blocks": "user_id",
    "note_links": "(SELECT user_id FROM notes WHERE id={R}.note_id)",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, display_name TEXT,
  pw_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0, created_at TEXT,
  settings TEXT DEFAULT '{}', enc_key TEXT
);
CREATE TABLE IF NOT EXISTS sessions(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT, created_at TEXT, agent TEXT
);
CREATE TABLE IF NOT EXISTS api_tokens(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, token_hash TEXT UNIQUE, prefix TEXT,
  read_only INTEGER DEFAULT 0, created_at TEXT, last_used_at TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS entities(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'person',
  is_self INTEGER DEFAULT 0, name TEXT, name_uncertain INTEGER DEFAULT 0, description TEXT,
  aliases TEXT DEFAULT '[]', avatar TEXT, main_circle_id TEXT, on_phone INTEGER DEFAULT 0,
  created_at TEXT, updated_at TEXT, valid_from TEXT, valid_to TEXT
);
CREATE INDEX IF NOT EXISTS ent_user ON entities(user_id);
CREATE TABLE IF NOT EXISTS field_defs(
  user_id TEXT NOT NULL, id TEXT NOT NULL, scope TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL,
  options TEXT DEFAULT '{}', multi INTEGER DEFAULT 0, position INTEGER DEFAULT 0, is_base INTEGER DEFAULT 0,
  quick_routine_id TEXT, PRIMARY KEY(user_id, id)
);
CREATE TABLE IF NOT EXISTS field_values(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, owner_type TEXT NOT NULL, owner_id TEXT NOT NULL,
  field_id TEXT NOT NULL, value TEXT, label TEXT, is_primary INTEGER DEFAULT 0, deprecated INTEGER DEFAULT 0,
  uncertain INTEGER DEFAULT 0, source TEXT DEFAULT 'manual', valid_from TEXT, valid_to TEXT,
  recorded_at TEXT, position INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fv_owner ON field_values(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS fv_field ON field_values(user_id, field_id);
CREATE TABLE IF NOT EXISTS history(
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, owner_type TEXT, owner_id TEXT,
  attr TEXT, value_id TEXT, old TEXT, new TEXT, at TEXT, source TEXT
);
CREATE INDEX IF NOT EXISTS hist_owner ON history(owner_type, owner_id);
CREATE TABLE IF NOT EXISTS circle_kinds(
  user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT, abbr TEXT, bg TEXT, fg TEXT, position INTEGER DEFAULT 0,
  PRIMARY KEY(user_id, id)
);
CREATE TABLE IF NOT EXISTS bund_kinds(
  user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT, role_a TEXT, role_b TEXT, position INTEGER DEFAULT 0,
  PRIMARY KEY(user_id, id)
);
CREATE TABLE IF NOT EXISTS circles(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, kind_id TEXT, parent_id TEXT,
  description TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS memberships(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, circle_id TEXT NOT NULL, entity_id TEXT NOT NULL,
  role TEXT, valid_from TEXT, valid_to TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS mem_ent ON memberships(entity_id);
CREATE INDEX IF NOT EXISTS mem_circ ON memberships(circle_id);
CREATE TABLE IF NOT EXISTS bunds(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, a_id TEXT NOT NULL, b_id TEXT NOT NULL, kind_id TEXT,
  role_a TEXT, role_b TEXT, created_at TEXT, updated_at TEXT, valid_from TEXT, valid_to TEXT
);
CREATE INDEX IF NOT EXISTS bund_a ON bunds(a_id);
CREATE INDEX IF NOT EXISTS bund_b ON bunds(b_id);
CREATE TABLE IF NOT EXISTS routines(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, enabled INTEGER DEFAULT 1,
  trigger TEXT, conditions TEXT DEFAULT '[]', actions TEXT DEFAULT '[]', created_at TEXT,
  last_run_at TEXT, last_status TEXT, system TEXT
);
CREATE TABLE IF NOT EXISTS routine_runs(
  routine_id TEXT, entity_id TEXT, run_key TEXT, at TEXT, PRIMARY KEY(routine_id, entity_id, run_key)
);
CREATE TABLE IF NOT EXISTS today_items(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, routine_id TEXT, entity_id TEXT, kind TEXT, title TEXT,
  body TEXT, day TEXT, created_at TEXT, dismissed INTEGER DEFAULT 0, data TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS contact_signals(
  user_id TEXT NOT NULL, entity_id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, at TEXT,
  PRIMARY KEY(entity_id, source, kind)
);
CREATE TABLE IF NOT EXISTS importer_configs(
  user_id TEXT NOT NULL, importer_id TEXT NOT NULL, enabled INTEGER DEFAULT 0, config_enc TEXT,
  state TEXT DEFAULT '{}', last_run_at TEXT, last_status TEXT, last_log TEXT, risk_ack INTEGER DEFAULT 0,
  PRIMARY KEY(user_id, importer_id)
);
CREATE TABLE IF NOT EXISTS suggestions(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT, entity_id TEXT, payload TEXT, source TEXT,
  created_at TEXT, status TEXT DEFAULT 'open'
);
CREATE TABLE IF NOT EXISTS dup_marks(
  user_id TEXT NOT NULL, a_id TEXT NOT NULL, b_id TEXT NOT NULL, mark TEXT, until TEXT,
  PRIMARY KEY(user_id, a_id, b_id)
);
CREATE TABLE IF NOT EXISTS notes(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, day TEXT, text TEXT, created_at TEXT, updated_at TEXT
);
CREATE TABLE IF NOT EXISTS note_links(
  note_id TEXT NOT NULL, entity_id TEXT NOT NULL, role TEXT, PRIMARY KEY(note_id, entity_id)
);
CREATE TABLE IF NOT EXISTS saved_views(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT, tab TEXT, view TEXT, config TEXT DEFAULT '{}',
  position INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS files(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mime TEXT, path TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS google_map(
  user_id TEXT NOT NULL, entity_id TEXT NOT NULL, resource_name TEXT, etag TEXT, pushed_hash TEXT,
  pushed TEXT, PRIMARY KEY(user_id, entity_id)
);
CREATE TABLE IF NOT EXISTS instance(key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS import_blocks(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, grp TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
  label TEXT, sources TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS ib_user ON import_blocks(user_id, kind, key);
CREATE TABLE IF NOT EXISTS undo_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT, batch TEXT NOT NULL, user_id TEXT, tbl TEXT, op TEXT, pk INTEGER,
  old TEXT, new TEXT
);
CREATE INDEX IF NOT EXISTS undo_batch ON undo_log(batch);
CREATE TABLE IF NOT EXISTS undo_batches(
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, label TEXT, at TEXT, state TEXT DEFAULT 'done'
);
CREATE INDEX IF NOT EXISTS undo_user ON undo_batches(user_id, state, at);
"""


def init(path=None):
    global _path
    config.ensure_dirs()
    _path = str(path or config.DB_PATH)
    close()
    c = conn()
    c.executescript(SCHEMA)
    migrate(c)
    install_undo_triggers(c)
    c.commit()


def migrate(c):
    """Kleine Schema-Ergänzungen für bestehende Datenbanken."""
    cols = {r[1] for r in c.execute("PRAGMA table_info(entities)")}
    added = False
    for col in ("first_name", "middle_names", "last_name"):
        if col not in cols:
            c.execute(f"ALTER TABLE entities ADD COLUMN {col} TEXT")
            added = True
    for tbl in ("circle_kinds", "bund_kinds"):
        if "icon" not in {r[1] for r in c.execute(f"PRAGMA table_info({tbl})")}:
            c.execute(f"ALTER TABLE {tbl} ADD COLUMN icon TEXT")
    if added:
        # bestehende Namen einmalig aufteilen: erstes Wort Vorname, letztes Nachname, dazwischen weitere Vornamen
        for eid, name in c.execute("SELECT id, name FROM entities WHERE name IS NOT NULL").fetchall():
            parts = name.split()
            first = parts[0] if parts else None
            last = parts[-1] if len(parts) > 1 else None
            middle = " ".join(parts[1:-1]) or None
            c.execute("UPDATE entities SET first_name=?, middle_names=?, last_name=? WHERE id=?", (first, middle, last, eid))


def install_undo_triggers(c):
    """Trigger protokollieren jede Zeile vor und nach der Änderung – aber nur innerhalb einer Änderungsgruppe."""
    for tbl, owner in UNDO_TABLES.items():
        cols = [r[1] for r in c.execute(f"PRAGMA table_info({tbl})")]
        def obj(R):
            return "json_object(" + ",".join(f"'{col}',{R}.{col}" for col in cols) + ")"
        def own(R):
            return owner.replace("{R}", R) if "{R}" in owner else f"{R}.{owner}"
        for op, ev, R, old, new in (("I", "INSERT", "NEW", "NULL", obj("NEW")), ("U", "UPDATE", "NEW", obj("OLD"), obj("NEW")),
                                    ("D", "DELETE", "OLD", obj("OLD"), "NULL")):
            name = f"undo_{tbl}_{op}"
            c.execute(f"DROP TRIGGER IF EXISTS {name}")
            c.execute(f"CREATE TRIGGER {name} AFTER {ev} ON {tbl} WHEN syn_batch() IS NOT NULL BEGIN "
                      f"INSERT INTO undo_log(batch,user_id,tbl,op,pk,old,new) VALUES(syn_batch(),{own(R)},'{tbl}','{op}',"
                      f"{R}.rowid,{old},{new}); END")


def conn() -> sqlite3.Connection:
    c = getattr(_local, "conn", None)
    if c is None or getattr(_local, "path", None) != _path:
        c = sqlite3.connect(_path, timeout=30, isolation_level=None)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA foreign_keys=OFF")
        c.execute("PRAGMA busy_timeout=30000")
        c.create_function("syn_batch", 0, lambda: BATCH.get(), deterministic=False)
        _local.conn = c
        _local.path = _path
    return c


def close():
    c = getattr(_local, "conn", None)
    if c is not None:
        try:
            c.close()
        except Exception:
            pass
        _local.conn = None


@contextmanager
def tx():
    """Transaktion; verschachtelte Aufrufe laufen in der äußeren mit."""
    c = conn()
    depth = getattr(_local, "depth", 0)
    if depth == 0:
        c.execute("BEGIN IMMEDIATE")
    _local.depth = depth + 1
    try:
        yield c
        _local.depth -= 1
        if _local.depth == 0:
            c.execute("COMMIT")
    except BaseException:
        _local.depth -= 1
        if _local.depth == 0:
            c.execute("ROLLBACK")
        raise


def q(sql, *args):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def q1(sql, *args):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def val(sql, *args):
    r = conn().execute(sql, args).fetchone()
    return r[0] if r else None


def ex(sql, *args):
    return conn().execute(sql, args)


def insert(table, row: dict):
    cols = ",".join(row)
    ph = ",".join("?" for _ in row)
    conn().execute(f"INSERT INTO {table}({cols}) VALUES({ph})", tuple(row.values()))


def update(table, key: dict, changes: dict):
    if not changes:
        return
    sets = ",".join(f"{k}=?" for k in changes)
    where = " AND ".join(f"{k}=?" for k in key)
    conn().execute(f"UPDATE {table} SET {sets} WHERE {where}", (*changes.values(), *key.values()))


def jl(s, default=None):
    if s is None or s == "":
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


def jd(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))
