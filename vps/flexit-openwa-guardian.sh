#!/bin/bash
# Guardián de OpenWA (bot de WhatsApp de Flexit). Corre cada 10 min desde /etc/cron.d/flexit-openwa-guardian.
#  - sesión caída (disconnected/failed/stopped) → la arranca
#  - sesión "ready" pero no responde (Chrome colgado, como el 20/08) 2 veces seguidas → reinicia el container y la arranca
#  - pide QR → no puede hacer nada solo: queda en el log y Colectas muestra "Bot sin señal"
# La API key se lee dentro del container; nunca se escribe en disco ni en el log.
set -u
SID=90b820d7-2f97-4f35-92d5-58687529505a
API=http://localhost:2785/api
LOG=/var/log/flexit-openwa-guardian.log
FALLAS=/var/lib/flexit-openwa-guardian.fallas
exec 9>/run/flexit-openwa-guardian.lock; flock -n 9 || exit 0
log() { echo "$(date '+%F %T') $*" >> "$LOG"; }

api() { # api METODO RUTA [timeout]
  local K; K=$(docker exec openwa-api cat /app/data/.api-key 2>/dev/null) || return 99
  docker exec openwa-api curl -s -m "${3:-20}" -o /dev/null -w '%{http_code}' -X "$1" -H "X-API-Key: $K" "$API$2"
}
estado() {
  local K; K=$(docker exec openwa-api cat /app/data/.api-key 2>/dev/null) || { echo container_caido; return; }
  docker exec openwa-api curl -s -m 20 -H "X-API-Key: $K" "$API/sessions" \
    | grep -o "\"id\":\"$SID\"[^}]*" | grep -o '"status":"[a-z_]*"' | cut -d'"' -f4
}
arrancar() { log "start sesión → $(api POST /sessions/$SID/start 60)"; }

E=$(estado); E=${E:-sin_respuesta}
case "$E" in
  ready|connected|authenticated)
    CODE=$(api GET /sessions/$SID/groups 60)
    if [ "$CODE" = "200" ]; then rm -f "$FALLAS"; exit 0; fi
    N=$(( $(cat "$FALLAS" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$FALLAS"
    log "estado=$E pero /groups respondió '$CODE' (falla $N)"
    if [ "$N" -ge 2 ]; then
      log "reinicio openwa-api"; docker restart openwa-api >/dev/null; sleep 45; arrancar; rm -f "$FALLAS"
    fi ;;
  qr|qr_ready|scan_qr|waiting_qr)
    log "la sesión pide QR: hay que escanear con la línea del bot (5491125841662)" ;;
  initializing|starting|connecting)
    N=$(( $(cat "$FALLAS" 2>/dev/null || echo 0) + 1 )); echo "$N" > "$FALLAS"
    log "estado=$E (esperando, vuelta $N)"
    if [ "$N" -ge 3 ]; then log "trabado en $E → reinicio openwa-api"; docker restart openwa-api >/dev/null; sleep 45; arrancar; rm -f "$FALLAS"; fi ;;
  container_caido)
    log "container caído → docker start"; docker start openwa-api >/dev/null; sleep 45; arrancar ;;
  *)
    log "estado=$E → arranco la sesión"; arrancar ;;
esac
