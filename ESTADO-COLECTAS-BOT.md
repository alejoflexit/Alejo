# Estado — Bot de confirmación de colectas (piloto CABA)

*Última actualización: 2026-10-06*

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

## Pendientes / limitaciones
- Feriados: el cron pregunta igual un feriado de semana. Si molesta, agregar tabla de feriados.
- La sección 📱 Grupos de la tiquetera no tiene badge para `solo_envio` (se ve como estado desconocido).
- Si el bot no está en el grupo, no aparece en la lista (el sync de grupos corre cada 15 min).
