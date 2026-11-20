#!/bin/sh
# Start im Container: /data (und eingehängte Unterordner wie /data/files) gehören dem Nutzer syn,
# dann läuft syn ohne root-Rechte weiter. Legt Docker einen fehlenden Ordner selbst an, gehört er root –
# ohne diesen Schritt könnte syn dort keine Datenbank anlegen und würde in einer Schleife neu starten.
set -e
DATA="${SYN_DATA:-/data}"
UID_SYN="$(id -u syn)"
GID_SYN="$(id -g syn)"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA" "$DATA/files"
  # nur Ordner/Dateien anfassen, die noch nicht syn gehören (schnell auch bei vielen Dateien)
  find "$DATA" \( ! -user "$UID_SYN" -o ! -group "$GID_SYN" \) -exec chown "$UID_SYN:$GID_SYN" {} + 2>/dev/null || true
  exec setpriv --reuid="$UID_SYN" --regid="$GID_SYN" --init-groups -- "$@"
fi

# als anderer Nutzer gestartet (z.B. --user): wenigstens klar sagen, was fehlt
if ! [ -w "$DATA" ]; then
  echo "syn: Kein Schreibrecht auf $DATA (Nutzer $(id -u)). Ordner auf dem Host freigeben, z.B.: sudo chown -R $(id -u):$(id -g) <ordner>" >&2
  exit 1
fi
exec "$@"
