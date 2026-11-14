# Estado — Seguridad (Etapa 1, desde 13/11/2026)

**Objetivo:** que nadie sin usuario pueda leer o modificar datos de Flexit, y que no haya claves en el código.
**Implementa:** Claude · **Aprueba y ejecuta lo que requiere acceso:** Alejo.

## Hallazgos (ordenados por riesgo)
1. **El repo `alejoflexit/alejo` es PÚBLICO.** Todo el código, las migraciones (el esquema de la base) y el historial completo se pueden leer sin login.
2. **La contraseña del usuario `beto` de LightData está en el historial público** (estuvo escrita en `automation/*.js` desde junio hasta el 10/11). Mientras no se cambie, cualquiera puede entrar a LightData como beto.
3. **La clave del bridge del VPS estaba en el frontend** (5 pantallas + `automation/colecta_snapshot.js`). Con ella cualquiera podía leer el GPS de los cadetes (`/geo`), el reparto, la colecta y el QR de cualquier envío.
4. 11 tablas con lectura anónima + `reportes_bug` con escritura anónima (pendiente de la auditoría del 02/08). A confirmar con la consulta en vivo.
5. No se encontraron en el historial: claves service_role, tokens de GitHub, de Anthropic ni de Telegram. El JWT que aparece es el `anon` (público por diseño).

## Arreglo de la clave del bridge (en curso)
- Función nueva `supabase/functions/bridge`: exige usuario logueado, permite solo las 6 rutas que usa la app, y agrega la clave del lado del servidor (secreto `BRIDGE_KEY`).
- Frontend: todas las pantallas pasan por `src/bridge.js`. **Transición:** si la función todavía no está desplegada, usa el camino viejo con la clave (`LEGACY_KEY`).
- Deploy: workflow `supabase_funciones.yml` (secretos de GitHub `SUPABASE_ACCESS_TOKEN` y `BRIDGE_KEY`).
- Pasos, en orden:
  1. Alejo carga los secretos en GitHub y corre el workflow → la app empieza a usar la función sola.
  2. Verificar Monitoreo, Zonas, Colectas (+ GPS y detalle), Tiquetera (QR) y Alertas de reparto con sesión iniciada.
  3. **Rotar la clave del VPS** (`/root/flexit/bridge.key`), actualizar el secreto `BRIDGE_KEY` en GitHub y volver a correr el workflow.
  4. Borrar `LEGACY_KEY` y el respaldo de `src/bridge.js`, y el literal de `automation/colecta_snapshot.js`.
- Efecto buscado: sin sesión, Monitoreo / Zonas / Colectas en vivo dejan de mostrar datos (piden iniciar sesión).

## Pendiente
- Decidir si el repo pasa a privado (ojo: GitHub Actions en privado incluye 2.000 min/mes gratis; hoy se usan ~3.600).
- Cambiar la contraseña de `beto` en LightData (o darlo de baja).
- RLS: cerrar lectura anónima de las tablas que confirme la consulta en vivo (antes, pasar sus lecturas a `authedFetch`).
