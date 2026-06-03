const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TOKEN_EMPRESA = "ldae_125_6e2c8f1d4a9b3d7c5f0a2e8b1c4d7a96";
const ID_EMPRESA = "125";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function getYesterdayDate() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function getWeekLabel(fecha) {
  const d = new Date(fecha + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const lunes = new Date(d); lunes.setDate(diff);
  const viernes = new Date(lunes); viernes.setDate(lunes.getDate() + 4);
  const fmt = (x) => `${x.getDate().toString().padStart(2,"0")}/${(x.getMonth()+1).toString().padStart(2,"0")}`;
  return `${fmt(lunes)}-${fmt(viernes)}`;
}

async function getClienteTokens() {
  const { data } = await supabase.from('clientes_tokens').select('codigo,token');
  const map = {};
  if (data) {
    data.forEach(r => {
      map[r.codigo] = r.token;
      map[String(r.codigo).replace(/^0+/, '')] = r.token;
      map[String(r.codigo).padStart(4, '0')] = r.token;
    });
  }
  return map;
}

async function esDemorReal(idInterno, codCliente, tokens) {
  try {
    const codStr = String(codCliente).trim();
    const token = tokens[codStr] || tokens[codStr.replace(/^0+/, '')] || tokens[codStr.padStart(4,'0')];
    if (!token) return true;
    const res = await fetch("https://apiexterna.lightdata.com.ar/externa/obtener-datos-envio", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${TOKEN_EMPRESA}` },
      body: JSON.stringify({ idEmpresa: ID_EMPRESA, idEnvio: String(idInterno), token })
    });
    if (!res.ok) return true;
    const data = await res.json();
    if (!data.success || !data.data?.estadosHistorial) return true;
    const tuvoNadieAntes21 = data.data.estadosHistorial.some(h => {
      const estadoH = String(h.estado).toLowerCase();
      if (!estadoH.includes("nadie") && !estadoH.includes("reprogramado")) return false;
      try { return new Date(h.fecha).getHours() < 21; } catch(e) { return true; }
    });
    return !tuvoNadieAntes21;
  } catch(e) { return true; }
}

function calcularDia(rows, fecha, noEsDemora) {
  const map = {};
  const RESUELTOS = ["Entregado","Entregado 2DA visita","Cancelado"];
  for (const row of rows) {
    const cadete = String(row["Cadete"] || "").trim() || "⚠️ Sin asignar";
    const estado = String(row["Estado"] || "").trim().replace(/^nan$/i, "");
    const origen = String(row["Origen"] || "").trim();
    const esML = origen === "ML";
    const esPendiente = !RESUELTOS.includes(estado);
    const idInterno = String(row["ID (Interno)"] || "").trim();
    const esEnCamino = estado === "En camino al destinatario";
    const esEnPlanta = estado === "En planta de procesamiento";
    const esReproML = estado === "reprogramado por meli";
    const esDemorado = esML && (esEnPlanta || ((esEnCamino || esReproML) && !noEsDemora.has(idInterno)));
    const fechaEstado = String(row["Fecha estado"] || "").trim();
    const esEntregado = ["Entregado","Entregado 2DA visita"].includes(estado);
    let esPost21 = false;
    if (esEntregado && fechaEstado) {
      const hora = fechaEstado.split(" ")[1];
      if (hora && parseInt(hora.split(":")[0]) >= 21) esPost21 = true;
    }
    const esRepro21 = esML && estado === "reprogramado por meli" && fechaEstado.split(" ")[1] && parseInt(fechaEstado.split(" ")[1].split(":")[0]) >= 21;
    if (!map[cadete]) map[cadete] = { cadete, cantidad:0, pendientes:0, demorados:0, envios_ml:0, post21:0, dem21:0, envios_particular:0, inicio_ruta:null, fin_ruta:null };
    map[cadete].cantidad++;
    if (esPendiente) map[cadete].pendientes++;
    if (esDemorado)  map[cadete].demorados++;
    if (esML)        map[cadete].envios_ml++;
    if (!esML)       map[cadete].envios_particular++;
    if (esPost21)    map[cadete].post21++;
    if (esRepro21)   map[cadete].dem21++;
    if (esEntregado && fechaEstado) {
      const hora = fechaEstado.split(" ")[1];
      if (hora) {
        if (!map[cadete].inicio_ruta || hora < map[cadete].inicio_ruta) map[cadete].inicio_ruta = hora;
        if (!map[cadete].fin_ruta || hora > map[cadete].fin_ruta) map[cadete].fin_ruta = hora;
      }
    }
  }
  return Object.values(map);
}

async function main() {
  const fecha = getYesterdayDate();
  const weekLabel = getWeekLabel(fecha);
  console.log(`Procesando datos del ${fecha}...`);

  const downloadPath = '/tmp/lightdata';
  fs.mkdirSync(downloadPath, { recursive: true });

  // Login con Puppeteer para obtener sesión
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
  await inputs[0].type('beto');
  await inputs[1].type('123456');
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  console.log("Login OK");

  // Obtener cookies de sesión
  const cookies = await page.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // Construir URL de descarga directa
  const [year, month, day] = fecha.split('-');
  const fechaFmt = `${day}/${month}/${year}`;
  const excelUrl = `https://flexit.lightdata.app/modules/envios/listado/procesar_listado.php?cantxpagina=10000&pagina=1&nombre=&cp=&estado=-1&excel=1&appersand=false&nombrecliente=&fecha_desde=${encodeURIComponent(fechaFmt)}&fecha_hasta=${encodeURIComponent(fechaFmt)}&tipo_fecha=6&cadete=&tracking_number=&origen=&zonasdeentrega=&asignado=2&logisticaInversa=2&idml=&domicilio=0&turbo=&fotos=2&cobranzas=2&cantidadColumnas=1`;

  console.log("Descargando Excel...");
  
  // Descargar via fetch con cookies de sesión
  const response = await page.evaluate(async (url) => {
    const res = await fetch(url);
    const buffer = await res.arrayBuffer();
    return { 
      status: res.status,
      size: buffer.byteLength,
      data: Array.from(new Uint8Array(buffer))
    };
  }, excelUrl);

  await browser.close();

  console.log(`Respuesta: status ${response.status}, size ${response.size} bytes`);
  
  // Si el archivo es muy pequeño, mostrar contenido para debug
  if (response.size < 5000) {
    const text = Buffer.from(response.data).toString('utf8').slice(0, 500);
    console.log("Contenido respuesta:", text);
  }

  if (response.status !== 200 || response.size < 1000) {
    console.error(`Error descargando Excel: status ${response.status}, size ${response.size}`);
    process.exit(1);
  }

  // Guardar Excel
  const excelPath = path.join(downloadPath, 'envios.xls');
  fs.writeFileSync(excelPath, Buffer.from(response.data));
  console.log(`Excel descargado: ${response.size} bytes`);

  // Parsear Excel
  const wb = XLSX.readFile(excelPath);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });

  let headerRow = -1;
  for (let i = 0; i < Math.min(10, raw.length); i++) {
    if (raw[i] && raw[i].some(c => String(c || "").includes("Cadete"))) { headerRow = i; break; }
  }
  if (headerRow === -1) { console.error("No se encontró columna Cadete"); process.exit(1); }

  const headers = raw[headerRow].map(h => String(h || "").trim());
  const rows = raw.slice(headerRow + 1)
    .filter(r => r && r.some(c => c !== null && c !== undefined && c !== ""))
    .map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] ?? ""; }); return o; });

  console.log(`Total filas: ${rows.length}`);

  // Verificar demorados via API
  const tokens = await getClienteTokens();
  const enCaminoML = rows.filter(r => {
    const origen = String(r["Origen"]||"").trim();
    const estado = String(r["Estado"]||"").trim().replace(/^nan$/i, "");
    const idInterno = r["ID (Interno)"];
    const fechaH = String(r["Fecha estado"]||"").trim();
    const horaH = fechaH.split(" ")[1] ? parseInt(fechaH.split(" ")[1].split(":")[0]) : 0;
    const esEnCaminoML = origen === "ML" && estado === "En camino al destinatario";
    const esReproAntes21 = origen === "ML" && estado === "reprogramado por meli" && horaH < 21;
    return (esEnCaminoML || esReproAntes21) && idInterno;
  });

  console.log(`Verificando ${enCaminoML.length} envíos via API...`);
  const noEsDemora = new Set();
  for (const row of enCaminoML) {
    const esReal = await esDemorReal(String(row["ID (Interno)"]).trim(), row["Cod.Cliente"], tokens);
    if (!esReal) noEsDemora.add(String(row["ID (Interno)"]).trim());
  }

  const datos = calcularDia(rows, fecha, noEsDemora);

  // Guardar en Supabase
  await supabase.from('semanas').delete().eq('fecha', fecha).eq('label', weekLabel);
  const { error } = await supabase.from('semanas').insert(datos.map(m => ({
    label: weekLabel, fecha, cadete: m.cadete,
    cantidad: m.cantidad, pendientes: m.pendientes,
    demorados: m.demorados, envios_ml: m.envios_ml,
    post21: m.post21||0, dem21: m.dem21||0,
    envios_particular: m.envios_particular||0,
    inicio_ruta: m.inicio_ruta||null, fin_ruta: m.fin_ruta||null,
  })));
  if (error) { console.error("Error guardando:", error); process.exit(1); }
  console.log(`✅ ${fecha} guardado — ${datos.length} cadetes`);
}

main().catch(e => { console.error(e); process.exit(1); });
