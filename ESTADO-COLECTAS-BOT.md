# Estado — Bot de confirmación de colectas (piloto CABA)

*Última actualización: 2026-10-07*

## Objetivo
Que los clientes confirmen solos si tienen colecta, con un link, en vez de que el equipo pregunte grupo por grupo. Piloto: solo clientes de **CABA**.

- Implementa: Claude · Revisa: (a definir por Alejo)
- Diseño aprobado: canvas "Confirmar colecta — link cliente" (sin horario de retiro, decisión de Alejo 05/10).

## Cómo funciona
1. Cada cliente tiene un **link fijo**: `/colecta.html?t=<bot_token>` (columna `colectas_clientes.bot_token`).
2. En Colectas → pestaña CABA → botón **"Bot de confirmación"**: el equipo elige el grupo de WhatsApp de cada cliente y prende el bot. Los fijos (amarillos) no se preguntan.
3. **Lun-vie 9:00 AR** (`pg_cron` `colectas_bot_9am`, 12:00 UTC) → `colecta_bot_encolar()` crea un caso `estado='enviando'` por cliente con el link, escalonados cada 20 s (`casos.enviar_desde`). No pregunta a quien el equipo ya marcó ese día.
4. El workflow n8n **"Flexit WA - Enviar aprobados"** (ya existente) los manda leyendo la vista `casos_enviables`.
5. El cliente toca **Sí / Hoy no** → `colecta_link_responder()` → `colectas_registros` queda **amarillo** (sí) o **rojo** (hoy no) + `link_respuesta/link_at/link_bultos`. Corte 13:00 AR (antes 11:30; cambiado 06/10).
6. En la tabla de Colectas aparece la marca 🔗 "Sí 9:14" / "Hoy no" al lado del nombre (realtime).

## Decisiones que hay que conservar
- El link **nunca pisa** un estado puesto por el equipo (verde, o amarillo/rojo marcado a mano). Solo cambia blanco o lo que había puesto el mismo link.
- Grupos nuevos del bot entran `pendiente` (mudo: el agente no lee ni contesta). Al prender el bot de un cliente, su grupo pasa a **`solo_envio`**: el bot puede mandar ahí, pero el filtro del agente (solo `activo`) lo sigue ignorando. Al apagarlo vuelve a `pendiente`.
- Grupos `activo` / `inactivo` los maneja Alejo desde la tiquetera; el panel no los toca.
- Envío escalonado (20 s) para no gatillar el antispam de WhatsApp (OpenWA no es API oficial).

## Archivos
- `supabase/migrations/20261006010000_colectas_bot_link.sql` (aplicada en producción 2026-10-06)
- `public/colecta.html` — página pública del cliente
- `src/ColectasBot.js` — panel de configuración
- `src/Colectas.js` — botón en CABA, marca 🔗 en la fila, campos link_* en el registro

## Pruebas
- SQL (en transacción revertida, con hora simulada 09:30): info, sí + bultos → amarillo con choferes precargados, cambio a no → rojo, verde no se pisa, token inválido, cerrado después de 11:30, encolado con link correcto.
- Página: render en celular y compu con API simulada (pregunta, confirmado, hoy no, cerrado, link inválido).
- `npm run build` OK. Commit `09ff1b1` pusheado a main.
- Producción: `/colecta.html` responde y consulta la base (token inválido → "Este link no funciona"; token real con bot apagado → "Este link está pausado").

## Estado de salida (2026-10-06 20:15) — DESBLOQUEADO
- Sesión OpenWA `flexit-agente` vinculada al número original del bot **5491125841662** ("Soporte Flexit").
- n8n "Flexit WA - Enviar aprobados": nodo "Enviar por WhatsApp (OpenWA)" con **On Error = Continue** + **Timeout 60 s**, publicado. Así el PATCH "Marcar esperando_cliente" corre siempre (toma el id de "Casos aprobados (Supabase)") y no hay reenvíos. Prueba #203 a "Flexit test": llegó y quedó `esperando_cliente` (una sola vez).
- Contra aceptada: un envío que falla de verdad no se reintenta; ese cliente aparece como "sin responder" a las 11.
- Historia del bloqueo: Chrome de OpenWA colgado desde el 20/08 + sesión caída; durante el fix duplicaba (n8n daba timeout después de mandar). VPS: swap 2 GB, reinicio diario del bridge 05:00, reintentos en el disparador de métricas.
- Siguiente: Santi agrega 5491125841662 a los grupos de CABA → aparecen en `agente_config` como `pendiente` (sync cada 15 min) → los configura en Colectas › CABA › "Bot de confirmación". Arrancar con ~10 clientes la primera semana.

## Parche OpenWA (2026-10-07) — detector de grupos
- Síntoma: "Flexit WA - Sync grupos" fallaba cada 15 min (500). Causa: whatsapp-web.js 1.34.7 + WhatsApp Web 2.3000.x renombró `MsgKey._serialized` → `$1`; `getChats()` tira `r: r` (wwebjs issue #201862). Enviar seguía funcionando.
- Arreglo: getter `_serialized → $1` inyectado al inicio de `LoadUtils` en `src/util/Injected/Utils.js`. El container es `read_only`, así que el archivo parcheado se monta desde `/opt/flexit/openwa/patches/wwebjs-Utils.js` vía `docker-compose.override.yml` (que conserva `SSRF_ALLOWED_HOSTS=n8n`). Copias: `/root/Utils.js.orig`, `/root/override-original.yml`.
- Verificado: sesión `ready` sin QR, `/groups` devuelve la lista (Sabor Pampeano incluido), envío a Flexit test OK (#209).
- Volver atrás: `cp /root/override-original.yml /opt/flexit/openwa/docker-compose.override.yml && docker compose up -d --no-deps openwa-api`.
- Sacar el parche cuando salga una versión de whatsapp-web.js corregida y se actualice OpenWA.

## Robustez (2026-10-07) — migración `20261007230000_colectas_bot_robustez.sql`
**Aplicada 2026-10-07 20:15** (Alejo, desde Supabase › SQL Editor). Verificado: el Sync de n8n de las 20:15:37 actualizó `bot_salud.ultimo_sync`; cron en `0,30 12-13 * * 1-5`; 16 feriados; 0 casos del bot abiertos.
- **Señal de vida:** tabla `bot_salud`. Cada corrida del "Sync grupos" de n8n (upsert a `agente_config`, cada 15 min) actualiza `ultimo_sync` vía trigger de statement (cuenta todo lo que no sea rol `authenticated`, o sea los cambios del equipo desde la app no cuentan).
- **Guardia en encolar:** si `ultimo_sync` tiene más de 40 min, no encola (los mensajes se perderían) y deja `ultimo_aviso`. Cron ahora 9:00, 9:30, 10:00 y 10:30 (`'0,30 12-13 * * 1-5'`); el dedupe por día evita duplicados y permite recuperarse si el guardián levanta OpenWA.
- **App:** `rpc/colecta_bot_estado` → el botón de CABA se pone rojo "Bot sin señal desde HH:MM" y el panel muestra el aviso. Sin la migración, la llamada falla en silencio y no se muestra nada.
- **Grupo compartido:** si varios clientes con bot usan el mismo grupo, el mensaje dice "¿Tienen colecta hoy en *Cliente*?".
- **Tiquetera limpia:** trigger `caso_bot_autoresolver`: un caso de 'Bot colectas' que pasa a `esperando_cliente` queda `resuelto` (y marca `bot_salud.ultimo_envio`).
- **Feriados:** tabla `feriados` (nacionales de días de semana, oct-2026 a dic-2027; los trasladables de 2027 están "a confirmar" con el decreto). Ese día no se manda.
- **Cliente de prueba:** oculto en Colectas, Home y Pizarra (`bot_prueba=not.is.true`). Sigue existiendo y manda su link diario a "Flexit test" para verificar que todo funciona.

## Guardián OpenWA (VPS) — `vps/flexit-openwa-guardian.sh`
- **Instalado 2026-10-07** (primera corrida OK, log vacío). Cada 10 min (`/etc/cron.d/flexit-openwa-guardian`). Sesión caída → start. "ready" pero `/groups` no responde 2 veces → `docker restart openwa-api` + start. Trabada en initializing 30 min → restart. Pide QR → solo log (hay que escanear con la línea del bot).
- Log: `/var/log/flexit-openwa-guardian.log`. La key se lee dentro del container, no se guarda.

## QR del bot en la app (2026-10-07) — migración `20261007233000_bot_wa_qr.sql`
- **Aplicado y verificado 2026-10-07 20:25:** migración corrida por Alejo, Telegram de prueba OK (200), el guardián reportó `wa_estado=ready` con la clave válida.
- Si WhatsApp desvincula el bot, el guardián publica el QR cada 15 s (`rpc/bot_wa_reportar`, validado contra el hash de `/root/flexit/bot-wa.key`; tabla `bot_secreto` sin políticas) y avisa una vez por Telegram (token/chat de `/root/.hermes/.env`).
- Colectas › CABA: el botón dice "Bot pide QR"; en el panel, **solo admin@flexit.app** ve el QR (RLS de `bot_qr` por email). El resto ve "avisale a Alejo".
- Cada corrida del guardián reporta `bot_salud.wa_estado`. El QR se borra solo cuando la sesión vuelve a `ready`.
- Si se regenera la clave del VPS, actualizar `bot_secreto.clave_hash` con `sha256sum < /root/flexit/bot-wa.key`.

## Barrido 11:30 (2026-10-08) — migración `20261008000000_colectas_barrido_1130.sql`
- pg_cron `colectas_bot_barrido` (`30 14 * * 1-5` = 11:30 AR, salta feriados) → `colecta_bot_barrido()` deja una nota en la Pizarra (autor 'Bot colectas', ⏰ antes de las 13) con los clientes del bot que no respondieron. Si respondieron todos, no deja nada; si se corre de nuevo, actualiza la misma nota.

## Pendientes / limitaciones
- Cargar los feriados de 2028 a fin de 2027 (tabla `feriados`).
- La sección 📱 Grupos de la tiquetera no tiene badge para `solo_envio` (se ve como estado desconocido).
- Si el bot no está en el grupo, no aparece en la lista (el sync de grupos corre cada 15 min).
