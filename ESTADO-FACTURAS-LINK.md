# Estado — Facturas de cadetes por link

*Última actualización: 2026-11-19*

## Objetivo
Que cada cadete suba su factura desde un link propio, en vez de que Alejo junte ~60-70 facturas en un grupo y Adrián las cargue a mano. Piloto: **5 cadetes el lunes 23/11**. Etapa 2 (aparte): cargar las facturas solas en Xubio.

- Implementa: Claude · Revisa: (a definir por Alejo)
- Decisiones de Alejo (18-19/11): link con código al azar (no el nombre); el monto aparece en el link recién cuando Alejo lo confirma (lo hace de a uno, hablando con cada cadete); el cadete sube la factura y queda "listo para pagar".

## Cómo funciona
1. **Liquidaciones › Config**, fila del cadete (solo los que facturan): **+ Link factura** crea el link y lo copia. Después el botón dice **🔗 Link factura** (copia) y **↻** lo cambia (el viejo deja de andar). Link: `/factura.html?t=<cadetes_tarifas.factura_token>`.
2. Si el cadete tiene link, el **mensaje de liquidación del lunes** (💬 y envío por WhatsApp) suma: "Cuando te confirme el monto, subí tu factura acá: …".
3. Hasta que Alejo toca **Confirmar** en Liquidaciones, el link dice "Tu liquidación está en revisión". Confirmado → muestra el monto.
4. El cadete sube PDF o foto. Del PDF se leen tipo (factura / nota de débito / nota de crédito), número, importe y CUIT.
   - PDF y neto (facturas + ND − NC) = monto → **"Mandó factura" se marca solo** → aparece en **Listos para pagar** de Adrián.
   - Neto menor → el link le pide una **nota de débito** por la diferencia; mayor → **nota de crédito**.
   - Foto (importe escrito por el cadete), PDF ilegible o CUIT distinto al cargado en Config → queda **"📄 Revisar factura"** en Pagar: Adrián/Alejo la abre y toca "Mandó factura".
5. Si después cambia el total (descuento, extraviado, reabrir) el OK puesto por el link se cae solo y el link pide la diferencia.

## Decisiones que hay que conservar
- La página pública no lee ni escribe tablas: solo `factura_link_info / _registrar / _borrar` (security definer, validan token). El único permiso anónimo es **subir** al bucket privado `facturas` dentro de `link/<token válido>/` (pdf/jpg/png/webp/heic). No puede leer, listar, pisar ni borrar.
- Lo pagado no se toca: con el cierre pagado el link no acepta ni saca comprobantes.
- El link nunca desmarca un "Mandó factura" puesto a mano (`pagos_cierres.factura_link = false`).
- Pago dividido: se factura solo la parte que va por transferencia. Efectivo: no pide factura.
- Tope 15 comprobantes por cierre por día (antispam).

## Archivos
- `supabase/migrations/20261119130000_facturas_link.sql` — `cadetes_tarifas.factura_token`, `pagos_cierres.factura_monto / factura_link`, tabla `facturas_comprobantes`, trigger `factura_link_total`, RPCs, política de storage `facturas_link_subir`.
- `public/factura.html` — página del cadete.
- `src/Pagos.js` — botón de link en Config + link en `armarMensaje`.
- `src/PagosPagador.js` — chip "📄 Revisar factura" (subida por link que no cerró sola).

## Pruebas (19/11)
- Migración en Postgres 16 local con stubs de auth/storage, corrida 2 veces (idempotente).
- SQL como `anon`: en revisión, link inválido, factura menor → falta ND, ND completa → OK solo, descuento → se cae, NC → OK, duplicado, archivo de otro token, sacar comprobante, manual sobrevive, pagado bloqueado, dividido (solo transferencia), CUIT distinto → revisar, foto → revisar, efectivo, anon no lee la tabla, storage rechaza otro token / fuera de link/ / .exe.
- Página con Playwright (390 px y desktop) contra esa base real: PDFs tipo AFIP generados (factura $170.000 + ND $15.000) leídos con pdf.js 3.11.174 → tipo, nro, importe y CUIT correctos; foto con importe a mano; sacar; pagado. Sin errores de página.
- `npm run build` OK (sin warnings nuevos).
- **No probado en producción**: falta correr la migración.

## Pendiente para el lunes
1. Alejo: correr la migración en Supabase › SQL Editor.
2. Alejo: en Config, crear el link de los 5 cadetes del piloto (y revisar que tengan el CUIL cargado: si no, el chequeo de CUIT no corre).
3. Lunes: mandar el mensaje de liquidación como siempre (ya trae el link) y confirmar de a uno.

## Etapa 2 — Xubio
- API: OAuth2 client credentials (`https://xubio.com/API/1.1/TokenEndpoint`), requiere plan PLUS. Credenciales en Configuración → Integraciones → API de Xubio.
- Bloqueo: el proyecto de Supabase de la app no está en el conector de Claude; los secretos `XUBIO_CLIENT_ID / XUBIO_SECRET_ID` los carga Alejo en Supabase › Edge Functions › Secrets. Las credenciales que se pegaron en el chat del 19/11 hay que regenerarlas.
