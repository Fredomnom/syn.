from ..importe import Importer
from ._common import iter_files, vcards_to_contacts


class VCard(Importer):
    id = "vcard"
    steps = [
        'Öffne am Handy die Kontakte-App.',
        'iPhone: Kontakte → Listen → „Alle Kontakte“ lange drücken → Exportieren. Android: Kontakte → Menü → Exportieren → .vcf-Datei.',
        'Schick dir die .vcf-Datei (z.B. per AirDrop oder Mail) an den Rechner.',
        'Wähl die Datei hier aus oder zieh sie in das Feld.',
        'Klick auf „Importieren“.',
    ]
    name = "Handy-Kontakte"
    way = "vCard-Datei"
    official = "Datei"
    brings = "Namen, Nummern, Mails, Geburtstage, Fotos"
    accepts_files = True
    file_hint = ".vcf (auch mehrere oder als ZIP) – am Handy unter Kontakte → Teilen/Exportieren"

    def fetch(self, cfg, run):
        out = []
        for name, data in iter_files(run.files, [".vcf", ".vcard"]):
            out += vcards_to_contacts(data.decode("utf-8", "replace"))
            run.log(f"{name} gelesen")
        return out


IMPORTER = VCard()
