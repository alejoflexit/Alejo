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
const fs = require('fs');
const path = require('path');
const { refreshCacheSafely, upsertRows, upsertPrivateReceipts, getMaskedReceiptIds } = require('./safe-cache-refresh');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const LD_USER = process.env.LIGHTDATA_USER;
const LD_PASS = process.env.LIGHTDATA_PASSWORD;
const DIAS_ATRAS = 13; // 14 días calendario: 13 hacia atrás + hoy

function fmtFecha(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !LD_USER || !LD_PASS) {
    throw new Error('Faltan SUPABASE_URL, SUPABASE_KEY, LIGHTDATA_USER o LIGHTDATA_PASSWORD');
  }
  const hoy = new Date();
  const desde = new Date(hoy); desde.setDate(hoy.getDate() - DIAS_ATRAS);
  const fechaDesde = fmtFecha(desde);
  const fechaHasta = fmtFecha(hoy);
  console.log(`Sincronizando envíos ${fechaDesde} → ${fechaHasta} para el agente...`);

  const downloadPath = '/tmp/lightdata-agente';
  fs.mkdirSync(downloadPath, { recursive: true });

  // Login en LightData (mismo mecanismo que la carga nocturna)
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
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
      return { rootKeys: Object.keys(payload), headerKeys: Object.keys(payload.header || {}), headerOrigins, headerFlags, arrayShapes };
    }, process.env.INSPECT_DETAIL_ID);
    console.log(`Diagnostico de estructura LightData: ${JSON.stringify(diagnostic)}`);
    await browser.close();
    return;
  }

  // Descargar Excel del RANGO (mismo endpoint, con fecha_desde != fecha_hasta)
  const excelUrl = `https://flexit.lightdata.app/modules/envios/listado/procesar_listado.php?cantxpagina=50000&pagina=1&nombre=&cp=&estado=-1&excel=1&appersand=false&nombrecliente=&fecha_desde=${encodeURIComponent(fechaDesde)}&fecha_hasta=${encodeURIComponent(fechaHasta)}&tipo_fecha=6&cadete=&tracking_number=&origen=&zonasdeentrega=&asignado=2&logisticaInversa=2&idml=&domicilio=0&turbo=&fotos=2&cobranzas=2&obs=2&cantidadColumnas=1`;

  console.log("Descargando Excel del rango...");
  const response = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const buffer = await res.arrayBuffer();
      return { status: res.status, size: buffer.byteLength, data: Array.from(new Uint8Array(buffer)), ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  }, excelUrl);
  if (!response.ok || response.status !== 200 || response.size < 1000) {
    await browser.close();
    console.error("Error descargando Excel:", response.error || `status=${response.status} size=${response.size}`);
    process.exit(1);
  }
  console.log(`Excel: ${response.size} bytes`);

  const excelPath = path.join(downloadPath, 'envios.xls');
  fs.writeFileSync(excelPath, Buffer.from(response.data));

  // Parsear
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
  let headerRow = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    if (raw[i] && raw[i].some(c => String(c || "").includes("Cadete"))) { headerRow = i; break; }
  }
  if (headerRow === -1) { console.error("No se encontró header"); process.exit(1); }
  const headers = raw[headerRow].map(h => String(h || "").trim());
  const rows = raw.slice(headerRow + 1)
    .filter(r => r && r.some(c => c !== null && c !== undefined && c !== ""))
    .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] ?? ""; }); return o; });
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
    ? await getMaskedReceiptIds({ baseUrl: SUPABASE_URL, key: SUPABASE_KEY })
    : entregadosHoy.map(envio => envio.id_interno);
  console.log(`Consultando receptor de ${receiptIds.length} entregas${process.env.BACKFILL_RECEIPTS === 'true' ? ' historicas confirmadas' : ' de hoy'}...`);
  let receiptRows = [];
  try {
    receiptRows = await page.evaluate(async (ids) => {
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
    }, receiptIds);
  } finally {
    await browser.close();
  }
  console.log(`Receptores confirmados: ${receiptRows.length}`);

  // Primero hace upsert de toda la tanda. Solo después elimina IDs viejos.
  // Si una inserción falla, la caché anterior sigue disponible y completa.
  const refresh = await refreshCacheSafely({
    baseUrl: SUPABASE_URL,
    key: SUPABASE_KEY,
    table: "envios_busqueda",
    rows: envios,
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

  console.log(`✅ Sincronizados ${envios.length} envíos en envios_busqueda (${fechaDesde} → ${fechaHasta}); removidos=${refresh.removed}`);
}

main().catch(e => { console.error(e); process.exit(1); });
