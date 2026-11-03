#!/bin/bash
# Instala el worker de mensajes de liquidación (WhatsApp personal de Alejo). Idempotente: se puede
# correr de nuevo sin romper nada. Uso (como root, desde la carpeta del repo):  bash vps/setup-liq-wa.sh
#
#  1. Copia vps/flexit-liq-wa.py a /usr/local/bin/
#  2. Crea (si no existe) la sesión OpenWA "alejo-liquidaciones" y guarda su id en /root/flexit/liq-wa.sid
#     — NO se vincula acá: el QR aparece en la app (Liquidaciones › Enviar por WhatsApp › Conectar)
#  3. Se asegura de que esa sesión NO tenga webhooks (si no, el agente/n8n vería tus chats personales)
#  4. Instala el cron cada minuto: /etc/cron.d/flexit-liq-wa
# NO toca la sesión del bot (flexit-agente), ni n8n, ni el guardián.
set -eu
cd "$(dirname "$0")/.."
NOMBRE=alejo-liquidaciones
API=http://localhost:2785/api
SIDF=/root/flexit/liq-wa.sid

[ -s /root/flexit/bot-wa.key ] || { echo "ERROR: falta /root/flexit/bot-wa.key (la clave del guardián)"; exit 1; }
K=$(docker exec openwa-api cat /app/data/.api-key)
wa() { docker exec -i openwa-api curl -s -m 60 -X "$1" -H "X-API-Key: $K" -H "Content-Type: application/json" "$API$2" ${3:+--data-binary "$3"}; }

install -m 755 vps/flexit-liq-wa.py /usr/local/bin/flexit-liq-wa.py
echo "✓ worker copiado"

# sesión: reusar si ya está guardada y existe; si no, buscar por nombre; si no, crear
SID=$(cat "$SIDF" 2>/dev/null || true)
if [ -n "$SID" ] && wa GET "/sessions/$SID" | grep -q "\"$SID\""; then
  echo "✓ sesión existente: $SID"
else
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
    [ -n "$SID" ] || { echo "ERROR: OpenWA no creó la sesión"; exit 1; }
    echo "✓ sesión creada: $SID"
  else
    echo "✓ sesión encontrada por nombre: $SID"
  fi
  umask 077; echo "$SID" > "$SIDF"
fi

# webhooks de la sesión personal: tienen que quedar en CERO
WH=$(wa GET "/sessions/$SID/webhooks" || true)
IDS=$(echo "$WH" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
d = d.get("data", d) if isinstance(d, dict) else d
for w in d if isinstance(d, list) else []:
    if isinstance(w, dict) and w.get("id"): print(w["id"])' || true)
for W in $IDS; do wa DELETE "/sessions/$SID/webhooks/$W" >/dev/null; echo "  borrado webhook $W"; done
echo "✓ webhooks de la sesión personal: $(echo "$WH" | head -c 120)"

cat > /etc/cron.d/flexit-liq-wa <<'CRON'
# Mensajes de liquidación por WhatsApp (sesión personal de Alejo) — ver /usr/local/bin/flexit-liq-wa.py
* * * * * root /usr/bin/python3 /usr/local/bin/flexit-liq-wa.py
CRON
chmod 644 /etc/cron.d/flexit-liq-wa
echo "✓ cron instalado"

/usr/bin/python3 /usr/local/bin/flexit-liq-wa.py || true
echo "--- últimas líneas del log ---"; tail -5 /var/log/flexit-liq-wa.log 2>/dev/null || echo "(log vacío: nada que hacer todavía)"
echo "LISTO. SID=$SID"
