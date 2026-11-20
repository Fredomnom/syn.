from ..importe import Contact, Importer


class PlayStation(Importer):
    id = "playstation"
    name = "PlayStation"
    way = "PSN-API mit NPSSO-Token (psnawp, Python-Gegenstück zu psn-api)"
    official = "nein"
    brings = "Freunde"
    service = "psn"
    unofficial = True
    requires = ["psnawp_api"]
    rate = 1.0
    risk = "Der NPSSO-Token stammt aus deinem eingeloggten PlayStation-Konto; kein offizieller Weg. syn liest nur."
    config = [{"key": "npsso", "label": "NPSSO-Token", "type": "secret", "required": True,
               "help": "Eingeloggt öffnen: https://ca.account.sony.com/api/v1/ssocookie"}]

    def fetch(self, cfg, run):
        from psnawp_api import PSNAWP
        client = PSNAWP(cfg["npsso"]).me()
        out = []
        for f in client.friends_list():
            out.append(Contact(service_id=str(f.account_id), handle=f.online_id, name=f.online_id))
        return out


IMPORTER = PlayStation()
