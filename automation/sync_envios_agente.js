// sync_envios_agente.js
// Sincroniza los envíos de los últimos días a una tabla Supabase (envios_busqueda)
// que el AGENTE de WhatsApp consulta para responder "¿dónde está mi pedido?".
//
// AISLADO DE MÉTRICAS: escribe SOLO en `envios_busqueda`. No toca `semanas`
// ni el flujo de la carga nocturna (descargar_lightdata.js). Reutiliza el mismo
// login + endpoint de descarga que ya funciona, pero por RANGO de días.

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const XLSX = require('xlsx');
const { upsertRows, upsertPrivateReceipts, getMissingReceiptIds, hasPrivateReceipt } = require('./safe-cache-refresh');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const LD_USER = process.env.LIGHTDATA_USER;
const LD_PASS = process.env.LIGHTDATA_PASSWORD;
const DIAS_ATRAS_DEFAULT = 14; // 90 días calendario: histórico suficiente para arrancar

function fmtFecha(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !LD_USER || !LD_PASS) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_KEY, LIGHTDATA_USER o LIGHTDATA_PASSWORD');
  }
  const diasAtras = Math.max(1, Number(process.env.HISTORICAL_DAYS || DIAS_ATRAS_DEFAULT) - 1);
  const hoy = new Date();
  const desde = new Date(hoy); desde.setDate(hoy.getDate() - diasAtras);
  const fechaDesde = process.env.SYNC_FROM || fmtFecha(desde);
  const fechaHasta = process.env.SYNC_TO || fmtFecha(hoy);
  console.log(`Sincronizando envíos ${fechaDesde} → ${fechaHasta} para el agente...`);

  // Login en LightData (mismo mecanismo que la carga nocturna)
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: process.env.CHROMIUM_PATH || await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  await page.goto('https://flexit.lightdata.app', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input', { timeout: 15000 });
  const inputs = await page.$$('input');
  await inputs[0].type(LD_USER);
  await inputs[1].type(LD_PASS);
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  console.log("Login LightData OK");

  if (process.env.INSPECT_DETAIL_ID) {
    const diagnostic = await page.evaluate(async (id) => {
      const body = new URLSearchParams({ operador: 'get', did: id });
      const response = await fetch('/modules/envios/alta/controlador.php', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
      });
      const payload = await response.json();
      const arrayShapes = Object.entries(payload)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => ({ key, length: value.length, itemKeys: Object.keys(value[0] || {}) }));
      const headerOrigins = Object.fromEntries(Object.entries(payload.header || {})
        .filter(([key]) => /origen/i.test(key)));
      const headerFlags = Object.fromEntries(['flex', 'turbo', 'didMetodoEnvio']
        .map(key => [key, payload.header?.[key]]));
      const receiptValue = payload.header?.envio_alta_recibidopor;
      const receiptShape = {
        type: typeof receiptValue,
        isArray: Array.isArray(receiptValue),
        keys: receiptValue && typeof receiptValue === 'object' ? Object.keys(receiptValue) : [],
        stringLength: typeof receiptValue === 'string' ? receiptValue.length : 0,
        hasDniToken: typeof receiptValue === 'string' && /(?:DNI|DOCUMENTO)/i.test(receiptValue),
      };
      return { rootKeys: Object.keys(payload), headerKeys: Object.keys(payload.header || {}), headerOrigins, headerFlags, receiptShape, arrayShapes };
    }, process.env.INSPECT_DETAIL_ID);
    console.log(`Diagnostico de estructura LightData: ${JSON.stringify(diagnostic)}`);
    await browser.close();
    return;
  }

  // ---- Descarga ----
  // La descarga completa (estado=-1, todos los dias) pesa ~21 MB y tarda minutos:
  // sirve para backfills, no para correr cada media hora. El modo liviano la
  // reemplaza por dos pedidos chicos que juntos no dejan hueco:
  //   A) los seis estados abiertos, con ventana ancha de fecha a planta -> todos
  //      los pendientes, incluso los de hace un mes (los hay).
  //   B) todo lo que se movio en los ultimos dias (tipo_fecha=15, ultimo
  //      movimiento) -> entregas y cancelaciones que ya salieron del conjunto
  //      abierto y hay que actualizar igual.
  // Codigos verificados el 24/09/2026 bajando uno por uno y leyendo la columna
  // Estado: 1 en planta, 2 en camino, 6 nadie, 10 nadie 2da visita,
  // 13 no entregado, 31 reprogramado por meli.
  const ESTADOS_ABIERTOS = process.env.SYNC_ESTADOS || "1,2,6,10,13,31";
  const sincCompleta = process.env.SYNC_COMPLETO === "true";
  const diasMovimiento = Math.max(1, Number(process.env.SYNC_MOV_DIAS || 3));
  const diasAbiertos = Math.max(1, Number(process.env.SYNC_ABIERTOS_DIAS || 90));

  const urlListado = ({ estado, tipoFecha, desde, hasta }) =>
    `https://flexit.lightdata.app/modules/envios/listado/procesar_listado.php`
    + `?cantxpagina=50000&pagina=1&nombre=&cp=&estado=${estado}&excel=1&appersand=false&nombrecliente=`
    + `&fecha_desde=${encodeURIComponent(desde)}&fecha_hasta=${encodeURIComponent(hasta)}`
    + `&tipo_fecha=${tipoFecha}&cadete=&tracking_number=&origen=&zonasdeentrega=&asignado=2`
    + `&logisticaInversa=2&idml=&domicilio=0&turbo=&fotos=2&cobranzas=2&obs=2&cantidadColumnas=1`;

  const bajarExcel = async (etiqueta, params) => {
    const r = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url, { credentials: "include" });
        const buffer = await res.arrayBuffer();
        return { ok: true, status: res.status, size: buffer.byteLength, data: Array.from(new Uint8Array(buffer)) };
      } catch (e) { return { ok: false, error: String(e) }; }
    }, urlListado(params));
    if (!r.ok || r.status !== 200 || r.size < 1000) {
      throw new Error(`Descarga "${etiqueta}": ${r.error || `status=${r.status} size=${r.size}`}`);
    }
    console.log(`Excel ${etiqueta}: ${(r.size / 1024).toFixed(0)} KB`);
    return Buffer.from(r.data);
  };

  const filasDeExcel = (buffer) => {
    const wb = XLSX.read(buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const crudo = XLSX.utils.sheet_to_json(ws, { header: 1 });
    let headerRow = -1;
    for (let i = 0; i < Math.min(10, crudo.length); i++) {
      if (crudo[i] && crudo[i].some(c => String(c || "").includes("Cadete"))) { headerRow = i; break; }
    }
    if (headerRow === -1) throw new Error("No se encontro el header del Excel");
    const headers = crudo[headerRow].map(h => String(h || "").trim());
    return crudo.slice(headerRow + 1)
      .filter(f => f && f.some(c => c !== null && c !== undefined && c !== ""))
      .map(f => { const o = {}; headers.forEach((h, i) => { o[h] = f[i] ?? ""; }); return o; });
  };

  let rows;
  if (sincCompleta) {
    console.log("Modo completo: un solo pedido con todos los estados.");
    rows = filasDeExcel(await bajarExcel("completo",
      { estado: -1, tipoFecha: 6, desde: fechaDesde, hasta: fechaHasta }));
  } else {
    const desdeAbiertos = new Date(hoy); desdeAbiertos.setDate(hoy.getDate() - (diasAbiertos - 1));
    const desdeMovimiento = new Date(hoy); desdeMovimiento.setDate(hoy.getDate() - (diasMovimiento - 1));
    const abiertos = filasDeExcel(await bajarExcel("abiertos", {
      estado: ESTADOS_ABIERTOS, tipoFecha: 6,
      desde: process.env.SYNC_FROM || fmtFecha(desdeAbiertos), hasta: fechaHasta,
    }));
    const movidos = filasDeExcel(await bajarExcel("movimiento", {
      estado: -1, tipoFecha: 15, desde: fmtFecha(desdeMovimiento), hasta: fechaHasta,
    }));
    // El pedido de movimiento es el mas fresco: si un envio aparece en los dos,
    // manda ese (puede haberse entregado despues de salir del listado de abiertos).
    const porId = new Map();
    for (const f of abiertos) porId.set(String(f["ID (Interno)"] ?? "").trim(), f);
    for (const f of movidos) porId.set(String(f["ID (Interno)"] ?? "").trim(), f);
    porId.delete("");
    rows = [...porId.values()];
    console.log(`Abiertos ${abiertos.length} + movidos ${movidos.length} = ${rows.length} unicos`);
  }
  console.log(`Filas parseadas: ${rows.length}`);

  // Mapear solo los campos que el agente necesita para buscar y responder
  const S = (v) => String(v ?? "").trim();
  const envios = rows
    .map(r => ({
      id_interno: S(r["ID (Interno)"]),
      nombre: S(r["Nombre Destinatario"]),
      direccion: S(r["Dirección"] || r["Domicilio"] || r["Domicilio destino"]),
      cp: S(r["CP"]),
      localidad: S(r["Localidad"]),
      provincia: S(r["Provincia"]),
      estado: S(r["Estado"]).replace(/^nan$/i, ""),
      fecha_estado: S(r["Fecha estado"]),
      cadete: S(r["Cadete"]),
      cod_cliente: S(r["Cod.Cliente"]),
      razon_social: S(r["Razon Social"] || r["Nombre Fantasia"]),
      id_venta_ml: S(r["ID venta ML"]),
      origen: S(r["Origen"]),
      tracking: S(r["Número Tracking"]),
      url_tracking: S(r["URl Tracking"]),
      fecha_flexit: S(r["Fecha Flexit"]),
      // "Fecha a planta" es cuando el paquete entro al deposito, la fecha operativa
      // real. "Fecha Flexit" en particulares es la carga de la venta en la tienda del
      // cliente y puede ser de varios dias antes.
      fecha_a_planta: S(r["Fecha a planta"]),
    }))
    .filter(e => e.id_interno); // descartar filas sin ID

  console.log(`Envíos a guardar: ${envios.length}`);

  // Guard: si no se descargó nada, NO vaciar la caché (dejaría al agente de WhatsApp sin poder responder "¿dónde está mi pedido?").
  if (envios.length === 0) {
    await browser.close();
    console.error("⚠️ 0 envíos descargados — se cancela para no vaciar envios_busqueda");
    process.exit(1);
  }

  // El Excel no incluye "Recibido por". Se consulta el detalle interno solo
  // para entregas confirmadas hoy; así cada envío queda enriquecido al cerrarse
  // sin recorrer nuevamente los 14 días en cada ejecución.
  const entregadosHoy = envios.filter(envio =>
    /^entregado/i.test(envio.estado) && envio.fecha_estado.startsWith(fechaHasta),
  );
  const receiptIds = process.env.BACKFILL_RECEIPTS === 'true'
    ? await getMissingReceiptIds({ baseUrl: SUPABASE_URL, key: SUPABASE_KEY })
    : entregadosHoy.map(envio => envio.id_interno);
  console.log(`Consultando receptor de ${receiptIds.length} entregas${process.env.BACKFILL_RECEIPTS === 'true' ? ' historicas incompletas' : ' de hoy'}...`);
  const receiptRows = [];
  const RECEIPT_CHUNK = 500;
  try {
    for (let start = 0; start < receiptIds.length; start += RECEIPT_CHUNK) {
      const chunkRows = await page.evaluate(async (ids) => {
      const results = [];
      let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++];
          try {
            const body = new URLSearchParams({ operador: 'get', did: id });
            const response = await fetch('/modules/envios/alta/controlador.php', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
              body: body.toString(),
            });
            if (!response.ok) continue;
            const payload = await response.json();
            const raw = String(payload?.header?.envio_alta_recibidopor || '').trim();
            if (!raw) continue;
            const documentMatch = raw.match(/\b(?:DNI|DOCUMENTO)\s*:?\s*([\d.\s-]{4,})\b/i);
            const digits = documentMatch?.[1]?.replace(/\D/g, '') || '';
            const name = raw.replace(/\b(?:DNI|DOCUMENTO)\s*:?\s*[\d.\s-]{4,}\b.*$/i, '').trim();
            const masked = `${name}${digits.length >= 4 ? ` DNI:${digits.slice(-4)}` : ''}`.trim();
            const complete = `${name}${digits ? ` DNI:${digits}` : ''}`.trim();
            if (masked && complete) results.push({
              publicRow: { id_interno: id, recibido_por: masked },
              privateRow: { id_interno: id, recibido_por: complete },
            });
          } catch {
            // Un detalle aislado no debe dejar sin actualizar toda la caché.
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
      return results;
      }, receiptIds.slice(start, start + RECEIPT_CHUNK));
      receiptRows.push(...chunkRows);
      console.log(`  receptores ${Math.min(start + RECEIPT_CHUNK, receiptIds.length)}/${receiptIds.length}`);
    }
  } catch (error) {
    await browser.close();
    throw error;
  }
  console.log(`Receptores confirmados: ${receiptRows.length}`);

  // La ficha individual es la fuente de verdad para el indicador Flex y para
  // el historial de asignaciones. En cada pasada se actualizan los envíos de
  // hoy; el backfill manual completa todo el rango de 14 días por única vez.
  const detailCandidates = process.env.BACKFILL_DETAILS === 'true'
    ? envios
    : envios.filter(envio => envio.fecha_flexit.startsWith(fechaHasta));
  const detailRows = [];
  const DETAIL_CHUNK = 400;
  console.log(`Consultando ficha individual de ${detailCandidates.length} envíos...`);
  for (let start = 0; start < detailCandidates.length; start += DETAIL_CHUNK) {
    const chunk = detailCandidates.slice(start, start + DETAIL_CHUNK)
      .map(envio => ({ id: envio.id_interno, fallbackOrigin: envio.origen }));
    const chunkRows = await page.evaluate(async (items) => {
      const results = [];
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const item = items[next++];
          try {
            const body = new URLSearchParams({ operador: 'get', did: item.id });
            const response = await fetch('/modules/envios/alta/controlador.php', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
              body: body.toString(),
            });
            if (!response.ok) continue;
            const payload = await response.json();
            results.push({
              id_interno: item.id,
              origen: String(payload?.header?.flex) === '1' ? 'Flex' : item.fallbackOrigin,
              telefono: String(payload?.header?.destination_receiver_phone || '').trim(),
              asignaciones: Array.isArray(payload?.asignaciones)
                ? payload.asignaciones.map(entry => ({
                    asignado_a: String(entry?.operador || '').trim(),
                    fecha: String(entry?.fecha || '').trim(),
                    quien_asigno: String(entry?.quien || '').trim(),
                    desde: String(entry?.desde || '').trim(),
                  })).filter(entry => entry.asignado_a || entry.fecha)
                : [],
            });
          } catch {
            // Una ficha aislada no debe cancelar la actualización completa.
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(10, items.length) }, worker));
      return results;
    }, chunk);
    detailRows.push(...chunkRows);
    console.log(`  fichas ${Math.min(start + DETAIL_CHUNK, detailCandidates.length)}/${detailCandidates.length}`);
  }
  await browser.close();

  // actualizado_at tiene default now(), asi que solo se escribia al insertar la fila:
  // un domingo sin envios nuevos quedaba con la fecha del ultimo alta y no servia
  // para saber cuando se sincronizo. Ahora cada corrida la estampa en toda la tanda,
  // y la pantalla muestra el maximo como "ultima actualizacion de datos".
  const sincronizadoAt = new Date().toISOString();

  // Primero hace upsert de toda la tanda. Solo después elimina IDs viejos.
  // Si una inserción falla, la caché anterior sigue disponible y completa.
  await upsertRows({
    baseUrl: SUPABASE_URL,
    key: SUPABASE_KEY,
    table: "envios_busqueda",
    rows: envios.map(envio => ({ ...envio, actualizado_at: sincronizadoAt })),
    onProgress: (done, total) => console.log(`  guardados ${done}/${total}`),
  });

  if (receiptRows.length > 0) {
    await upsertRows({
      baseUrl: SUPABASE_URL,
      key: SUPABASE_KEY,
      table: "envios_busqueda",
      rows: receiptRows.map(receipt => receipt.publicRow),
    });
    await upsertPrivateReceipts({
      baseUrl: SUPABASE_URL,
      key: SUPABASE_KEY,
      rows: receiptRows.map(receipt => receipt.privateRow),
    });
  }

  const verifyReceiptId = String(process.env.VERIFY_RECEIPT_ID || '').trim();
  if (verifyReceiptId) {
    const verified = await hasPrivateReceipt({
      baseUrl: SUPABASE_URL,
      key: SUPABASE_KEY,
      id: verifyReceiptId,
    });
    if (!verified) throw new Error(`No se pudo verificar la recepcion del envio ${verifyReceiptId}`);
    console.log(`Recepcion verificada para el envio ${verifyReceiptId}`);
  }

  if (detailRows.length > 0) {
    await upsertRows({
      baseUrl: SUPABASE_URL,
      key: SUPABASE_KEY,
      table: "envios_busqueda",
      rows: detailRows,
    });
  }

  console.log(`✅ Sincronizados ${envios.length} envíos en envios_busqueda (${fechaDesde} → ${fechaHasta}); removidos=0 (historial conservado)`);
}

main().catch(e => { console.error(e); process.exit(1); });
