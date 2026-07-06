const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const TOKEN_EMPRESA = "ldae_125_6e2c8f1d4a9b3d7c5f0a2e8b1c4d7a96";
const ID_EMPRESA = "125";
const LD_USER = "beto";
const LD_PASS = "123456";

// Supabase via fetch directo (sin WebSocket)
async function supabaseGet(table, params = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`
    }
  });
  return res.json();
}

async function supabaseDelete(table, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    method: "DELETE",
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`
    }
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
      "Prefer": "return=representation"
    },
    body: JSON.stringify(rows)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase insert error: ${text}`);
  }
  return res.json();
}

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
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6); 
  const fmt = (x) => `${x.getDate().toString().padStart(2,"0")}/${(x.getMonth()+1).toString().padStart(2,"0")}`;
  return `${fmt(lunes)}-${fmt(domingo)}`;
}

async function getClienteTokens() {
  const data = await supabaseGet("clientes_tokens", "select=codigo,token&limit=1000");
  const map = {};
  if (Array.isArray(data)) {
    data.forEach(r => {
      map[r.codigo] = r.token;
      map[String(r.codigo).replace(/^0+/, '')] = r.token;
      map[String(r.codigo).padStart(4, '0')] = r.token;
    });
  }
  console.log(`Tokens cargados: ${Object.keys(map).length / 3}`);
  return map;
}

async function getLDHistorial(idInterno, ldCookies) {
  try {
    const res = await fetch("https://flexit.lightdata.app/modules/envios/alta/controlador.php", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": ldCookies
      },
      body: `operador=get&did=${idInterno}`
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.historial || [];
  } catch(e) { return []; }
}

async function esDemorReal(idInterno, codCliente, tokens, ldCookies) {
  try {
    // Primero intentar con historial interno de LightData
    const historial = await getLDHistorial(idInterno, ldCookies);
    
    if (historial.length > 0) {
      // Codigos: 6=Nadie, 11=Repro meli, 12=Repro comprador
      const ESTADOS_NO_DEMORA = new Set(["6", "11", "12"]);
      const tuvoNoDemoraAntes21 = historial.some(h => {
        if (!ESTADOS_NO_DEMORA.has(String(h.estado))) return false;
        try {
          const partes = String(h.fecha).split(" ");
          if (partes.length < 2) return false;
          const hora = parseInt(partes[1].split(":")[0]);
          return hora < 21;
        } catch(e) { return false; }
      });
      return !tuvoNoDemoraAntes21;
    }

    // Fallback: API externa
    const codStr = String(codCliente).trim();
    const token = tokens[codStr] || tokens[codStr.replace(/^0+/, '')] || tokens[codStr.padStart(4,'0')];
    if (!token) return true;

    const res = await fetch("https://apiexterna.lightdata.com.ar/externa/obtener-datos-envio", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN_EMPRESA}`
      },
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
    const esRepro21 = esML && (estado === "reprogramado por meli" || estado === "Nadie" || estado === "Nadie 2DA visita") && fechaEstado.split(" ")[1] && parseInt(fechaEstado.split(" ")[1].split(":")[0]) >= 21;
    if (!map[cadete]) map[cadete] = { cadete, cantidad:0, pendientes:0, demorados:0, envios_ml:0, post21:0, dem21:0, envios_particular:0, inicio_ruta:null, fin_ruta:null, demoradosDetalle:[] };
    map[cadete].cantidad++;
    if (esPendiente) map[cadete].pendientes++;
    if (esDemorado) {
      map[cadete].demorados++;
      const dir = String(row["Domicilio"] || row["Dirección"] || row["Domicilio destino"] || row["Dom. Destino"] || row["Destino"] || "").trim();
      map[cadete].demoradosDetalle.push({ id: idInterno, dir, estado });
    }
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
  // Flexit no opera domingos: si "ayer" fue domingo (corrida de lunes), no cargar nada.
  if (new Date(fecha + "T12:00:00").getDay() === 0) {
    console.log(`Domingo ${fecha}: no se opera, no se carga nada.`);
    return;
  }
  const weekLabel = getWeekLabel(fecha);
  console.log(`Procesando datos del ${fecha} (${weekLabel})...`);

  // Anti-overwrite: si ya existen datos para esta fecha y es hora laboral AR (>=9hs),
  // probablemente hubo una carga manual previa — no pisar.
  // Esto también evita gastar minutos de Actions en Puppeteer innecesariamente.
  const existentes = await supabaseGet("semanas", `fecha=eq.${fecha}&select=id&limit=1`).catch(() => []);
  const horaAR = (new Date().getUTCHours() - 3 + 24) % 24;
  console.log(`Hora Argentina: ${horaAR}hs | Registros existentes para ${fecha}: ${existentes.length}`);
  if (existentes.length > 0 && horaAR >= 9) {
    console.log(`⚠️ Saltando: ya existen datos y son las ${horaAR}hs AR — posible carga manual previa`);
    return;
  }

  const downloadPath = '/tmp/lightdata';
  fs.mkdirSync(downloadPath, { recursive: true });

  // Login en LightData con Puppeteer
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

  // Obtener cookies para requests server-side
  const cookies = await page.cookies();
  const ldCookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  // Descargar Excel via URL directa
  const [year, month, day] = fecha.split('-');
  const fechaFmt = `${day}/${month}/${year}`;
  const excelUrl = `https://flexit.lightdata.app/modules/envios/listado/procesar_listado.php?cantxpagina=10000&pagina=1&nombre=&cp=&estado=-1&excel=1&appersand=false&nombrecliente=&fecha_desde=${encodeURIComponent(fechaFmt)}&fecha_hasta=${encodeURIComponent(fechaFmt)}&tipo_fecha=6&cadete=&tracking_number=&origen=&zonasdeentrega=&asignado=2&logisticaInversa=2&idml=&domicilio=0&turbo=&fotos=2&cobranzas=2&cantidadColumnas=1`;

  console.log("Descargando Excel via fetch...");
  const response = await page.evaluate(async (url) => {
    try {
      const res = await fetch(url, { credentials: 'include' });
      const buffer = await res.arrayBuffer();
      return { status: res.status, size: buffer.byteLength, data: Array.from(new Uint8Array(buffer)), ok: true };
    } catch(e) {
      return { ok: false, error: String(e) };
    }
  }, excelUrl);

  await browser.close();

  if (!response.ok) {
    console.error("Error fetch:", response.error); process.exit(1);
  }

  console.log(`Excel: status=${response.status}, size=${response.size} bytes`);
  if (response.size < 5000) {
    const text = Buffer.from(response.data).toString('utf8').slice(0, 300);
    console.log("Contenido:", text);
  }
  if (response.status !== 200 || response.size < 1000) {
    console.error("Excel muy pequeño o error"); process.exit(1);
  }

  const excelPath = path.join(downloadPath, 'envios.xls');
  fs.writeFileSync(excelPath, Buffer.from(response.data));

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

  // Cargar tokens y verificar demorados
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

  console.log(`Verificando ${enCaminoML.length} envíos...`);
  const noEsDemora = new Set();
  for (const row of enCaminoML) {
    const idInterno = String(row["ID (Interno)"]).trim();
    const esReal = await esDemorReal(idInterno, row["Cod.Cliente"], tokens, ldCookies);
    if (!esReal) noEsDemora.add(idInterno);
  }
  console.log(`No son demora real: ${noEsDemora.size}`);

  const datos = calcularDia(rows, fecha, noEsDemora);

  // Guardar en Supabase via fetch
  // Limpiar label viejo si cambió (antes domingo usaba +5 en vez de +6)
  const d2 = new Date(fecha + "T00:00:00"); const day2 = d2.getDay(); const diff2 = d2.getDate() - day2 + (day2 === 0 ? -6 : 1); const lunes2 = new Date(d2); lunes2.setDate(diff2); const domingo2 = new Date(lunes2); domingo2.setDate(lunes2.getDate() + 5);
  const fmt2 = (x) => x.getDate().toString().padStart(2,"0") + "/" + (x.getMonth()+1).toString().padStart(2,"0");
  const oldWeekLabel = fmt2(lunes2) + "-" + fmt2(domingo2);
  if (oldWeekLabel !== weekLabel) await supabaseDelete("semanas", "label=eq." + encodeURIComponent(oldWeekLabel));
  await supabaseDelete("semanas", `fecha=eq.${fecha}&label=eq.${encodeURIComponent(weekLabel)}`);
  const insertRows = datos.map(m => ({
    label: weekLabel, fecha, cadete: m.cadete,
    cantidad: m.cantidad, pendientes: m.pendientes,
    demorados: m.demorados, envios_ml: m.envios_ml,
    post21: m.post21||0, dem21: m.dem21||0,
    envios_particular: m.envios_particular||0,
    inicio_ruta: m.inicio_ruta||null, fin_ruta: m.fin_ruta||null,
    demorados_detalle: m.demoradosDetalle || [],
  }));
  try {
    await supabaseInsert("semanas", insertRows);
  } catch(e) {
    // Fallback sin demorados_detalle si la columna aún no existe
    const fallback = insertRows.map(({ demorados_detalle, ...r }) => r);
    await supabaseInsert("semanas", fallback);
  }

  console.log(`✅ ${fecha} guardado — ${datos.length} cadetes`);
}

main().catch(e => { console.error(e); process.exit(1); });
