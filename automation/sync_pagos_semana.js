// sync_pagos_semana.js
// -------------------------------------------------------------------------
// Tarea 1 del módulo Pagos: guarda en la tabla `pagos_entregados` todos los
// envíos ENTREGADOS de una semana (lunes–sábado) por FECHA DE ENTREGA.
// Automatiza el "paso 1" del flujo manual de Alejo (exportar la semana cerrada).
//
// AISLADO: escribe SOLO en `pagos_entregados`. No toca `semanas` ni
// `envios_busqueda`. Reutiliza el MISMO login + endpoint de descarga que
// descargar_lightdata.js / sync_envios_agente.js (probado).
//
// Descarga por FECHA DE ENTREGA directo del servidor: en LightData
// `tipo_fecha=2` es "Fecha Entregado" (confirmado 2026-07-21 leyendo el select
// `envios_f_tipo_fecha` de la UI de listado). Es el MISMO filtro que usa Alejo
// a mano, así que el resultado coincide exactamente con su export manual.
// Por eso DIAS_BUFFER=0: no hace falta traer una ventana "a planta" con holgura.
//   Historia: hasta el 2026-07-21 esto descargaba por `tipo_fecha=6` (fecha "a
//   planta") con un buffer de 12 días y filtraba en el script. Se le escapaban
//   los envíos que estuvieron >12 días en depósito antes de entregarse (la
//   semana 13–18/07 quedó ~316 corta: app 9.710 vs LightData 10.026).
// El filtro por "Fecha estado" del script queda como red de seguridad: para un
// envío Entregado, "Fecha estado" ES su fecha/hora de entrega.
//
// Env:
//   SUPABASE_URL, SUPABASE_KEY   (mismos secrets que envios_agente.yml)
//   FECHA_DESDE, FECHA_HASTA     (opcional, DD/MM/YYYY) → semana de ENTREGA a
//                                procesar. Para backfill / re-corridas.
//                                Si no se pasan: semana cerrada anterior
//                                (lunes–sábado de la semana pasada).
//   DIAS_BUFFER  (opcional, default 0) días antes del lunes para ampliar la
//                ventana de descarga. Con tipo_fecha=2 no hace falta (=0).
//   TIPO_FECHA   (opcional, default 2 = "Fecha Entregado").
// -------------------------------------------------------------------------

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const LD_USER = "beto";
const LD_PASS = "123456";
const DIAS_BUFFER = parseInt(process.env.DIAS_BUFFER || "0", 10);
const TIPO_FECHA  = process.env.TIPO_FECHA || "2"; // 2 = "Fecha Entregado" en LightData

const ESTADOS_ENTREGADO = ["Entregado", "Entregado 2DA visita"]; // exactos, del repo

// ---------- helpers de fecha ----------
function fmtDDMMYYYY(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}
function fmtYYYYMMDD(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
function parseDDMMYYYY(s) { // "DD/MM/YYYY" -> Date (00:00 local)
  const [dd, mm, yyyy] = s.split("/").map(Number);
  return new Date(yyyy, mm - 1, dd);
}
// lunes de la semana de `d`
function mondayOf(d) {
  const x = new Date(d);
  const day = x.getDay();               // 0=domingo
  const diff = x.getDate() - day + (day === 0 ? -6 : 1);
  x.setDate(diff);
  x.setHours(0, 0, 0, 0);
  return x;
}
// Parsea "Fecha estado" del Excel. Acepta "DD/MM/YYYY HH:MM(:SS)" o "YYYY-MM-DD ...".
// Devuelve { ymd:'YYYY-MM-DD', iso:'...-03:00' } o null.
function parseFechaEstado(s) {
  const str = String(s || "").trim();
  if (!str) return null;
  const [fecha, hora = "00:00:00"] = str.split(" ");
  let y, m, d;
  if (fecha.includes("/")) {
    const p = fecha.split("/").map(Number);
    if (p.length !== 3) return null;
    [d, m, y] = p;
  } else if (fecha.includes("-")) {
    const p = fecha.split("-").map(Number);
    if (p.length !== 3) return null;
    [y, m, d] = p;
  } else return null;
  if (!y || !m || !d) return null;
  const pad = (n) => String(n).padStart(2, "0");
  const hhmmss = (hora + ":00:00").split(":").slice(0, 3).map(x => pad(parseInt(x || "0", 10))).join(":");
  const ymd = `${y}-${pad(m)}-${pad(d)}`;
  return { ymd, iso: `${ymd}T${hhmmss}-03:00` };
}

// ---------- Supabase (fetch directo, sin supabase-js) ----------
async function supabaseUpsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id_interno`, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert error: ${await res.text()}`);
  return true;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("Faltan SUPABASE_URL/SUPABASE_KEY"); process.exit(1); }

  // --- resolver la semana de ENTREGA a procesar ---
  let entregaDesde, entregaHasta;
  if (process.env.FECHA_DESDE && process.env.FECHA_HASTA) {
    entregaDesde = parseDDMMYYYY(process.env.FECHA_DESDE);
    entregaHasta = parseDDMMYYYY(process.env.FECHA_HASTA);
  } else {
    // semana cerrada anterior: lunes..sábado de la semana pasada
    const lunesEsta = mondayOf(new Date());
    entregaDesde = new Date(lunesEsta); entregaDesde.setDate(lunesEsta.getDate() - 7); // lunes pasado
    entregaHasta = new Date(entregaDesde); entregaHasta.setDate(entregaDesde.getDate() + 5); // sábado pasado
  }
  entregaDesde.setHours(0, 0, 0, 0);
  entregaHasta.setHours(23, 59, 59, 999);
  const semanaLunes = fmtYYYYMMDD(mondayOf(entregaDesde));
  const entregaDesdeYMD = fmtYYYYMMDD(entregaDesde);
  const entregaHastaYMD = fmtYYYYMMDD(entregaHasta);

  // ventana de descarga "a planta" (con buffer hacia atrás)
  const descDesde = new Date(entregaDesde); descDesde.setDate(entregaDesde.getDate() - DIAS_BUFFER);
  const fechaDesde = fmtDDMMYYYY(descDesde);
  const fechaHasta = fmtDDMMYYYY(entregaHasta);

  console.log(`Semana de ENTREGA: ${entregaDesdeYMD} → ${entregaHastaYMD} (semana_lunes=${semanaLunes})`);
  console.log(`Ventana descarga: ${fechaDesde} → ${fechaHasta} (buffer ${DIAS_BUFFER}d, tipo_fecha=${TIPO_FECHA})`);

  const downloadPath = '/tmp/lightdata-pagos';
  fs.mkdirSync(downloadPath, { recursive: true });

  // --- login LightData (idéntico a descargar_lightdata.js) ---
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

  // --- descargar Excel de la ventana ---
  const excelUrl = `https://flexit.lightdata.app/modules/envios/listado/procesar_listado.php?cantxpagina=50000&pagina=1&nombre=&cp=&estado=-1&excel=1&appersand=false&nombrecliente=&fecha_desde=${encodeURIComponent(fechaDesde)}&fecha_hasta=${encodeURIComponent(fechaHasta)}&tipo_fecha=${TIPO_FECHA}&cadete=&tracking_number=&origen=&zonasdeentrega=&asignado=2&logisticaInversa=2&idml=&domicilio=0&turbo=&fotos=2&cobranzas=2&cantidadColumnas=1`;

  console.log("Descargando Excel...");
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

  // --- parsear ---
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
  let headerRow = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    if (raw[i] && raw[i].some(c => String(c || "").includes("Cadete"))) { headerRow = i; break; }
  }
  if (headerRow === -1) { console.error("No se encontró header (Cadete)"); process.exit(1); }
  const headers = raw[headerRow].map(h => String(h || "").trim());
  const rows = raw.slice(headerRow + 1)
    .filter(r => r && r.some(c => c !== null && c !== undefined && c !== ""))
    .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] ?? ""; }); return o; });
  console.log(`Filas en la ventana: ${rows.length}`);

  const S = (v) => String(v ?? "").trim();

  // histograma de estados (para el "vistazo" que pide la spec)
  const hist = {};
  for (const r of rows) { const e = S(r["Estado"]).replace(/^nan$/i, "") || "(vacío)"; hist[e] = (hist[e] || 0) + 1; }
  console.log("Estados en la ventana:", JSON.stringify(hist));

  // --- filtrar ENTREGADOS por FECHA DE ENTREGA dentro de la semana ---
  let fueraDeRango = 0, sinFecha = 0, sinId = 0;
  const entregados = [];
  for (const r of rows) {
    const estado = S(r["Estado"]).replace(/^nan$/i, "");
    if (!ESTADOS_ENTREGADO.includes(estado)) continue;
    const id = S(r["ID (Interno)"]);
    if (!id) { sinId++; continue; }
    const fe = parseFechaEstado(r["Fecha estado"]);
    if (!fe) { sinFecha++; continue; }
    if (fe.ymd < entregaDesdeYMD || fe.ymd > entregaHastaYMD) { fueraDeRango++; continue; }
    entregados.push({
      id_interno: id,
      cadete: S(r["Cadete"]),
      localidad: S(r["Localidad"]),
      cp: S(r["CP"]),
      direccion: S(r["Domicilio"] || r["Dirección"] || r["Domicilio destino"] || r["Dom. Destino"] || r["Destino"]),
      cliente: S(r["Razon Social"] || r["Nombre Fantasia"] || r["Cod.Cliente"]),
      estado,
      fecha_estado: fe.iso,
      semana_lunes: semanaLunes,
    });
  }
  console.log(`Entregados en la semana: ${entregados.length} (fuera de rango ${fueraDeRango}, sin fecha ${sinFecha}, sin id ${sinId})`);

  if (entregados.length === 0) { console.log("Nada para guardar."); return; }

  // --- upsert a Supabase (idempotente por id_interno) ---
  const BATCH = 500;
  for (let i = 0; i < entregados.length; i += BATCH) {
    await supabaseUpsert("pagos_entregados", entregados.slice(i, i + BATCH));
    console.log(`  upsert ${Math.min(i + BATCH, entregados.length)}/${entregados.length}`);
  }
  console.log(`✅ ${entregados.length} entregados guardados en pagos_entregados (semana ${semanaLunes})`);
}

main().catch(e => { console.error(e); process.exit(1); });
