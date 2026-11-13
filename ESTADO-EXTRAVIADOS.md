# Estado — Extraviados y rotos

**Objetivo (Alejo, 13/11/2026):** reemplazar el Excel "Paquetes extraviados que debemos descontar de la factura del cliente" por una sección conectada a los pagos de la semana: se carga el IDML, toma el valor declarado de LightData, se tilda "Descontar" y queda como descuento del transportista en Liquidaciones, en uno o varios pagos (cuotas).

**Implementó:** Claude · **Revisa:** pendiente (Alejo / ChatGPT).

## Decisiones
- Vive en **Liquidaciones › 📦 Extraviados** (solo admin: es plata, igual que el resto de Liquidaciones).
- El descuento al transportista = filas de `pagos_ajustes` con `extraviado_id` + `cuota`, una por semana consecutiva desde la semana elegida. Liquidaciones no tiene lógica nueva: las muestra como cualquier descuento y el cierre las congela.
- Cuotas enteras; la última absorbe el redondeo (suman exacto). 1 a 12 cuotas.
- No se crea ni se borra una cuota de una semana ya **pagada**. Si el chofer está confirmado (no pagado), se ajusta el total congelado del cierre igual que el descuento manual (y avisa si ya tenía factura marcada).
- Valor: `valor_manual` (si se carga) manda sobre `valor_declarado` de LightData.
- Mientras está tildado, transportista / cuotas / semana / valor quedan bloqueados: para cambiarlos se destilda (saca las cuotas no pagadas) y se vuelve a tildar.
- "Copiar para Excel": mismas columnas que la planilla (fecha, cliente, transportista, info, valor, obs, IDML) por si hay que mandarlo al cliente.

## Archivos
- `src/Extraviados.js` (pantalla), `src/extraviadosShared.js` (+ test, 7 casos), `src/Pagos.js` (pestaña + aviso al borrar una cuota desde la Semana)
- `supabase/migrations/20261113150000_extraviados.sql` — tabla `extraviados` + columnas `extraviado_id`, `cuota` en `pagos_ajustes`
- `automation/sync_extraviados.js` + `.github/workflows/extraviados.yml` — trae el valor declarado de la ficha de LightData cada 30 min (08:10–20:40). Si no hay pendientes, no abre LightData.

## Estado
- Tests de la lógica OK, `npm run build` OK.
- **Migración: falta correrla** (Supabase › SQL Editor). Sin ella la pestaña avisa y no guarda; el resto de Liquidaciones no se toca.
- No probado en producción con datos reales.

## Pendientes / a validar
- Envíos de más de ~14 días no están en `envios_busqueda`: si el código no es el ID de LightData, el valor hay que cargarlo a mano (la fila lo indica).
- Confirmar con un envío real que `header.valor_declarado` de la ficha es el mismo "Valor declarado del paquete" que muestra LightData.
- Cargar las filas viejas del Excel (opcional).
