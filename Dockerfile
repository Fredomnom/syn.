# syn – Das Kontaktbuch für alle, die du kennst.
#
#   docker build -t syn .
#   docker run -d -p 8080:8080 -v syn-data:/data \
#     -e SYN_ADMIN_USER=du -e SYN_ADMIN_PASSWORD=geheim123 syn
#
# Optionale Importer (Telegram, Instagram, PlayStation) mitbauen:
#   docker build --build-arg EXTRAS="telethon instagrapi psnawp" -t syn .

ARG PYTHON=3.12

# ---------------------------------------------------------------- Abhängigkeiten
FROM python:${PYTHON}-slim AS deps
ARG EXTRAS=""
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
COPY requirements.txt /tmp/requirements.txt
RUN /venv/bin/pip install -r /tmp/requirements.txt \
 && if [ -n "$EXTRAS" ]; then /venv/bin/pip install $EXTRAS; fi

# ---------------------------------------------------------------- Laufzeit
FROM python:${PYTHON}-slim
LABEL org.opencontainers.image.title="syn" \
      org.opencontainers.image.description="Das Kontaktbuch für alle, die du kennst – selbst gehostet." \
      org.opencontainers.image.source="https://github.com/Fredomnom/syn."

ENV PATH="/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SYN_DATA=/data \
    SYN_HOST=0.0.0.0 \
    SYN_PORT=8080

# eigener Nutzer statt root; /data gehört ihm
RUN groupadd --system --gid 1000 syn \
 && useradd --system --uid 1000 --gid syn --home-dir /app --shell /usr/sbin/nologin syn \
 && mkdir -p /data && chown syn:syn /data

COPY --from=deps /venv /venv
WORKDIR /app
COPY --chown=syn:syn main.py ./
COPY --chown=syn:syn syn ./syn
COPY --chown=syn:syn web ./web

USER syn
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"SYN_PORT\",\"8080\")}/api/v1/health', timeout=4)" || exit 1

CMD ["python", "main.py"]
