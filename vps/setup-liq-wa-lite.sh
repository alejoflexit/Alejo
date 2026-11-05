#!/bin/bash
# Pasa la sesión de WhatsApp PERSONAL de Alejo (mensajes de liquidación) a un contenedor propio y
# liviano: OpenWA con motor Baileys (sin Chrome, ~decenas de MB en vez de 1,1 GB), base propia (SQLite
# o una base Postgres NUEVA openwa_liq en el mismo servidor del bot, sin compartir tablas),
# tope de 512 MB. El contenedor del bot (openwa-api) NO se toca, salvo borrar la sesión personal vieja.
#
# Uso (root, desde la carpeta del repo):  bash vps/setup-liq-wa-lite.sh
# Idempotente: si openwa-liq ya existe lo reutiliza. Si algo falla ANTES del paso 6, queda todo como estaba.
set -u
cd "$(dirname "$0")/.."
NUEVO=openwa-liq
VIEJO=openwa-api
NOMBRE=alejo-liquidaciones
API=http://localhost:2785/api
F=/root/flexit
falla() { echo "ERROR: $*"; echo "No se cambió nada del bot. La sesión vieja sigue como estaba."; exit 1; }

echo "== 1) chequeos"
IMG=$(docker inspect "$VIEJO" -f '{{.Config.Image}}' 2>/dev/null) || falla "no encuentro el contenedor $VIEJO"
echo "imagen: $IMG"
# ── Base propia para la sesión personal ─────────────────────────────────────────────────────────
# Se averigua la base REAL que usa el bot (variable o, si está vacía, el default de OpenWA) y qué
# drivers trae la imagen. Preferencia: SQLite (aislada del todo); si no hay driver, una base Postgres
# NUEVA (openwa_liq) en el mismo servidor del bot: mismas credenciales, otra base, ninguna tabla compartida.
echo "--- diagnóstico de base (para el pase) ---"
docker exec "$VIEJO" sh -c 'env | grep "^DATABASE_" | sed "s/PASSWORD=.*/PASSWORD=***/"; echo "-- config:"; grep -n -i -E "DATABASE_|sqlite|postgres|mysql" /app/dist/config/configuration.js /app/dist/config/env.validation.js | head -25; echo "-- drivers:"; ls -d /app/node_modules/sqlite3 /app/node_modules/better-sqlite3 /app/node_modules/sql.js /app/node_modules/pg /app/node_modules/mysql2 2>/dev/null'
echo "------------------------------------------"
VAL() { docker exec "$VIEJO" printenv "$1" 2>/dev/null; }
DEF() { docker exec "$VIEJO" sh -c "grep -o -E \"process.env.$1 *(\\|\\||\\?\\?) *['\\\"][^'\\\"]*['\\\"]\" /app/dist/config/configuration.js | head -1 | sed -E \"s/.*['\\\"]([^'\\\"]*)['\\\"]$/\\1/\"" 2>/dev/null; }
EFE() { local v; v=$(VAL "$1"); [ -n "$v" ] && echo "$v" || DEF "$1"; }
TIPO_BOT=$(EFE DATABASE_TYPE)
echo "base del bot (efectiva): ${TIPO_BOT:-desconocida}"
SQLITE_DRV=""
if docker exec "$VIEJO" test -d /app/node_modules/better-sqlite3 && docker exec "$VIEJO" grep -q "better-sqlite3" /app/dist/config/configuration.js /app/dist/config/env.validation.js 2>/dev/null; then SQLITE_DRV=better-sqlite3
elif docker exec "$VIEJO" test -d /app/node_modules/sqlite3 && docker exec "$VIEJO" grep -q "sqlite" /app/dist/config/configuration.js /app/dist/config/env.validation.js 2>/dev/null; then SQLITE_DRV=sqlite
fi
DBENV=()
NET=$(docker inspect "$VIEJO" -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')
echo "red del bot: $NET"
if [ -n "$SQLITE_DRV" ]; then
  DBENV=(-e DATABASE_TYPE=$SQLITE_DRV -e DATABASE_NAME=/app/data/openwa.sqlite)
  echo "base: $SQLITE_DRV propia en el volumen"
else
  case "$TIPO_BOT" in postgres|postgresql) ;; *) falla "no hay driver SQLite y la base del bot es '${TIPO_BOT:-desconocida}' (ver diagnóstico arriba)";; esac
  H=$(EFE DATABASE_HOST); PT=$(EFE DATABASE_PORT); U=$(EFE DATABASE_USERNAME); PW=$(EFE DATABASE_PASSWORD); DBN=$(EFE DATABASE_NAME)
  [ -n "$H" ] && [ -n "$U" ] || falla "no pude leer host/usuario de la base del bot (ver diagnóstico arriba)"
  DBENV=(-e DATABASE_TYPE="$TIPO_BOT" -e DATABASE_HOST="$H" -e DATABASE_PORT="${PT:-5432}" -e DATABASE_USERNAME="$U" -e DATABASE_PASSWORD="$PW" -e DATABASE_NAME=openwa_liq)
  echo "base: postgres, base nueva openwa_liq en $H"
  docker exec -e PGH="$H" -e PGP="${PT:-5432}" -e PGU="$U" -e PGW="$PW" -e PGD="${DBN:-postgres}" "$VIEJO" node -e '
const { Client } = require("/app/node_modules/pg");
const c = new Client({ host: process.env.PGH, port: +process.env.PGP, user: process.env.PGU, password: process.env.PGW, database: process.env.PGD });
(async () => {
  await c.connect();
  const r = await c.query("select 1 from pg_database where datname = $1", ["openwa_liq"]);
  if (!r.rowCount) { await c.query("create database openwa_liq"); console.log("base openwa_liq creada"); }
  else console.log("base openwa_liq ya existía");
  await c.end();
})().catch(e => { console.error("ERROR pg:", e.message); process.exit(1); });' || falla "no pude crear la base openwa_liq"
fi
[ -s $F/bot-wa.key ] || falla "falta $F/bot-wa.key"

echo "== 2) contenedor $NUEVO (Baileys, base propia, 512 MB)"
if docker inspect "$NUEVO" >/dev/null 2>&1; then
  echo "ya existe, lo reutilizo"; docker start "$NUEVO" >/dev/null
  KEY=$(cat $F/liq-wa.apikey 2>/dev/null)
else
  KEY=$(openssl rand -hex 24)
  docker run -d --name "$NUEVO" --restart unless-stopped --memory 512m --memory-swap 768m --network "$NET" \
    -e ENGINE_TYPE=baileys -e BAILEYS_SYNC_FULL_HISTORY=false \
    "${DBENV[@]}" -e DATABASE_SYNCHRONIZE=true \
    -e REDIS_ENABLED=false -e STORAGE_TYPE=local -e STORAGE_LOCAL_PATH=/app/data/storage \
    -e SESSION_DATA_PATH=/app/data/sessions -e PLUGINS_ENABLED=false \
    -e API_MASTER_KEY="$KEY" -e PORT=2785 -e NODE_ENV=production -e LOG_LEVEL=warn \
    -v openwa-liq-data:/app/data "$IMG" >/dev/null || falla "docker run falló"
fi

echo "== 3) esperando que levante la API"
OK=""
for i in $(seq 1 40); do
  for K in "$KEY" "$(docker exec $NUEVO cat /app/data/.api-key 2>/dev/null)"; do
    [ -n "$K" ] || continue
    C=$(docker exec "$NUEVO" curl -s -o /dev/null -w '%{http_code}' -H "X-API-Key: $K" "$API/sessions" 2>/dev/null)
    if [ "$C" = "200" ]; then OK=$K; break 2; fi
  done
  sleep 3
done
if [ -z "$OK" ]; then
  echo "--- logs $NUEVO ---"; docker logs --tail 40 "$NUEVO" 2>&1
  docker rm -f "$NUEVO" >/dev/null 2>&1
  falla "la API de $NUEVO no respondió (borré el contenedor nuevo)"
fi
KEY=$OK; echo "API ok"
docker exec "$NUEVO" sh -c 'echo "motor: ${ENGINE_TYPE}"'

wa() { docker exec -i "$NUEVO" curl -s -m 60 -X "$1" -H "X-API-Key: $KEY" -H "Content-Type: application/json" "$API$2" ${3:+--data-binary "$3"}; }

echo "== 4) sesión en $NUEVO"
SID=$(wa GET /sessions | python3 -c '
import json, sys
d = json.load(sys.stdin); d = d.get("data", d) if isinstance(d, dict) else d
for s in d if isinstance(d, list) else []:
    if s.get("name") == sys.argv[1]: print(s.get("id")); break' "$NOMBRE")
if [ -z "$SID" ]; then
  SID=$(wa POST /sessions "{\"name\":\"$NOMBRE\"}" | python3 -c '
import json, sys
d = json.load(sys.stdin); d = d.get("data", d) if isinstance(d, dict) else d
print(d.get("id", ""))')
fi
[ -n "$SID" ] || { docker rm -f "$NUEVO" >/dev/null; falla "no se pudo crear la sesión en $NUEVO (borré el contenedor nuevo)"; }
echo "sesión: $SID"
WH=$(wa GET "/sessions/$SID/webhooks"); echo "webhooks (tiene que ser vacío): $WH"

echo "== 5) worker nuevo"
install -m 755 vps/flexit-liq-wa.py /usr/local/bin/flexit-liq-wa.py
cat > /etc/cron.d/flexit-liq-wa <<'CRON'
# Mensajes de liquidación por WhatsApp (sesión personal de Alejo) — ver /usr/local/bin/flexit-liq-wa.py
* * * * * root /usr/bin/python3 /usr/local/bin/flexit-liq-wa.py
CRON
chmod 644 /etc/cron.d/flexit-liq-wa

echo "== 6) apuntar al contenedor nuevo y borrar la sesión vieja (Chrome) del contenedor del bot"
OLD_SID=$(cat $F/liq-wa.sid 2>/dev/null)
umask 077
echo "$KEY" > $F/liq-wa.apikey
echo "$NUEVO" > $F/liq-wa.container
echo "$SID" > $F/liq-wa.sid
if [ -n "$OLD_SID" ] && [ "$OLD_SID" != "$SID" ]; then
  KV=$(docker exec "$VIEJO" cat /app/data/.api-key)
  NOM=$(docker exec "$VIEJO" curl -s -m 20 -H "X-API-Key: $KV" "$API/sessions/$OLD_SID" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
d = d.get("data", d) if isinstance(d.get("data"), dict) else d
print(d.get("name", ""))')
  if [ "$NOM" = "$NOMBRE" ]; then   # freno: SOLO se borra la sesión personal, nunca la del bot
    docker exec "$VIEJO" curl -s -m 60 -X DELETE -H "X-API-Key: $KV" "$API/sessions/$OLD_SID"; echo
    echo "sesión vieja $OLD_SID borrada de $VIEJO"
  else
    echo "NO borro $OLD_SID: su nombre es '$NOM', no '$NOMBRE'"
  fi
fi

echo "== 7) primera corrida"
/usr/bin/python3 /usr/local/bin/flexit-liq-wa.py || true
tail -5 /var/log/flexit-liq-wa.log 2>/dev/null
echo "--- memoria"; docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' "$NUEVO" "$VIEJO"
echo "LISTO. Contenedor=$NUEVO SID=$SID. Alejo: en la app tocá 'Vincular mi WhatsApp' y escaneá el QR."
