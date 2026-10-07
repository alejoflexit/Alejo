#!/bin/bash
# Guardián de OpenWA (bot de WhatsApp de Flexit). Corre cada 10 min desde /etc/cron.d/flexit-openwa-guardian.
#  - sesión caída (disconnected/failed/stopped) → la arranca
#  - sesión "ready" pero no responde (Chrome colgado, como el 20/08) 2 veces seguidas → reinicia el container y la arranca
#  - WhatsApp pide QR → lo publica en Supabase cada 15 s durante ~9 min (lo ve solo admin@flexit.app en
#    Colectas › CABA › Bot) y avisa una vez por Telegram
#  - reporta el estado de la sesión en cada corrida (bot_salud.wa_estado)
# Claves: la de OpenWA se lee dentro del container; la de publicación está en /root/flexit/bot-wa.key.
# Ninguna se escribe en el log.
set -u
SID=90b820d7-2f97-4f35-92d5-58687529505a
API=http://localhost:2785/api
SB=https://svlagoosmxxcsbevkrhy.supabase.co
SBKEY=sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI
APP=https://flota-logistica-iota.vercel.app
LOG=/var/log/flexit-openwa-guardian.log
FALLAS=/var/lib/flexit-openwa-guardian.fallas
AVISADO=/var/lib/flexit-openwa-guardian.qr-avisado
exec 9>/run/flexit-openwa-guardian.lock; flock -n 9 || exit 0
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

okey() { docker exec openwa-api cat /app/data/.api-key 2>/dev/null; }
api() { # api METODO RUTA [timeout] → código HTTP
  local K; K=$(okey) || return 99
  docker exec openwa-api curl -s -m "${3:-20}" -o /dev/null -w '%{http_code}' -X "$1" -H "X-API-Key: $K" "$API$2"
}
estado() {
  local K; K=$(okey) || { echo container_caido; return; }
  docker exec openwa-api curl -s -m 20 -H "X-API-Key: $K" "$API/sessions" \
    | grep -o "\"id\":\"$SID\"[^}]*" | grep -o '"status":"[a-z_]*"' | cut -d'"' -f4
}
qr_actual() { # imprime el QR (data:image... o el texto crudo) o nada
  local K; K=$(okey) || return 1
  docker exec openwa-api curl -s -m 20 -H "X-API-Key: $K" "$API/sessions/$SID/qr" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(0)
def buscar(o):
    if isinstance(o, dict):
        if o.get("statusCode", 200) >= 400: return None
        for k in ("qrCode", "qr", "qrcode", "code", "base64", "image", "data"):
            v = o.get(k)
            if isinstance(v, str) and len(v) > 10: return v
        for v in o.values():
            r = buscar(v)
            if r: return r
    return None
r = buscar(d)
if r: print(r)'
}
reportar() { # reportar ESTADO [QR]
  [ -s /root/flexit/bot-wa.key ] || return 0
  python3 - "$1" "${2:-}" <<'PY' | curl -s -m 20 -o /dev/null -X POST "$SB/rest/v1/rpc/bot_wa_reportar" \
      -H "apikey: $SBKEY" -H "Content-Type: application/json" --data-binary @- || true
import json, sys
clave = open("/root/flexit/bot-wa.key").read().strip()
print(json.dumps({"p_clave": clave, "p_estado": sys.argv[1], "p_qr": sys.argv[2] or None}))
PY
}
telegram() {
  local ENV=/root/.hermes/.env TOKEN CHAT
  TOKEN=$(grep -m1 '^TELEGRAM_BOT_TOKEN=' "$ENV" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ')
  CHAT=$(grep -m1 '^TELEGRAM_HOME_CHANNEL=' "$ENV" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ')
  [ -z "$CHAT" ] && CHAT=$(grep -m1 '^TELEGRAM_ALLOWED_USERS=' "$ENV" 2>/dev/null | cut -d= -f2- | tr -d '"'"'"' ' | cut -d, -f1)
  [ -n "$TOKEN" ] && [ -n "$CHAT" ] || { log "telegram: faltan TOKEN/CHAT en $ENV"; return 1; }
  curl -s -m 20 -o /dev/null -w '%{http_code}' "https://api.telegram.org/bot$TOKEN/sendMessage" \
    --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$1"
}
arrancar() { log "start sesión → $(api POST /sessions/$SID/start 60)"; }

# WhatsApp pide QR: publicarlo cada 15 s hasta que lo escaneen (máx ~9 min; la próxima corrida sigue)
modo_qr() {
  if [ ! -f "$AVISADO" ]; then
    log "la sesión pide QR → aviso por Telegram ($(telegram "⚠️ El WhatsApp del bot de Flexit se desvinculó y pide QR. Abrí $APP → Colectas › CABA › botón rojo y escanealo con el teléfono de la línea del bot (WhatsApp › Dispositivos vinculados)."))"
    touch "$AVISADO"
  fi
  local i Q E
  for i in $(seq 1 36); do
    Q=$(qr_actual)
    if [ -z "$Q" ]; then
      E=$(estado); reportar "${E:-sin_respuesta}"
      case "$E" in ready|connected|authenticated) log "QR escaneado: sesión $E"; rm -f "$AVISADO" "$FALLAS";; esac
      return
    fi
    reportar qr "$Q"
    sleep 15
  done
}

E=$(estado); E=${E:-sin_respuesta}
case "$E" in
  ready|connected|authenticated)
    rm -f "$AVISADO"
    CODE=$(api GET /sessions/$SID/groups 60)
    if [ "$CODE" = "200" ]; then rm -f "$FALLAS"; reportar "$E"; exit 0; fi
    N=$(( $(cat "$FALLAS" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$FALLAS"
    log "estado=$E pero /groups respondió '$CODE' (falla $N)"; reportar colgado
    if [ "$N" -ge 2 ]; then
      log "reinicio openwa-api"; docker restart openwa-api >/dev/null; sleep 45; arrancar; rm -f "$FALLAS"
    fi ;;
  container_caido)
    log "container caído → docker start"; reportar container_caido
    docker start openwa-api >/dev/null; sleep 45; arrancar ;;
  *)
    # cualquier otro estado: si hay QR disponible, es que hay que escanear
    if [ -n "$(qr_actual)" ]; then modo_qr; exit 0; fi
    reportar "$E"
    case "$E" in
      initializing|starting|connecting)
        N=$(( $(cat "$FALLAS" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$FALLAS"
        log "estado=$E (esperando, vuelta $N)"
        if [ "$N" -ge 3 ]; then log "trabado en $E → reinicio openwa-api"; docker restart openwa-api >/dev/null; sleep 45; arrancar; rm -f "$FALLAS"; fi ;;
      *)
        log "estado=$E → arranco la sesión"; arrancar
        sleep 30; [ -n "$(qr_actual)" ] && modo_qr ;;
    esac ;;
esac
