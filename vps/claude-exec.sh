#!/bin/bash
# Unica puerta de entrada de Claude (via GitHub Actions) al VPS.
# La clave SSH esta forzada a este script en authorized_keys, asi que la sesion
# remota NO tiene shell: solo puede pedir los comandos de esta lista.
# Para agregar un comando hay que editar este archivo EN EL VPS a proposito:
# asi el alcance de la clave es explicito y no lo puede ampliar quien la tenga.
set -eu

CMD="${SSH_ORIGINAL_COMMAND:-}"
REGISTRO=/var/log/claude-exec.log
printf '%s | %s\n' "$(date -Is)" "${CMD:-<vacio>}" >> "$REGISTRO" 2>/dev/null || true

case "$CMD" in
  salud)
      KEY=$(cat /root/flexit/bridge.key)
      curl -sf -m 10 -H "x-bridge-key: $KEY" http://127.0.0.1:8787/salud
      ;;
  servicios)
      for s in lightdata-bridge hermes-inbox; do
        printf '%s: %s\n' "$s" "$(systemctl is-active "$s" 2>/dev/null || echo desconocido)"
      done
      uptime
      ;;
  cron-list)
      crontab -l 2>/dev/null || echo "(sin crontab)"
      ;;
  journal-bridge)
      journalctl -u lightdata-bridge -n 60 --no-pager
      ;;
  deploy-bridge)
      bash /root/obsidian-flexit/vps/deploy-bridge.sh
      ;;
  *)
      echo "comando no permitido: ${CMD:-<vacio>}" >&2
      exit 2
      ;;
esac
