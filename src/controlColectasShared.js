// controlColectasShared.js — Control de colectas en Arribos (Alejo 25/11/2026).
//
// Pregunta que responde: ¿el chofer pasó por cada colecta que le dimos?
// Fuente: informe "Colecta por cliente" de LightData (bridge /colecta → clientes[{idCliente, cantidad}]).
// Se carga cuando el chofer escanea en el local del cliente, así que sirve antes de que llegue al depósito.
// Vínculo cliente de Colectas ↔ cuenta(s) de LightData: tabla colectas_cliente_ld (un cliente puede
// tener varias cuentas; una cuenta puede ser de varias sucursales, ej. La Plata Trade).

export const CORTE_COLECTAS = '13:30'; // a esta hora tiene que estar todo colectado

export function minutosDe(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (Number.isFinite(m) ? m : 0) : null;
}

// rows de colectas_cliente_ld → { [cliente_id]: [{ ld_id, ld_nombre }] }
export function indexVinculos(rows) {
  const out = {};
  (rows || []).forEach(r => {
    if (!r || !r.cliente_id || r.ld_id == null) return;
    (out[r.cliente_id] = out[r.cliente_id] || []).push({ ld_id: Number(r.ld_id), ld_nombre: r.ld_nombre || '' });
  });
  return out;
}

// cuentas LD usadas por más de un cliente de Colectas (sucursales con la misma cuenta)
export function cuentasCompartidas(vinculos) {
  const uso = {};
  Object.values(vinculos || {}).forEach(arr => arr.forEach(v => { uso[v.ld_id] = (uso[v.ld_id] || 0) + 1; }));
  return new Set(Object.keys(uso).filter(k => uso[k] > 1).map(Number));
}

// Colectas que hoy tiene que hacer algún chofer: mismo criterio que la lista de Arribos
// (verde, o confirmada para ese chofer). Las canceladas (rojo) y "A coordinar" no cuentan.
export function colectasAsignadas(registros, clientes) {
  const porId = {};
  (clientes || []).forEach(c => { porId[c.id] = c; });
  const out = [];
  Object.entries(registros || {}).forEach(([cid, r]) => {
    if (!r || r.estado === 'rojo') return;
    const choferes = (r.choferes || []).filter(ch => ch && ch !== 'A coordinar'
      && (r.estado === 'verde' || (r.confirmado_por || []).includes(ch)));
    if (!choferes.length) return;
    const c = porId[cid];
    out.push({
      clienteId: cid,
      registroId: r.id || null,
      nombre: c ? c.nombre : '(cliente)',
      choferes,
      manualAt: r.colectado_manual_at || null,
      manualPor: r.colectado_manual_por || null,
    });
  });
  return out;
}

// Estado de cada colecta asignada.
//   colectada    → LightData registró envíos de su cuenta hoy, o alguien la marcó a mano
//   sin_vincular → el cliente no tiene cuenta de LightData asociada (no se puede controlar solo)
//   pendiente    → todavía no, y no pasó el corte
//   vencida      → pasó el corte (o es un día anterior) y no se colectó
//   sin_datos    → no se pudo leer LightData: nunca se marca vencida por un error nuestro
// ldPorCliente: { [idCliente LD]: cantidad } | null si el bridge falló.
// ingresoPorLd: { [idCliente LD]: envíos del día que ya no están "A retirar" } — respaldo para cuando el
// chofer se saltea el paso "colectado" y lo pone directo en planta (Alejo 25/11). null si no hay dato.
export function evaluarControl({ asignadas, vinculos, ldPorCliente, ingresoPorLd, ahoraMin, corteMin, esHoy, esPasado }) {
  // "compartida" solo si otra colecta ASIGNADA HOY usa la misma cuenta (fichas duplicadas de sábado no cuentan)
  const vincHoy = {};
  (asignadas || []).forEach(a => { if (vinculos && vinculos[a.clienteId]) vincHoy[a.clienteId] = vinculos[a.clienteId]; });
  const compartidas = cuentasCompartidas(vincHoy);
  const items = (asignadas || []).map(a => {
    const cuentas = (vinculos && vinculos[a.clienteId]) || [];
    const cantidad = ldPorCliente
      ? cuentas.reduce((s, v) => s + Number(ldPorCliente[v.ld_id] || 0), 0)
      : 0;
    const compartida = cuentas.some(v => compartidas.has(v.ld_id));
    const ingresados = ingresoPorLd ? cuentas.reduce((s, v) => s + Number(ingresoPorLd[v.ld_id] || 0), 0) : 0;
    let estado;
    if (a.manualAt) estado = 'colectada';
    else if (!cuentas.length) estado = 'sin_vincular';
    else if (cantidad > 0 || ingresados > 0) estado = 'colectada';
    else if (!ldPorCliente) estado = 'sin_datos';
    else if (esPasado || (esHoy && corteMin != null && ahoraMin >= corteMin)) estado = 'vencida';
    else estado = 'pendiente';
    return { ...a, cuentas, cantidad, ingresados, compartida, estado, manual: !!a.manualAt };
  });
  const orden = { vencida: 0, pendiente: 1, sin_vincular: 2, sin_datos: 3, colectada: 4 };
  items.sort((x, y) => (orden[x.estado] - orden[y.estado]) || x.nombre.localeCompare(y.nombre, 'es'));
  const cuenta = (e) => items.filter(i => i.estado === e).length;
  return {
    items,
    total: items.length,
    colectadas: cuenta('colectada'),
    pendientes: cuenta('pendiente'),
    vencidas: cuenta('vencida'),
    sinVincular: cuenta('sin_vincular'),
    sinDatos: cuenta('sin_datos'),
  };
}

// Por chofer: { [chofer]: { total, colectadas } } para el chip "2/3 colectas" de cada ficha.
export function resumenPorChofer(items) {
  const out = {};
  (items || []).forEach(i => i.choferes.forEach(ch => {
    const o = out[ch] || (out[ch] = { total: 0, colectadas: 0 });
    o.total++;
    if (i.estado === 'colectada') o.colectadas++;
  }));
  return out;
}

// Búsqueda de cuentas de LightData por nombre (sin acentos ni mayúsculas).
export function buscarCuentas(lista, q, max = 8) {
  const n = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  const qq = n(q);
  if (!qq) return [];
  return (lista || []).filter(c => n(c.nombre).includes(qq) || String(c.id) === String(q).trim()).slice(0, max);
}

// Envíos del día por cuenta LD que ya salieron de "A retirar" (entraron al circuito).
// filas: envios_busqueda {cod_cliente, estado}; codigoAId: { [codigo sin ceros]: idCliente LD }.
export function ingresoPorCuenta(filas, codigoAId) {
  const out = {};
  (filas || []).forEach(f => {
    const est = String(f.estado || '').toLowerCase();
    if (!est || est === 'a retirar' || est === 'cancelado') return;
    const id = codigoAId[String(f.cod_cliente || '').replace(/^0+/, '')];
    if (id == null) return;
    out[id] = (out[id] || 0) + 1;
  });
  return out;
}
