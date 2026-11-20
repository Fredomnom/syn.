import re

from ..importe import Contact, Importer, to_date
from ._common import iter_files

LINE = re.compile(r"^\[?(\d{1,2})[./](\d{1,2})[./](\d{2,4}),?\s+(\d{1,2}:\d{2})(?::\d{2})?\]?\s*[-–]?\s*([^:]+?):\s")


class WhatsApp(Importer):
    id = "whatsapp"
    name = "WhatsApp"
    way = "Chat-Export oder WhatsApp-Web-Bridge (z.B. Baileys)"
    official = "nein"
    brings = "Kontakte, Chats, letzte Nachricht"
    service = "whatsapp"
    unofficial = True
    risk = ("Die WhatsApp-Web-Bridge ist kein offizieller Weg; WhatsApp kann Nummern sperren, die inoffizielle "
            "Clients nutzen. Der Chat-Export ist unbedenklich. syn liest nur.")
    accepts_files = True
    file_hint = "Chat-Export (.txt oder .zip, auch mehrere) – oder Bridge-URL eintragen"
    config = [
        {"key": "bridge_url", "label": "Bridge-URL (optional)", "type": "text",
         "help": "Eine Baileys-Bridge, die unter /contacts eine JSON-Liste liefert: "
                 "[{id:'4915…@s.whatsapp.net', name, notify, lastMessage}]"},
        {"key": "bridge_token", "label": "Bridge-Token (optional)", "type": "secret"},
        {"key": "me", "label": "Dein Name im Export", "type": "text",
         "help": "damit deine eigenen Nachrichten nicht als Kontakt zählen"},
    ]

    def fetch(self, cfg, run):
        out = []
        if cfg.get("bridge_url") and not run.files:
            h = {"Authorization": f"Bearer {cfg['bridge_token']}"} if cfg.get("bridge_token") else {}
            for c in run.get(cfg["bridge_url"].rstrip("/") + "/contacts", headers=h).json():
                jid = c.get("id", "")
                if not jid.endswith("@s.whatsapp.net"):
                    continue
                num = "+" + jid.split("@")[0]
                last = c.get("lastMessage")
                out.append(Contact(service_id=num, handle=num, name=c.get("name") or c.get("notify"),
                                   phones=[(num, "mobil")],
                                   last_contact=to_date(last)))
            return out
        me = (cfg.get("me") or "").strip().lower()
        senders, groups = {}, {}
        for name, data in iter_files(run.files, [".txt"]):
            chat = re.sub(r"^(WhatsApp[- ]Chat (mit|with) )", "", name.rsplit("/", 1)[-1].removesuffix(".txt"), flags=re.I).strip()
            in_file = set()
            for ln in data.decode("utf-8", "replace").splitlines():
                m = LINE.match(ln.replace("‎", ""))
                if not m:
                    continue
                d, mo, y, _t, who = m.groups()
                y = int(y) + 2000 if len(y) == 2 else int(y)
                day = f"{y:04d}-{int(mo):02d}-{int(d):02d}"
                who = who.strip()
                if who.lower() == me:
                    continue
                if who not in senders or senders[who] < day:
                    senders[who] = day
                in_file.add(who)
            if len(in_file) > 1 and chat and chat.lower() not in ("_chat", "chat"):
                for who in in_file:
                    groups.setdefault(who, []).append(chat)
            run.log(f"{name}: {len(senders)} Absender bisher")
        for who, last in senders.items():
            num = re.sub(r"[^\d+]", "", who)
            if num.startswith("+") and len(num) > 8:
                out.append(Contact(service_id=num, handle=num, phones=[(num, "mobil")], last_contact=last, groups=groups.get(who, [])))
            else:
                out.append(Contact(name=who, last_contact=last, groups=groups.get(who, [])))
        return out


IMPORTER = WhatsApp()
