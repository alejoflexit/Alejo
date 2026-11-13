// sync_extraviados.js — trae el VALOR DECLARADO de LightData para los extraviados/rotos cargados en la app.
//
// 1) Toma de `extraviados` las filas sin valor_declarado (y con menos de 6 intentos).
// 2) Si no tienen id_interno, lo busca en envios_busqueda por IDML / tracking / id. Si el código es un
//    número corto (≤ 9 dígitos) se prueba directo como ID de LightData.
// 3) Abre la ficha (modules/envios/alta/controlador.php operador=get) y guarda header.valor_declarado.
//
// Escribe SOLO en extraviados. Si no hay nada pendiente, no abre el navegador.

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const LD_USER = process.env.LIGHTDATA_USER;
const LD_PASS = process.env.LIGHTDATA_PASSWORD;
const MAX_INTENTOS = 6;

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

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_KEY');
  const filas = await sb(`extraviados?valor_declarado=is.null&valor_intentos=lt.${MAX_INTENTOS}&select=id,codigo,id_interno&order=id&limit=200`);
  if (!filas.length) { console.log('Sin extraviados pendientes de valor'); return; }
  console.log(`Extraviados sin valor: ${filas.length}`);

  // 2) resolver id_interno con envios_busqueda
  for (const f of filas) {
    if (f.id_interno) continue;
    const c = String(f.codigo || '').trim().replace(/^#/, '');
    if (!/^[\w-]{3,80}$/.test(c)) continue;
    const e = await sb(`envios_busqueda?or=(id_venta_ml.eq.${c},tracking.eq.${c},id_interno.eq.${c})&select=id_interno,tracking,id_venta_ml&limit=1`).catch(() => []);
    if (e[0] && e[0].id_interno) {
      f.id_interno = String(e[0].id_interno);
      await patch(f.id, { id_interno: f.id_interno, tracking: e[0].tracking || null, id_venta_ml: e[0].id_venta_ml || null });
    } else if (/^\d{1,9}$/.test(c)) {
      f.id_interno = c; f.adivinado = true; // probable ID de LightData (se confirma si la ficha responde)
    }
  }

  const conId = filas.filter((f) => f.id_interno);
  for (const f of filas.filter((x) => !x.id_interno)) {
    await patch(f.id, { valor_intentos: MAX_INTENTOS, valor_consultado_at: new Date().toISOString(), valor_error: 'No encontré el envío en LightData: cargá el valor a mano' });
  }
  if (!conId.length) return;

  // 3) fichas de LightData
  if (!LD_USER || !LD_PASS) throw new Error('Faltan LIGHTDATA_USER / LIGHTDATA_PASSWORD');
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

    const ids = [...new Set(conId.map((f) => f.id_interno))];
    const fichas = await page.evaluate(async (ids) => {
      const res = {};
      for (const id of ids) {
        try {
          const r = await fetch('/modules/envios/alta/controlador.php', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: `operador=get&did=${encodeURIComponent(id)}`, signal: AbortSignal.timeout(25000) });
          if (!r.ok) { res[id] = { error: `HTTP ${r.status}` }; continue; }
          const p = await r.json();
          const h = (p && p.header) || null;
          res[id] = h ? { valor: h.valor_declarado, ml_shipment: h.ml_shipment_id || h.shipment_id || null } : { error: 'ficha vacía' };
        } catch (e) { res[id] = { error: String(e && e.message || e).slice(0, 80) }; }
      }
      return res;
    }, ids);

    for (const f of conId) {
      const fi = fichas[f.id_interno] || { error: 'sin respuesta' };
      const valor = parseValor(fi.valor);
      const ahora = new Date().toISOString();
      if (valor) {
        await patch(f.id, { valor_declarado: valor, valor_consultado_at: ahora, valor_error: null, ...(f.adivinado ? { id_interno: f.id_interno } : {}) });
        console.log(`  #${f.id} (${f.id_interno}) → ${valor}`);
      } else {
        const { valor_intentos = 0 } = (await sb(`extraviados?id=eq.${f.id}&select=valor_intentos`))[0] || {};
        await patch(f.id, { valor_intentos: valor_intentos + 1, valor_consultado_at: ahora,
          valor_error: fi.error ? `LightData: ${fi.error}` : 'La ficha no tiene valor declarado: cargalo a mano' });
        console.log(`  #${f.id} (${f.id_interno}) sin valor: ${fi.error || 'vacío'}`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
