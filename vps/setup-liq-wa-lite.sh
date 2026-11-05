#!/bin/bash
# Pasa la sesión de WhatsApp PERSONAL de Alejo (mensajes de liquidación) a un contenedor propio y
# liviano: OpenWA con motor Baileys (sin Chrome, ~decenas de MB en vez de 1,1 GB), base SQLite propia,
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
TIPOS=$(docker exec "$VIEJO" sh -c "grep -o \"DATABASE_TYPE'[^)]*\" /app/dist/config/env.validation.js" 2>/dev/null)
echo "tipos de base admitidos: $TIPOS"
echo "$TIPOS" | grep -q sqlite || falla "esta versión de OpenWA no acepta sqlite; no armo una base compartida con el bot"
[ -s $F/bot-wa.key ] || falla "falta $F/bot-wa.key"

echo "== 2) contenedor $NUEVO (Baileys, SQLite, 512 MB)"
if docker inspect "$NUEVO" >/dev/null 2>&1; then
  echo "ya existe, lo reutilizo"; docker start "$NUEVO" >/dev/null
  KEY=$(cat $F/liq-wa.apikey 2>/dev/null)
else
  KEY=$(openssl rand -hex 24)
  docker run -d --name "$NUEVO" --restart unless-stopped --memory 512m --memory-swap 768m \
    -e ENGINE_TYPE=baileys -e BAILEYS_SYNC_FULL_HISTORY=false \
    -e DATABASE_TYPE=sqlite -e DATABASE_NAME=/app/data/openwa.sqlite -e DATABASE_SYNCHRONIZE=true \
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
