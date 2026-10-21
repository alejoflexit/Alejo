// sync_devoluciones.js — seguimiento de devoluciones (cancelados y cambios).
//
// Dos trabajos, en la misma sesión de LightData:
//  1) PROCESAR: remitos firmados que el equipo subió en la app (remitos_devolucion.estado='procesando').
//     Hace en LightData lo mismo que el botón "Procesar" de Devoluciones: marca devuelto (operador 1)
//     y pasa cada envío a estado 14 "Devuelto al cliente" (operador 3). Después verifica en la ficha.
//  2) SYNC: baja el listado de Devoluciones desde DEV_DESDE, marca los que tienen chofer
//     "devuelto deposito" y completa fechas con la ficha (cancelado, retiro, ingreso a depósito).
//
// Escribe SOLO en devoluciones, remitos_devolucion y devoluciones_sync. No toca otras tablas.

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { tipoDe, datosFicha, fechaLD, CHOFER_DEPOSITO, ESTADO } = require('./devolucionesShared');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const LD_USER = process.env.LIGHTDATA_USER;
const LD_PASS = process.env.LIGHTDATA_PASSWORD;
const DESDE = process.env.DEV_DESDE || '01/09/2026';
const ACCION = process.env.ACCION || 'todo'; // todo | procesar | sync

const sbHeaders = (extra = {}) => ({ apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra });
async function sb(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: sbHeaders(opts.headers) });
  if (!r.ok) throw new Error(`Supabase ${path.split('?')[0]} → ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 || opts.method === 'PATCH' || (opts.headers && /return=minimal/.test(opts.headers.Prefer || '')) ? null : r.json();
}
async function sbTodo(path) {
  const out = [];
  for (let o = 0; ; o += 1000) {
    const rows = await sb(`${path}${path.includes('?') ? '&' : '?'}limit=1000&offset=${o}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const hoyLD = () => new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

async function login() {
  const browser = await puppeteer.launch({
    args: chromium.args, defaultViewport: chromium.defaultViewport,
    executablePath: process.env.CHROMIUM_PATH || await chromium.executablePath(), headless: chromium.headless,
  });
  const page = await browser.newPage();
  await page.goto('https://flexit.lightdata.app', { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('input', { timeout: 15000 });
  const inputs = await page.$$('input');
  await inputs[0].type(LD_USER);
  await inputs[1].type(LD_PASS);
  await page.keyboard.press('Enter');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
  console.log('Login LightData OK');
  return { browser, page };
}

// POST form-urlencoded dentro de la sesión. `campos` = [[k,v],...] para permitir dids[] repetidos.
const postLD = (page, url, campos) => page.evaluate(async (url, campos) => {
  const body = new URLSearchParams();
  for (const [k, v] of campos) body.append(k, String(v));
  const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: body.toString() });
  const t = await r.text();
  return { status: r.status, texto: t };
}, url, campos);

async function fichas(page, dids) {
  const out = {};
  for (let i = 0; i < dids.length; i += 300) {
    const parte = dids.slice(i, i + 300);
    const res = await page.evaluate(async (ids) => {
      const res = {}; let next = 0;
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++];
          try {
            const r = await fetch('/modules/envios/alta/controlador.php', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: `operador=get&did=${id}` });
            if (!r.ok) continue;
            const p = await r.json();
            res[id] = { historial: p.historial || [], asignaciones: p.asignaciones || [], header: { valor_declarado: p.header && p.header.valor_declarado, estado_envio: p.header && p.header.estado_envio, destination_shipping_address_line: p.header && p.header.destination_shipping_address_line, destination_city_name: p.header && p.header.destination_city_name } };
          } catch { /* una ficha suelta no corta la corrida */ }
        }
      };
      await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
      return res;
    }, parte);
    Object.assign(out, res);
    console.log(`  fichas ${Math.min(i + 300, dids.length)}/${dids.length}`);
  }
  return out;
}

// ---------- 1) PROCESAR REMITOS FIRMADOS ----------
async function procesarRemitos(page) {
  const remitos = await sb('remitos_devolucion?estado=eq.procesando&select=id,codigo,dids&order=id');
  if (!remitos.length) { console.log('Sin remitos para procesar'); return 0; }
  // "quien" = id del usuario logueado; LightData lo imprime en el script de la página.
  const quien = await page.evaluate(() => {
    for (const s of document.scripts) { const m = /"quien":\s*(\d+)/.exec(s.textContent || ''); if (m) return m[1]; }
    return null;
  });
  if (!quien) throw new Error('No encontré el usuario de LightData (quien) en la página');

  for (const rem of remitos) {
    const dids = (rem.dids || []).map(Number).filter(Boolean);
    const resultado = { ya_estaban: [], ok: [], fallo: [] };
    try {
      const antes = await fichas(page, dids);
      const pendientes = dids.filter((d) => Number(antes[d]?.header?.estado_envio) !== ESTADO.DEVUELTO_CLIENTE);
      resultado.ya_estaban = dids.filter((d) => !pendientes.includes(d));
      if (pendientes.length) {
        const obs = `Remito ${rem.codigo} firmado (app Flexit)`;
        const r1 = await postLD(page, 'modules/envios/devoluciones/procesar_listado.php',
          [['operador', 1], ...pendientes.map((d) => ['dids[]', d]), ['observacion', obs], ['quien', quien]]);
        if (r1.status !== 200) throw new Error(`marcar devuelto → HTTP ${r1.status}`);
        for (const d of pendientes) {
          await postLD(page, 'modules/envios/devoluciones/procesar_listado.php', [['operador', 3], ['did', d], ['quien', quien]]);
        }
        const despues = await fichas(page, pendientes);
        for (const d of pendientes) (Number(despues[d]?.header?.estado_envio) === ESTADO.DEVUELTO_CLIENTE ? resultado.ok : resultado.fallo).push(d);
      }
      const bien = resultado.fallo.length === 0;
      await sb(`remitos_devolucion?id=eq.${rem.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        estado: bien ? 'devuelto' : 'error', procesado_at: new Date().toISOString(), resultado,
        error: bien ? null : `${resultado.fallo.length} envío(s) no quedaron en "Devuelto al cliente": ${resultado.fallo.join(', ')}`,
      }) });
      // Reflejo inmediato en la tabla de seguimiento (el sync lo confirma después)
      const okIds = [...resultado.ok, ...resultado.ya_estaban];
      if (okIds.length) await sb(`devoluciones?did=in.(${okIds.join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado_ld: ESTADO.DEVUELTO_CLIENTE, devuelto_ld: true, fecha_devuelto_cliente: new Date().toISOString(), actualizado_at: new Date().toISOString() }) });
      console.log(`Remito ${rem.codigo}: ok ${resultado.ok.length}, ya estaban ${resultado.ya_estaban.length}, fallo ${resultado.fallo.length}`);
    } catch (e) {
      console.error(`Remito ${rem.codigo}: ${e.message}`);
      await sb(`remitos_devolucion?id=eq.${rem.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ estado: 'error', error: String(e.message).slice(0, 300), resultado }) });
    }
  }
  return remitos.length;
}

// ---------- 2) SYNC ----------
async function listado(page, extra = {}) {
  const campos = Object.entries({ operador: 0, fecha_desde: DESDE, fecha_hasta: hoyLD(), mlid: '', cliente: '', estado: '', zona: '', devuelto: '', chofer: '', direccion: '', logisticaInversa: '', tracking: '', ...extra });
  const r = await postLD(page, 'modules/envios/devoluciones/procesar_listado.php', campos);
  if (r.status !== 200) throw new Error(`listado devoluciones → HTTP ${r.status}`);
  const j = JSON.parse(r.texto);
  return Array.isArray(j) ? {} : j; // sin resultados devuelve []
}

async function choferDeposito(page) {
  const r = await postLD(page, 'modules/system_users/alta/controlador.php', [['operador', 'getuserPerfil'], ['perfil', 3]]);
  const lista = JSON.parse(r.texto);
  const c = lista.find((x) => CHOFER_DEPOSITO.test(`${x.nombre} ${x.apellido}`));
  if (!c) throw new Error('No encontré el chofer "devuelto deposito" en LightData');
  return String(c.did);
}

async function sync(page) {
  const chofer = await choferDeposito(page);
  const todos = await listado(page);
  const enDeposito = new Set(Object.keys(await listado(page, { chofer })));
  console.log(`Listado: ${Object.keys(todos).length} envíos desde ${DESDE}; ${enDeposito.size} con chofer devuelto deposito`);

  const filas = [];
  for (const [did, l] of Object.entries(todos)) {
    if (l.canceladoYnoEntro) continue; // nunca entró a Flexit
    const tipo = tipoDe(l);
    if (!tipo) continue;
    filas.push({
      did: Number(did), tipo, cliente: String(l.nombre_cliente || '').trim(), ml_venta_id: l.ml_venta_id || null,
      tracking: l.mlid || null, cp: l.cp || null, zona: l.zona || null, estado_ld: Number(l.estado),
      devuelto_ld: String(l.devuelto) === '1', fecha_dev_ld: fechaLD(l.fechaDev), li_texto: l.logInversa || null,
      fecha_alta: fechaLD(l.fecha), en_deposito_ld: enDeposito.has(did),
    });
  }

  const previas = new Map((await sbTodo('devoluciones?select=did,estado_ld,en_deposito_ld,detalle_at,direccion')).map((r) => [Number(r.did), r]));
  const dia = 24 * 3600e3;
  const necesitan = filas.filter((f) => {
    const p = previas.get(f.did);
    if (!p || !p.detalle_at) return true;
    if (!p.direccion && Date.parse(p.detalle_at) < Date.parse('2026-10-21T01:00:00Z')) return true; // backfill único de dirección
    if (p.estado_ld !== f.estado_ld || p.en_deposito_ld !== f.en_deposito_ld) return true;
    return f.estado_ld !== ESTADO.DEVUELTO_CLIENTE && Date.now() - Date.parse(p.detalle_at) > dia;
  }).map((f) => f.did);
  console.log(`Fichas a consultar: ${necesitan.length} de ${filas.length}`);
  const fx = await fichas(page, necesitan);
  const ahora = new Date().toISOString();
  const completas = filas.map((f) => {
    const base = { ...f, actualizado_at: ahora };
    if (fx[f.did]) Object.assign(base, datosFicha(fx[f.did]), { detalle_at: ahora });
    return base;
  });
  // Las que no se consultaron hoy: no pisar sus fechas (upsert solo con las columnas del listado)
  const conFicha = completas.filter((f) => f.detalle_at);
  const sinFicha = completas.filter((f) => !f.detalle_at);
  for (const grupo of [conFicha, sinFicha]) {
    for (let i = 0; i < grupo.length; i += 500) {
      await sb('devoluciones?on_conflict=did', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(grupo.slice(i, i + 500)) });
    }
  }
  return { total: filas.length, fichas: Object.keys(fx).length };
}

// ---------- 0) IMPORTACIÓN ÚNICA desde la página de Santi (devoluciones-flexit) ----------
// Hasta oct-2026 el ingreso de CAMBIOS al depósito y los reclamos/extraviados se marcaban ahí.
// Corre solo si devoluciones_gestion está vacía. La URL y la clave pública se leen de su página
// (no se copian al repo).
function fechaSanti(s, respaldo) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])?)?/i.exec(String(s || '').trim());
  if (!m) return respaldo || null;
  let h = Number(m[4] || 12);
  if (m[7]) { const pm = /p/i.test(m[7]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${String(h).padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}-03:00`;
}
async function importarSanti() {
  const ya = await sb('devoluciones_gestion?select=did&limit=1');
  if (ya.length) return 0;
  const html = await (await fetch('https://devoluciones-flexit.vercel.app/')).text();
  const m = /url:'(https:\/\/[a-z0-9]+\.supabase\.co)',\s*key:'([^']+)'/.exec(html);
  if (!m) { console.log('Importación Santi: no encontré la configuración en su página'); return 0; }
  const [, url, key] = m;
  const filas = [];
  for (let o = 0; ; o += 1000) {
    const r = await fetch(`${url}/rest/v1/gestion?select=id,tipo,estado,fecha_devuelto,fecha_reclamo,fecha_descartado,motivo_descarte,usuario,actualizado&offset=${o}&limit=1000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error('Importación Santi: ' + JSON.stringify(j).slice(0, 150));
    filas.push(...j);
    if (j.length < 1000) break;
  }
  const quien = (g) => `${g.usuario || 'santi'} (pág. Santi)`;
  const ingresos = filas.filter((g) => g.tipo === 'CAMBIO' && g.estado === 'devuelto')
    .map((g) => ({ did: g.id, ingreso_deposito_at: fechaSanti(g.fecha_devuelto, g.actualizado), ingreso_por: quien(g) }));
  const marcas = filas.filter((g) => ['reclamado', 'extraviado', 'descartado'].includes(g.estado))
    .map((g) => ({ did: g.id, marca: g.estado, marca_por: quien(g), marca_at: fechaSanti(g.fecha_reclamo || g.fecha_descartado, g.actualizado), marca_nota: g.motivo_descarte || null }));
  for (const grupo of [ingresos, marcas]) {
    for (let i = 0; i < grupo.length; i += 500) {
      await sb('devoluciones_gestion?on_conflict=did', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(grupo.slice(i, i + 500)) });
    }
  }
  console.log(`Importación Santi: ${ingresos.length} ingresos de cambios, ${marcas.length} marcas`);
  return ingresos.length + marcas.length;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_KEY || !LD_USER || !LD_PASS) throw new Error('Faltan SUPABASE_URL, SUPABASE_KEY, LIGHTDATA_USER o LIGHTDATA_PASSWORD');
  const { browser, page } = await login();
  let detalle = '';
  try {
    try { const n = await importarSanti(); if (n) detalle += `importados de Santi ${n}; `; } catch (e) { console.error(e.message); detalle += `importación Santi falló: ${String(e.message).slice(0, 120)}; `; }
    if (ACCION !== 'sync') { const n = await procesarRemitos(page); detalle += `remitos ${n}; `; }
    if (ACCION !== 'procesar') { const s = await sync(page); detalle += `devoluciones ${s.total}, fichas ${s.fichas}`; }
    await sb('devoluciones_sync?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ultima_at: new Date().toISOString(), ok: true, detalle }) });
    console.log('Listo:', detalle);
  } catch (e) {
    await sb('devoluciones_sync?id=eq.1', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ultima_at: new Date().toISOString(), ok: false, detalle: String(e.message).slice(0, 300) }) }).catch(() => {});
    throw e;
  } finally { await browser.close(); }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
