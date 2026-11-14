// sync_extraviados.js — completa los extraviados/rotos cargados en la app con datos de LightData.
//
// 1) Toma de `extraviados` las filas sin valor_declarado (con menos de MAX_INTENTOS).
// 2) Si no tienen id_interno, lo busca en envios_busqueda (IDML / tracking / id).
// 3) Si ahí tampoco está (envíos viejos o que la sincronización no trae), lo busca DIRECTO en
//    LightData con el filtro del listado por IDML y, si no, por tracking (últimos 180 días).
//    De ahí completa cliente, transportista e IDs (solo lo que esté vacío).
// 4) Abre la ficha (controlador.php operador=get) y guarda header.valor_declarado.
//
// Escribe SOLO en extraviados. Si no hay nada pendiente, no abre el navegador.

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const XLSX = require('xlsx');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const LD_USER = process.env.LIGHTDATA_USER;
const LD_PASS = process.env.LIGHTDATA_PASSWORD;
const MAX_INTENTOS = 6;
const DIAS_BUSQUEDA = Number(process.env.EXTRAVIADOS_DIAS || 180);

const sbHeaders = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: sbHeaders(opts.headers) });
  if (!r.ok) throw new Error(`Supabase ${path.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return opts.method === 'PATCH' ? null : r.json();
}
const patch = (id, body) => sb(`extraviados?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...body, actualizado_at: new Date().toISOString() }) });

// "92199.00" | "92.199,00" → 92199
function parseValor(v) {
  if (v === null || v === undefined || v === '') return null;
  let t = String(v).replace(/[^\d.,-]/g, '');
  if (!t) return null;
  const coma = t.lastIndexOf(','), punto = t.lastIndexOf('.');
  if (coma > -1 && punto > -1) t = coma > punto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (coma > -1) t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Mismo criterio que src/extraviadosShared.js cadeteDePago (alias merge → tarifa; sin la zona entre paréntesis)
const norm = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
function cadeteDePago(cadeteLD, tarifas, alias) {
  const k = norm(cadeteLD);
  if (!k) return '';
  const al = alias.find((a) => norm(a.nombre_lightdata) === k);
  const canon = al && al.regla === 'merge' && al.paga_como ? al.paga_como : cadeteLD;
  const t = tarifas.find((x) => norm(x.nombre_lightdata) === norm(canon));
  if (t) return t.nombre_lightdata;
  const base = (n) => norm(String(n || '').replace(/\([^)]*\)/g, ''));
  const c = tarifas.filter((x) => base(x.nombre_lightdata) === base(canon));
  return c.length === 1 ? c[0].nombre_lightdata : '';
}

const fmtFecha = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const limpio = (c) => String(c || '').trim().replace(/^#/, '').replace(/\s+/g, '');

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_KEY');
  // También reintenta las que la versión anterior marcó "No encontré el envío" (antes no buscaba en LightData)
  const filas = await sb(`extraviados?valor_declarado=is.null&or=(valor_intentos.lt.${MAX_INTENTOS},valor_error.like.No%20encontr*)`
    + '&select=id,codigo,id_interno,cliente,cadete,valor_manual,valor_intentos&order=id&limit=200');
  if (!filas.length) { console.log('Sin extraviados pendientes'); return; }
  console.log(`Extraviados sin valor: ${filas.length}`);

  // 2) envios_busqueda
  const enLD = []; // códigos para buscar directo en LightData
  for (const f of filas) {
    if (f.id_interno) continue;
    const c = limpio(f.codigo);
    if (!/^[\w-]{3,80}$/.test(c)) continue;
    const e = await sb(`envios_busqueda?or=(id_venta_ml.eq.${c},tracking.eq.${c},id_interno.eq.${c})&select=id_interno,tracking,id_venta_ml&limit=1`).catch(() => []);
    if (e[0] && e[0].id_interno) {
      f.id_interno = String(e[0].id_interno);
      await patch(f.id, { id_interno: f.id_interno, tracking: e[0].tracking || null, id_venta_ml: e[0].id_venta_ml || null });
    } else {
      enLD.push(f);
    }
  }
  for (const f of filas.filter((x) => !x.id_interno && !enLD.includes(x))) {
    await patch(f.id, { valor_intentos: MAX_INTENTOS, valor_consultado_at: new Date().toISOString(), valor_error: 'Sin código para buscar: cargá el valor a mano' });
  }
  if (!filas.some((f) => f.id_interno) && !enLD.length) return;

  if (!LD_USER || !LD_PASS) throw new Error('Faltan LIGHTDATA_USER / LIGHTDATA_PASSWORD');
  const [tarifas, alias] = await Promise.all([
    sb('cadetes_tarifas?select=nombre_lightdata,activo').then((t) => t.filter((x) => x.activo !== false && x.nombre_lightdata)).catch(() => []),
    sb('pagos_cadete_alias?select=nombre_lightdata,regla,paga_como').catch(() => []),
  ]);

  const browser = await puppeteer.launch({
    args: chromium.args, defaultViewport: chromium.defaultViewport,
    executablePath: process.env.CHROMIUM_PATH || await chromium.executablePath(), headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);
    await page.goto('https://flexit.lightdata.app', { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('input', { timeout: 15000 });
    const inputs = await page.$$('input');
    await inputs[0].type(LD_USER);
    await inputs[1].type(LD_PASS);
    await page.keyboard.press('Enter');
    await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
    console.log('Login LightData OK');

    // 3) búsqueda directa en el listado de LightData (mismo endpoint que sync_envios_agente.js)
    const hoy = new Date();
    const desde = new Date(hoy); desde.setDate(hoy.getDate() - DIAS_BUSQUEDA);
    const urlListado = ({ idml = '', tracking = '' }) =>
      'https://flexit.lightdata.app/modules/envios/listado/procesar_listado.php'
      + '?cantxpagina=50&pagina=1&nombre=&cp=&estado=-1&excel=1&appersand=false&nombrecliente='
      + `&fecha_desde=${encodeURIComponent(fmtFecha(desde))}&fecha_hasta=${encodeURIComponent(fmtFecha(hoy))}`
      + `&tipo_fecha=6&cadete=&tracking_number=${encodeURIComponent(tracking)}&origen=&zonasdeentrega=&asignado=2`
      + `&logisticaInversa=2&idml=${encodeURIComponent(idml)}&domicilio=0&turbo=&fotos=2&cobranzas=2&obs=2&cantidadColumnas=1`;
    const buscarListado = async (params) => {
      const r = await page.evaluate(async (url) => {
        try {
          const res = await fetch(url, { credentials: 'include' });
          const b = await res.arrayBuffer();
          return { ok: res.ok, size: b.byteLength, data: Array.from(new Uint8Array(b)) };
        } catch (e) { return { ok: false, error: String(e) }; }
      }, urlListado(params));
      if (!r.ok || r.size < 200) return [];
      try {
        const wb = XLSX.read(Buffer.from(r.data), { type: 'buffer' });
        const crudo = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
        const h = crudo.findIndex((f) => f && f.some((c) => String(c || '').includes('Cadete')));
        if (h < 0) return [];
        const headers = crudo[h].map((x) => String(x || '').trim());
        return crudo.slice(h + 1).filter((f) => f && f.length).map((f) => Object.fromEntries(headers.map((k, i) => [k, f[i] ?? ''])));
      } catch { return []; }
    };
    const S = (v) => String(v ?? '').trim();
    for (const f of enLD) {
      const c = limpio(f.codigo);
      let fila = null;
      for (const params of [{ idml: c }, { tracking: c }]) {
        const filasLD = await buscarListado(params);
        // el filtro de LightData puede ser "contiene": se exige coincidencia exacta en alguna columna de ID
        fila = filasLD.find((r) => [r['ID venta ML'], r['Número Tracking'], r['ID (Interno)']].some((v) => S(v) === c)) || (filasLD.length === 1 ? filasLD[0] : null);
        if (fila) break;
      }
      if (!fila || !S(fila['ID (Interno)'])) {
        await patch(f.id, { valor_intentos: (f.valor_intentos || 0) + 1, valor_consultado_at: new Date().toISOString(),
          valor_error: `LightData no encontró ${c} (últimos ${DIAS_BUSQUEDA} días): cargá el valor a mano` });
        console.log(`  #${f.id} ${c}: no está en LightData`);
        continue;
      }
      f.id_interno = S(fila['ID (Interno)']);
      const cadeteLD = S(fila['Cadete']);
      const datos = { id_interno: f.id_interno, id_venta_ml: S(fila['ID venta ML']) || null, tracking: S(fila['Número Tracking']) || null, cadete_ld: cadeteLD || null };
      if (!f.cliente) datos.cliente = S(fila['Razon Social'] || fila['Nombre Fantasia']) || null;
      if (!f.cadete) { const cp = cadeteDePago(cadeteLD, tarifas, alias); if (cp) datos.cadete = cp; }
      await patch(f.id, datos);
      console.log(`  #${f.id} ${c} → ID ${f.id_interno} · ${cadeteLD}`);
    }

    // 4) fichas → valor declarado
    const conId = filas.filter((f) => f.id_interno);
    if (!conId.length) return;
    const ids = [...new Set(conId.map((f) => f.id_interno))];
    const fichas = await page.evaluate(async (ids) => {
      const res = {};
      for (const id of ids) {
        try {
          const r = await fetch('/modules/envios/alta/controlador.php', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: `operador=get&did=${encodeURIComponent(id)}`, signal: AbortSignal.timeout(25000) });
          if (!r.ok) { res[id] = { error: `HTTP ${r.status}` }; continue; }
          const p = await r.json();
          const h = (p && p.header) || null;
          res[id] = h ? { valor: h.valor_declarado } : { error: 'ficha vacía' };
        } catch (e) { res[id] = { error: String(e && e.message || e).slice(0, 80) }; }
      }
      return res;
    }, ids);

    for (const f of conId) {
      const fi = fichas[f.id_interno] || { error: 'sin respuesta' };
      const valor = parseValor(fi.valor);
      const ahora = new Date().toISOString();
      if (valor) {
        await patch(f.id, { valor_declarado: valor, valor_consultado_at: ahora, valor_error: null });
        console.log(`  #${f.id} (${f.id_interno}) → ${valor}`);
      } else {
        await patch(f.id, { valor_intentos: (f.valor_intentos || 0) + 1, valor_consultado_at: ahora,
          valor_error: fi.error ? `LightData: ${fi.error}` : 'La ficha no tiene valor declarado: cargalo a mano' });
        console.log(`  #${f.id} (${f.id_interno}) sin valor: ${fi.error || 'vacío'}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
