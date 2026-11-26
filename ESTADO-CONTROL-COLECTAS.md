# Estado — Control de colectas en Arribos

*Última actualización: 2026-11-25*

## Objetivo
Saber si cada chofer pasó por las colectas que se le asignaron (el 25/11 dos cadetes no pasaron). Corte: **13:30** — a esa hora tiene que estar todo colectado.

- Implementa: Claude · Revisa: (a definir por Alejo)
- Diseño aprobado por Alejo (25/11): sección aparte arriba de Arribos, mismo estilo que "X de Y cadetes llegaron"; en la ficha de cada chofer solo un chip "2/3 colectadas".

## Cómo funciona
- Fuente: informe "Colecta por cliente" de LightData, que ya baja el bridge (`/colecta` → `clientes[{idCliente, cantidad}]`). Se registra cuando el chofer escanea en el local del cliente.
- Vínculo cliente de Colectas ↔ cuenta(s) LightData: tabla `colectas_cliente_ld`. `ld_id` = idCliente del informe = `clientes_tokens.id_interno`. Un cliente puede tener varias cuentas; una cuenta puede ser de varias sucursales (La Plata Trade, Icono G).
- Estados (`src/controlColectasShared.js`): colectada (envíos > 0 en alguna cuenta, o marca manual) · pendiente · vencida (pasó el corte) · sin vincular · sin datos (LightData no respondió → nunca se marca vencida por un error nuestro).
- Colectas asignadas = mismo criterio que la lista de Arribos (verde o confirmada para ese chofer; sin rojo ni "A coordinar").
- Arribos refresca LightData cada 2 min el día de hoy.
- Marca manual "Marcar colectada" (dos toques) en `colectas_registros.colectado_manual_at/_por`.
- Vincular cuentas: desde Arribos (fila "sin vincular") o en Colectas → Clientes → ficha → "Cuentas en LightData".

## Archivos
- `supabase/migrations/20261125233000_control_colectas.sql`
- `src/controlColectasShared.js` (+ test) · `src/ControlColectas.js` · `src/Colectas.js`

## Vínculos iniciales
Cruzados por Claude el 25/11 (nombre + días en que el cliente estuvo verde y LightData registró colecta, 16 días hábiles) y confirmados por Alejo los dudosos. Se cargan con `origen='auto'`.

## Respaldo "entró a planta" (25/11 noche)
- Algunos choferes se saltean "colectado" y lo ponen directo en planta. Por eso también cuenta como colectada si los envíos del cliente con Fecha Flexit de hoy ya no están "A retirar" (envios_busqueda, sync cada 5 min de 13 a 16 hs).
- Código LD de cada cuenta: `colectas_cliente_ld.ld_codigo` (llenado por nombre de fantasía) o `clientes_tokens`. El sync ahora guarda `envios_busqueda.nombre_fantasia`.
- Índice `envios_busqueda_fecha_flexit_pref` (la consulta pasó de ~6 s a 0,2 s).
- Resultado 25/11: 112 de 120. Rojas reales: Titilandia, Energon, Van Beek, SC Neumáticos, Phi Digital, Iamique, SecoTop (+ Imperial Imports sin cuenta).

## Pendiente
1. ~~Migración y vínculos iniciales~~ hechos (229 vínculos, 217 con código).
2. Clientes sin cuenta y clientes verdes que LightData casi nunca registra (Lemirk, Ursino, Gastrofactory, etc.): definir con Alejo.
3. Alerta 13:30 al grupo de soporte (falta definir canal y armarla).
