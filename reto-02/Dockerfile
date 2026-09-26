# syntax=docker/dockerfile:1.26@sha256:ecfaec9ed6d810b56388c508f4121597bfbba70d41a6dfeee4d8cad5f295fc32
#
# Imagen de contenedor del reto: alternativa al despliegue principal en Vercel
# para correrlo con Docker en local o en cualquier hosting de contenedores.
# Usa almacenamiento en archivos (ALMACEN=archivo) dentro de DATA_DIR=/data;
# monta ahí un volumen para conservar sesiones y registro de uso.
# Idéntica en los tres retos salvo la etiqueta org.opencontainers.image.title.
# Se construye con el directorio del reto como contexto:
#   docker build -t perxia-reto-02 reto-02
#
# Bases fijadas por digest (índices multi-arquitectura de oven/bun:1.3.14 y de
# su variante -slim, la misma versión de Bun con menos paquetes del sistema).
# Para actualizarlas: docker buildx imagetools inspect oven/bun:<versión>[-slim]
# y reemplazar el digest (Dependabot también propone el cambio).

# ─── Etapa 1: dependencias de producción ─────────────────────────────────────
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
# --frozen-lockfile: falla si bun.lock no corresponde a package.json.
# --ignore-scripts: ninguna dependencia ejecuta código al instalarse.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production --ignore-scripts

# ─── Etapa 2: front compilado (bun run build → dist/web) ─────────────────────
FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN NODE_ENV=production bun run build

# ─── Etapa 3: ejecución ──────────────────────────────────────────────────────
FROM oven/bun:1.3.14-slim@sha256:d56a2534ffd262e92c12fd3249d3924d296d97086da773f821d7d0477435ea04 AS runtime

LABEL org.opencontainers.image.title="perxia-reto-02" \
      org.opencontainers.image.source="https://github.com/jacardozob-mapache/retos-periferia" \
      org.opencontainers.image.description="Agente conversacional del reto técnico Perxia 2.0 (Periferia IT Group)"

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    ALMACEN=archivo

WORKDIR /app

# Código y dependencias quedan de root y en solo lectura para el proceso: el
# único directorio escribible es DATA_DIR (/data, pensado para un volumen).
COPY --link --from=deps /app/node_modules ./node_modules
COPY --link . .
COPY --link --from=build /app/dist/web ./dist/web

# Punto de entrada: muchos hostings de contenedores montan los volúmenes como
# root, así que el arranque (y solo el arranque) corre como root para dejar
# DATA_DIR en manos del usuario sin privilegios `bun` (uid 1000) y de inmediato
# cede los privilegios con setpriv: sin capacidades, sin bounding set y con
# no_new_privs. El servidor nunca corre como root. Si el contenedor ya arranca
# sin privilegios (docker run --user 1000:1000), ejecuta el comando directo.
COPY --chmod=0755 <<'EOF' /usr/local/bin/iniciar-reto
#!/bin/sh
set -eu
dir="${DATA_DIR:-/data}"
case "$dir" in
  /*) ;;
  *) echo "iniciar-reto: DATA_DIR debe ser una ruta absoluta (recibido: $dir)" >&2; exit 64 ;;
esac
case "$dir" in
  /|*..*) echo "iniciar-reto: DATA_DIR no válido: $dir" >&2; exit 64 ;;
esac
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$dir"
  if [ "$(stat -c %u "$dir")" != "1000" ]; then
    chown -R 1000:1000 "$dir"
  fi
  chmod 0750 "$dir"
  export HOME=/home/bun USER=bun LOGNAME=bun
  exec setpriv --reuid=1000 --regid=1000 --init-groups \
    --inh-caps=-all --bounding-set=-all --no-new-privs -- "$@"
fi
exec "$@"
EOF

RUN mkdir -p /data && chown 1000:1000 /data

EXPOSE 3000

# Chequeo de salud del contenedor contra el endpoint público /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/iniciar-reto"]
CMD ["bun", "src/server.ts"]
