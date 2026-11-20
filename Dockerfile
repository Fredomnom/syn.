# syn – Das Kontaktbuch für alle, die du kennst.
#
# Zwei Varianten aus derselben Datei:
#   docker build -t ghcr.io/fredomnom/syn:latest .                    schlank (Standard)
#   docker build --target full -t ghcr.io/fredomnom/syn:full .        dazu Telegram, Instagram (API), PlayStation
#
#   docker run -d -p 8080:8080 -v syn-data:/data ghcr.io/fredomnom/syn:latest
#   → http://localhost:8080 öffnen: syn legt die Datenbank selbst an, du erstellst dein Konto im Browser.
#
# Weitere Pakete in beide Varianten: --build-arg EXTRAS="paket1 paket2"
# Signal braucht signal-cli (Java) auf dem Server und ist in keinem Image enthalten.

ARG PYTHON=3.12

# ---------------------------------------------------------------- Abhängigkeiten
FROM python:${PYTHON}-slim AS deps
ARG EXTRAS=""
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
COPY requirements.txt /tmp/requirements.txt
RUN /venv/bin/pip install -r /tmp/requirements.txt \
 && if [ -n "$EXTRAS" ]; then /venv/bin/pip install $EXTRAS; fi

# Optionale Importer obendrauf (Telegram, Instagram inoffiziell, PlayStation)
FROM deps AS deps-full
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN /venv/bin/pip install telethon instagrapi psnawp

# ---------------------------------------------------------------- Laufzeit (gemeinsame Basis)
FROM python:${PYTHON}-slim AS runtime
LABEL org.opencontainers.image.title="syn" \
      org.opencontainers.image.description="The contact book for everyone you know – self-hosted." \
      org.opencontainers.image.source="https://github.com/Fredomnom/syn." \
      org.opencontainers.image.url="https://syn.fredomnom.com" \
      org.opencontainers.image.licenses="MIT"

ENV PATH="/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SYN_DATA=/data \
    SYN_HOST=0.0.0.0 \
    SYN_PORT=8080

# eigener Nutzer statt root; syn läuft als dieser Nutzer (siehe Startskript)
RUN groupadd --system --gid 1000 syn \
 && useradd --system --uid 1000 --gid syn --home-dir /app --shell /usr/sbin/nologin syn \
 && mkdir -p /data && chown syn:syn /data

# Startskript: richtet die Rechte an /data ein und startet syn dann ohne root-Rechte (setpriv)
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/syn-entrypoint
WORKDIR /app
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"SYN_PORT\",\"8080\")}/api/v1/health', timeout=4)" || exit 1
ENTRYPOINT ["syn-entrypoint"]
CMD ["python", "main.py"]

# ---------------------------------------------------------------- Variante „full“
FROM runtime AS full
LABEL org.opencontainers.image.variant="full"
COPY --from=deps-full /venv /venv
COPY --chown=syn:syn main.py ./
COPY --chown=syn:syn syn ./syn
COPY --chown=syn:syn web ./web

# ---------------------------------------------------------------- Variante „slim“ (Standard, letzte Stufe)
FROM runtime AS slim
COPY --from=deps /venv /venv
COPY --chown=syn:syn main.py ./
COPY --chown=syn:syn syn ./syn
COPY --chown=syn:syn web ./web
