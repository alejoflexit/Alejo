# Estado — Doble bulto

**Objetivo (Alejo, 08/11/2026):** reemplazar "foto del paquete → grupo de Facebook → foto por foto → Excel" por un escaneo en la app. Se escanea el QR de cada paquete de más de un bulto al ingresar, se confirma la cantidad y queda guardado. La tabla se copia y se pega en el Excel de siempre.

**Implementó:** Claude · **Revisa:** pendiente (Alejo / ChatGPT).

## Decisiones aprobadas
- El QR de ML trae solo número de envío + vendedor (sender_id), no la dirección. La dirección, el CP y la localidad (= "Zona" del Excel) se completan solos cuando el envío aparece en `envios_busqueda`. El cruce lo hace la pantalla al abrirse y cada 3 min.
- Salida = tabla con botón "Copiar para Excel" (no export automático). Orden de columnas del Excel: FECHA · Cliente · Nro de venta · Dirección · Num bultos · Zona. Se copia sin encabezado, del más viejo al más nuevo.
- "Nro de venta" = el número de envío que trae el QR (cruza con LightData).
- Escaneo rápido: escanear → tarjeta con cliente y bultos (2 por defecto, chips 2–6 y −/+) → Confirmar → sigue con el próximo. Sin foto.
- Un registro por envío (`codigo` único). Re-escanear muestra "ya estaba cargado" y solo deja cambiar los bultos.
- Permiso: la sección la ve quien ve Devoluciones (alias en `permisos.js`), para no tener que redeployar la edge function `admin-usuarios`.

## Archivos
- `src/DobleBulto.js` (pantalla + escáner), `src/dobleBultoShared.js` (+ test), `src/App.js`, `src/Home.js`, `src/permisos.js`
- `supabase/migrations/20261108200000_doble_bultos.sql` — tablas `doble_bultos` y `ml_vendedores` (sender_id → cliente, se aprende sola).

## Estado
- Editado, tests de la lógica (9) OK, `npm run build` OK.
- Commit/push: ver git log.
- **Migración: falta correrla** (Alejo, Supabase › SQL Editor). Sin ella la pantalla avisa y no guarda.
- No probado en producción con etiquetas reales.

## Pendientes / a validar
- Confirmar con una etiqueta real que el envío de ML cruza por `tracking` en `envios_busqueda`.
- Clientes no-ML (ej. Unistore): ver qué trae su QR y si cruza.
- Si un envío nunca aparece en LightData, queda marcado "No apareció en LightData" a los 3 días.
