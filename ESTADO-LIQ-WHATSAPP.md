# Estado — Mensajes de liquidación por WhatsApp (número personal de Alejo)

*Última actualización: 2026-11-02*

## Objetivo
Los lunes, mandar a cada cadete el mensaje de liquidación ("Buen día X, tengo N envíos entregados y $Y de colecta.") desde el WhatsApp **personal** de Alejo, sin copiar y pegar de a uno. Alejo revisa la tanda, toca **Mandar** y confirma con **OK**; no hay envío programado.

- Implementa: Claude · Revisa: (a definir por Alejo)
- Decisión de Alejo 02/11: número personal vía OpenWA (no el de Flexitbot ni links wa.me), solo con OK. Se le advirtió el riesgo de ban de su número; aceptado.

## Cómo funciona
1. Liquidaciones › Semana › botón **Enviar por WhatsApp** (solo admin). Toma los cadetes de la vista (respeta el filtro de Método: transferencias primero).
2. Cada cadete necesita su celular (`cadetes_tarifas.whatsapp`, formato `549XXXXXXXXXX@c.us`). Se carga ahí mismo; si tu WhatsApp está vinculado, sugiere el contacto que coincide con el nombre ("Usar").
3. Por defecto quedan elegidos los que **no** están avisados y tienen número. **Mandar N mensajes… → OK, mandar** → `rpc/liq_wa_encolar` deja una fila por cadete en `liq_envios`, escalonadas **25–35 s al azar** (~30 s; 65 cadetes ≈ 35 min). La base además exige 25 s reales desde el último enviado, así si la sesión tarda en prender no salen de golpe.
4. VPS: `/usr/local/bin/flexit-liq-wa.py` (cron cada minuto). Si hay cola o la app pidió conectar, **prende** la sesión OpenWA `alejo-liquidaciones` (id en `/root/flexit/liq-wa.sid`), manda de a uno (`liq_wa_tomar` → OpenWA `send-text` → `liq_wa_resultado`). Sin trabajo, la **apaga** (Chrome no queda abierto con tus chats ni come RAM).
5. Envío OK → la fila queda **✓ Avisado** (`pagos_avisos`), igual que con el 💬.
6. Si WhatsApp pide vincular, el QR aparece en el panel (solo admin). Escanear desde **la compu** con el celular: WhatsApp › Dispositivos vinculados.

## Decisiones que hay que conservar
- Nada sale sin OK de Alejo. No hay pg_cron que encole.
- Un mensaje por cadete por semana (índice único). Lo enviado no se reenvía; lo que falló se puede volver a elegir.
- "Enviando" > 5 min sin respuesta → error "revisá en el celu si llegó" y **no** se reintenta solo (lección del bot de colectas: reintentar a ciegas duplica).
- Sin franja horaria: sale cuando Alejo aprieta OK, o a la hora que programe ("Programar" → p_desde). Lo programado prende la sesión recién 3 min antes. Tope 150 por día.
- La sesión personal **no puede tener webhooks** (si no, n8n/agente verían tus chats). El setup los borra.
- El worker nunca reinicia el container (eso es del guardián del bot). Ojo: si el guardián reinicia `openwa-api`, también corta esta sesión; el worker la vuelve a prender si hay trabajo.
- Contactos (04/11): leerlos puede tardar > 1 min; antes se pedían en cada corrida y la cola nunca salía. Ahora: primero la cola; contactos SOLO a pedido ("Actualizar contactos"), sin cola y 1 intento por hora. Pedirlos seguido colgaba WhatsApp Web (Runtime.callFunctionOn timeout).
- Clave del worker = la del guardián (`/root/flexit/bot-wa.key`, hash en `bot_secreto`).
- El texto del mensaje sale de `armarMensaje` en Pagos.js: el mismo para el 💬 y para el envío.

## Archivos
- `supabase/migrations/20261102230000_liquidaciones_whatsapp.sql` — tablas `liq_envios`, `liq_wa_salud`, `liq_wa_contactos`, columna `cadetes_tarifas.whatsapp`, RPCs app (`liq_wa_encolar`, `liq_wa_cancelar`, `liq_wa_encender`) y worker (`liq_wa_plan`, `liq_wa_tomar`, `liq_wa_resultado`, `liq_wa_reportar`, `liq_wa_contactos_subir`).
- `vps/flexit-liq-wa.py` — worker. `vps/setup-liq-wa.sh` — instalación idempotente.
- `src/LiqWhatsapp.js` — panel. `src/Pagos.js` — botón, `armarMensaje`, `recargarAvisados`.

## Pruebas (02/11)
- Migración en Postgres 16 local con stubs (corrida 2 veces = idempotente): no-admin rechazado, número inválido / texto vacío salteados, duplicado salteado, escalonado, uno en curso a la vez, OK → pagos_avisos, error → reintentable, colgado > 5 min → error sin reintento, fuera de horario, cancelar, QR se limpia al estar ready, contactos filtran grupos y sin nombre.
- Worker contra Supabase simulado + docker/OpenWA simulado: apagado sin trabajo → prende al pedir conectar → publica QR → ready: sube contactos, manda 3 (uno falla y queda error), marca avisados → sin trabajo: stop.
- Panel con Playwright (datos simulados): sugerencia de contacto "Caro Gomez Flexit" para "Carolina Gomez", número con 15 (`011 15 4444-5555` → `5491144445555@c.us`), encolar, progreso, error, frenar, QR, celular 390 px. Sin errores de página. `npm run build` OK.
- **No probado en producción todavía**: falta la migración y el setup del VPS (abajo). El formato real de `/contacts` y `/sessions/{id}` de OpenWA se parsea de forma tolerante, pero hay que verlo en vivo.

## Pendiente para que funcione
1. Alejo: correr la migración en Supabase › SQL Editor.
2. VPS (Hermes): `bash vps/setup-liq-wa.sh` desde el repo actualizado; pegar la salida.
3. Alejo, desde la compu: Liquidaciones › Enviar por WhatsApp › **Vincular mi WhatsApp** → escanear QR.
4. Primera tanda de prueba: elegir 2–3 cadetes de confianza antes de mandar a todos.

## Riesgos conocidos
- OpenWA no es la API oficial: ban posible del número personal. Mitigado con pausas al azar, textos distintos por cadete, contactos que ya te conocen, tope diario y sesión apagada fuera de uso.
- Mientras la sesión está prendida, el servidor tiene acceso a tu WhatsApp (por eso se apaga sola).
