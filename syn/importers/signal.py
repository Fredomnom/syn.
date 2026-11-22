import json
import subprocess

from ..importe import Contact, Importer


class Signal(Importer):
    id = "signal"
    steps = [
        'Installiere signal-cli auf dem Server (github.com/AsamK/signal-cli).',
        'Verknüpfe es als Gerät: „signal-cli link -n syn“ und scanne den QR-Code in Signal → Einstellungen → Verknüpfte Geräte.',
        'Trag hier deine Nummer ein (und den Pfad, falls signal-cli nicht im Suchpfad liegt).',
        'Bestätige den Hinweis und klick auf „Importieren“.',
    ]
    name = "Signal"
    way = "signal-cli"
    official = "nein"
    brings = "Kontakte, Gruppen"
    service = "signal"
    unofficial = True
    risk = "signal-cli ist ein inoffizieller Client. Er muss als verknüpftes Gerät eingerichtet sein. syn liest nur."
    config = [
        {"key": "account", "label": "Deine Nummer", "type": "text", "required": True, "placeholder": "+49…"},
        {"key": "binary", "label": "Pfad zu signal-cli", "type": "text", "placeholder": "signal-cli"},
    ]

    def _cmd(self, cfg, *args):
        r = subprocess.run([cfg.get("binary") or "signal-cli", "-a", cfg["account"], "-o", "json", *args],
                           capture_output=True, text=True, timeout=120)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip()[:300] or "signal-cli fehlgeschlagen")
        return json.loads(r.stdout or "[]")

    def fetch(self, cfg, run):
        out = []
        groups = {}
        try:
            for g in self._cmd(cfg, "listGroups", "-d"):
                for m in g.get("members", []):
                    num = m.get("number") if isinstance(m, dict) else m
                    groups.setdefault(num, []).append(g.get("name"))
        except Exception as e:
            run.log(f"Gruppen nicht lesbar: {e}")
        for c in self._cmd(cfg, "listContacts"):
            num = c.get("number")
            nick = " ".join(x for x in (c.get("nickGivenName"), c.get("nickFamilyName")) if x) or c.get("nickName")
            name = nick or c.get("name") or (c.get("profile") or {}).get("givenName") or c.get("username")
            if not (num or c.get("uuid")):
                continue
            out.append(Contact(service_id=c.get("uuid") or num, handle=c.get("username") or num, name=name,
                               phones=[(num, "mobil")] if num else [], groups=groups.get(num, []),
                               note=(c.get("note") or "").strip() or None))
        run.log(f"{len(groups)} Nummern in Gruppen")
        return out


IMPORTER = Signal()
