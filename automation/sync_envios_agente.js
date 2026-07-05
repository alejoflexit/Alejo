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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const LD_USER = "beto";
const LD_PASS = "123456";
const DIAS_ATRAS = 6; // cuántos días hacia atrás traer (hoy incluido)

async function supabaseDeleteAll(table) {
  // borra todo (id no nulo) — la tabla es un caché rodante del agente
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id_interno=neq.__none__`, {
    method: "DELETE",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
  });
  return res.ok;
}

async function supabaseInsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`Supabase insert error: ${await res.text()}`);
  return true;
}

function fmtFecha(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

async function main() {
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

  // Descargar Excel del RANGO (mismo endpoint, con fecha_desde != fecha_hasta)
  const excelUrl = `https://flexit.lightdata.app/modules/envios/listado/procesar_listado.php?cantxpagina=50000&pagina=1&nombre=&cp=&estado=-1&excel=1&appersand=false&nombrecliente=&fecha_desde=${encodeURIComponent(fechaDesde)}&fecha_hasta=${encodeURIComponent(fechaHasta)}&tipo_fecha=6&cadete=&tracking_number=&origen=&zonasdeentrega=&asignado=2&logisticaInversa=2&idml=&domicilio=0&turbo=&fotos=2&cobranzas=2&cantidadColumnas=1`;

  console.log("Descargando Excel del rango...");
  const response = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const buffer = await res.arrayBuffer();
      return { status: res.status, size: buffer.byteLength, data: Array.from(new Uint8Array(buffer)), ok: true };
    } catch (e) { return { ok: false, error: String(e) }; }
  }, excelUrl);
  await browser.close();

  if (!response.ok || response.status !== 200 || response.size < 1000) {
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
      tracking: S(r["Número Tracking"]),
      url_tracking: S(r["URl Tracking"]),
      fecha_flexit: S(r["Fecha Flexit"]),
    }))
    .filter(e => e.id_interno); // descartar filas sin ID

  console.log(`Envíos a guardar: ${envios.length}`);

  // Reemplazo completo (caché rodante de últimos días)
  await supabaseDeleteAll("envios_busqueda");
  const BATCH = 500;
  for (let i = 0; i < envios.length; i += BATCH) {
    await supabaseInsert("envios_busqueda", envios.slice(i, i + BATCH));
    console.log(`  insertados ${Math.min(i + BATCH, envios.length)}/${envios.length}`);
  }

  console.log(`✅ Sincronizados ${envios.length} envíos en envios_busqueda (${fechaDesde} → ${fechaHasta})`);
}

main().catch(e => { console.error(e); process.exit(1); });
