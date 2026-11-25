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

## Pendiente
1. Alejo corre la migración (Supabase › SQL Editor). Después se cargan los vínculos iniciales.
2. Clientes sin cuenta y clientes verdes que LightData casi nunca registra (Lemirk, Ursino, Gastrofactory, etc.): definir con Alejo.
3. Alerta 13:30 al grupo de soporte (falta definir canal y armarla).
