// src/Pagos.js — Pestaña Pagos: liquidación semanal de cadetes por entregados.
// Lee pagos_entregados (snapshot semanal) + cadetes_tarifas + pagos_cadete_alias +
// cadete_precio_cp + localidad_zonas + colectas_registros + pagos_ajustes.
// Maker/checker: la app calcula y muestra; Alejo revisa, edita y confirma — nada se paga solo.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { login, logout, getSession, authedFetch } from './auth';
import PagosPagador from './PagosPagador';

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";
const ADMIN_EMAIL = "admin@flexit.app";

const BRAND = {
  navy:     "#0d1b2a",
  navyMid:  "#112236",
  navyCard: "#162d42",
  teal:     "#2ECFAA",
  red:      "#E24B4A",
  amber:    "#FFB020",
  white:    "#FFFFFF",
  muted:    "rgba(255,255,255,0.62)",
  faint:    "rgba(255,255,255,0.06)",
  border:   "rgba(255,255,255,0.09)",
};

// ───────────────────────── helpers ─────────────────────────

// '2026-07-06' -> '06/07' (formato local para mostrar fechas)
function fmtDM(iso) {
  const s = String(iso || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : s;
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ') // colapsa dobles espacios ("Emanuel  Cortazzo" == "Emanuel Cortazzo")
    .trim();
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const lunes = new Date(d); lunes.setDate(diff);
  return lunes.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtSemanaLabel(lunes) {
  if (!lunes) return '';
  const sab = addDays(lunes, 5);
  const f = (s) => { const p = s.split('-'); return `${p[2]}/${p[1]}`; };
  return `${f(lunes)} al ${f(sab)}`;
}

function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return '$' + Math.round(n).toLocaleString('es-AR');
}

async function sb(path, options = {}) {
  const res = await authedFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { 'Prefer': 'return=representation', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${t.slice(0, 300)}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// GET paginado — pagos_entregados puede tener >1000 filas por semana.
async function sbAll(path, pageSize = 1000) {
  let all = [];
  let offset = 0;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const res = await authedFetch(`${SUPABASE_URL}/rest/v1/${path}${sep}limit=${pageSize}&offset=${offset}`, {
      headers: { 'Prefer': 'return=representation' },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Supabase ${res.status}: ${t.slice(0, 300)}`);
    }
    const chunk = await res.json();
    all = all.concat(chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

function useXLSX() {
  const [ready, setReady] = useState(typeof window !== 'undefined' && !!window.XLSX);
  useEffect(() => {
    if (window.XLSX) { setReady(true); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);
  return ready;
}

// ───────────────────────── motor de cálculo (puro) ─────────────────────────
// Ver wiki/analisis/spec-pagos-app-tab.md — lógica de cálculo.

function precioZonaDominante(rows, tarifa, zonaByLoc) {
  const counts = {};
  rows.forEach(r => {
    const z = zonaByLoc.get(norm(r.localidad));
    if (z) counts[z] = (counts[z] || 0) + 1;
  });
  let best = null, bestN = 0;
  Object.entries(counts).forEach(([z, n]) => { if (n > bestN) { best = z; bestN = n; } });
  if (!best) return { zona: null, precio: null };
  const precio = tarifa[`tarifa_${best}`];
  return { zona: best, precio: precio != null ? Number(precio) : null };
}

function calcularFila(canonName, rows, tarifa, ctx) {
  const { cpPriceMap, zonaByLoc, colectaByKey, ajusteRowsByKey } = ctx;
  const key = norm(canonName);
  const cantidad = rows.length;
  const base = tarifa.precio_fijo != null ? Number(tarifa.precio_fijo) : null;
  let monto = 0, faltaPrecio = false, fallbackInfo = null, cpBreakdown = null, modoEfectivo = 'fijo';

  if (base != null) {
    // Modelo unificado: precio base para TODO + overrides por CP (excepciones, ej. sábados de Javier).
    // Un cadete sin overrides cobra todo al precio base (idéntico al viejo "fijo").
    const porCp = new Map();
    rows.forEach(r => {
      const cp = String(r.cp || '').trim() || '(sin CP)';
      const ov = cpPriceMap.get(`${key}|${cp}`);
      const prev = porCp.get(cp);
      if (prev) prev.cantidad += 1;
      else porCp.set(cp, { cp, cantidad: 1, precio: ov != null ? Number(ov) : base, conOverride: ov != null });
    });
    const bd = [...porCp.values()].sort((a, b) => b.cantidad - a.cantidad);
    bd.forEach(b => { monto += b.precio * b.cantidad; });
    if (bd.some(b => b.conOverride)) { cpBreakdown = bd; modoEfectivo = 'cp'; } // solo se muestra desglose si hay excepciones
  } else if (tarifa.modo === 'cp') {
    // Legacy: cadete en modo cp sin precio base (solo overrides). Sin base, lo que no tenga override queda sin precio.
    const porCp = new Map();
    rows.forEach(r => { const cp = String(r.cp || '').trim() || '(sin CP)'; porCp.set(cp, (porCp.get(cp) || 0) + 1); });
    cpBreakdown = []; let faltantes = 0; modoEfectivo = 'cp';
    porCp.forEach((n, cp) => {
      const ov = cpPriceMap.get(`${key}|${cp}`);
      if (ov == null) faltantes += n; else monto += Number(ov) * n;
      cpBreakdown.push({ cp, cantidad: n, precio: ov != null ? Number(ov) : null, conOverride: ov != null });
    });
    cpBreakdown.sort((a, b) => b.cantidad - a.cantidad);
    if (faltantes > 0) { faltaPrecio = true; fallbackInfo = `${faltantes} entrega(s) sin precio — ponele un precio fijo (base)`; }
  } else {
    // Sin precio base: fallback a la tarifa por zona dominante (comportamiento legacy).
    const fb = precioZonaDominante(rows, tarifa, zonaByLoc);
    const precio = fb.precio;
    fallbackInfo = fb.zona ? `sin precio fijo — tarifa zona "${fb.zona}"` : 'sin precio fijo y sin zona detectada';
    if (precio == null) faltaPrecio = true;
    else monto = precio * cantidad;
  }

  const colecta = colectaByKey.get(key) || 0;
  const ajusteRows = ajusteRowsByKey.get(key) || [];
  const ajusteTotal = ajusteRows.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  const total = (monto || 0) + colecta - ajusteTotal;

  return {
    key,
    nombre: tarifa.nombre_lightdata || canonName,
    cantidad, cantidadOriginal: cantidad,
    monto, faltaPrecio, fallbackInfo, cpBreakdown,
    colecta, ajusteRows, ajusteTotal, total,
    factura: !!tarifa.factura,
    activo: tarifa.activo !== false,
    modo: modoEfectivo,
    precioFijo: base,
    tarifaId: tarifa.id,
  };
}

function calcularPagos({ entregados, tarifas, alias, cpOverrides, zonas, colectas, ajustes }) {
  const tarifaByLD = new Map();
  tarifas.forEach(t => { if (t.nombre_lightdata) tarifaByLD.set(norm(t.nombre_lightdata), t); });

  const aliasByLD = new Map();
  alias.forEach(a => { if (a.nombre_lightdata) aliasByLD.set(norm(a.nombre_lightdata), a); });

  const zonaByLoc = new Map();
  zonas.forEach(z => { zonaByLoc.set(norm(z.localidad), z.zona); });

  const cpPriceMap = new Map();
  cpOverrides.forEach(o => { cpPriceMap.set(`${norm(o.nombre_lightdata)}|${String(o.cp).trim()}`, Number(o.precio)); });

  // 1. agrupar crudo por nombre LightData tal cual viene
  const rawGroups = new Map();
  const sinCadete = []; // entregas sin cadete asignado en LightData: plata repartida que nadie cobra
  entregados.forEach(e => {
    const raw = (e.cadete || '').trim();
    if (!raw) { sinCadete.push(e); return; } // hueco de dato: se contabiliza y se muestra en "A revisar"
    const key = norm(raw);
    if (!rawGroups.has(key)) rawGroups.set(key, { raw, rows: [] });
    rawGroups.get(key).rows.push(e);
  });

  // 2. resolver alias -> canónico / aparte / ignorar
  const canonGroups = new Map();
  const aparteGroups = new Map();
  const ignorados = [];

  for (const [key, g] of rawGroups) {
    const al = aliasByLD.get(key);
    if (al && al.regla === 'ignorar') { ignorados.push({ raw: g.raw, cantidad: g.rows.length, desde: al.updated_at }); continue; }
    if (al && al.regla === 'aparte') {
      if (!aparteGroups.has(key)) aparteGroups.set(key, { raw: g.raw, rows: [] });
      aparteGroups.get(key).rows.push(...g.rows);
      continue;
    }
    const canonRaw = (al && al.regla === 'merge' && al.paga_como) ? al.paga_como : g.raw;
    const canonKey = norm(canonRaw);
    if (!canonGroups.has(canonKey)) canonGroups.set(canonKey, { canonName: canonRaw, rows: [] });
    canonGroups.get(canonKey).rows.push(...g.rows);
  }

  // 3. colectas de la semana por canónico (choferes[] -> monto completo por chofer listado,
  //    mismo criterio que la sub-vista "Pagos" existente dentro de Colectas)
  const colectaByKey = new Map();
  const colectasSinMatch = [];
  const colectaResumen = new Map(); // desglose por chofer para la seccion Colectas de Liquidaciones (solo lectura)
  const fleteroMap = new Map(); // fleteros: solo hacen colectas y cobran el monto de cada una
  colectas.forEach(c => {
    const confirmada = c.estado === 'verde' || (Array.isArray(c.confirmado_por) && c.confirmado_por.length > 0);
    if (!confirmada) return; // solo se paga la colecta confirmada (no 'sin envíos'/rojo ni pendientes)
    const monto = Number(c.monto ?? c.colectas_clientes?.monto ?? 0) || 0; // fallback al precio del cliente (el monto por colecta casi nunca se guarda)
    (c.choferes || []).forEach(ch => {
      let raw = (ch || '').trim();
      if (!raw || norm(raw) === 'a coordinar') return;
      // resolver alias también en colectas (ej. "Yeni" -> "Yeni Sambrano")
      const alC = aliasByLD.get(norm(raw));
      if (alC && alC.regla === 'merge' && alC.paga_como) raw = alC.paga_como;
      const key = norm(raw);
      const tC = tarifaByLD.get(key);
      if (tC && tC.fletero) {
        const f = fleteroMap.get(key) || { key, nombre: tC.nombre_lightdata || raw, cantidad: 0, monto: 0, entregas: 0 };
        f.cantidad += 1; f.monto += monto;
        fleteroMap.set(key, f);
        return;
      }
      if (tarifaByLD.has(key)) {
        colectaByKey.set(key, (colectaByKey.get(key) || 0) + monto);
        const r = colectaResumen.get(key) || { chofer: raw, cadete: tarifaByLD.get(key).nombre_lightdata || raw, cantidad: 0, monto: 0 };
        r.cantidad += 1; r.monto += monto;
        colectaResumen.set(key, r);
      } else {
        colectasSinMatch.push({ chofer: raw, fecha: c.fecha, monto });
      }
    });
  });

  // 4. ajustes de la semana por canónico
  const ajusteRowsByKey = new Map();
  ajustes.forEach(a => {
    const key = norm(a.cadete || '');
    if (!ajusteRowsByKey.has(key)) ajusteRowsByKey.set(key, []);
    ajusteRowsByKey.get(key).push(a);
  });

  const ctx = { cpPriceMap, zonaByLoc, colectaByKey, ajusteRowsByKey };

  const filas = [];
  for (const [key, g] of canonGroups) {
    const tarifa = tarifaByLD.get(key);
    if (!tarifa) {
      // sin tarifa: no genera fila. Se reporta abajo como "por dar de alta" (chofer
      // nuevo desconocido) o como "error de config" (alias que apunta a la nada).
      continue;
    }
    if (tarifa.fletero) {
      // fletero: sus entregas en LightData no se pagan; cobra solo las colectas (fila fletero más abajo)
      const f = fleteroMap.get(key) || { key, nombre: tarifa.nombre_lightdata || g.canonName, cantidad: 0, monto: 0, entregas: 0 };
      f.entregas += g.rows.length;
      fleteroMap.set(key, f);
      continue;
    }
    filas.push(calcularFila(g.canonName, g.rows, tarifa, ctx));
  }
  // fleteros: fila normal en la liquidación (suma al total y respeta transferencia/efectivo), pero solo cobra colectas
  for (const f of fleteroMap.values()) {
    const t = tarifaByLD.get(f.key);
    const ajusteRows = ajusteRowsByKey.get(f.key) || [];
    const ajusteTotal = ajusteRows.reduce((s, a) => s + (Number(a.monto) || 0), 0);
    filas.push({
      key: f.key, nombre: f.nombre, esFletero: true,
      colectasCant: f.cantidad, entregasLD: f.entregas,
      cantidad: 0, cantidadOriginal: 0,
      monto: 0, faltaPrecio: false, fallbackInfo: null, cpBreakdown: null,
      colecta: f.monto, ajusteRows, ajusteTotal,
      total: f.monto - ajusteTotal,
      factura: !!(t && t.factura),
      activo: !t || t.activo !== false,
      modo: 'fletero', precioFijo: null, tarifaId: t ? t.id : null,
    });
  }

  const aparte = [];
  for (const [key, g] of aparteGroups) {
    const tarifa = tarifaByLD.get(key);
    if (tarifa) {
      aparte.push(calcularFila(g.raw, g.rows, tarifa, ctx));
    } else {
      aparte.push({
        key, nombre: g.raw, cantidad: g.rows.length, cantidadOriginal: g.rows.length,
        monto: null, faltaPrecio: true, fallbackInfo: 'sin tarifa cargada (dar de alta en Config)',
        cpBreakdown: null, colecta: 0, ajusteRows: [], ajusteTotal: 0, total: 0,
        factura: false, activo: true, modo: 'fijo', precioFijo: null, tarifaId: null,
      });
    }
  }

  // ── Choferes POR DAR DE ALTA: nombres que aparecen esta semana (entregas y/o
  //    colectas), sin tarifa y sin NINGÚN alias configurado (desconocidos reales).
  //    Usa el mismo matching (norm) que el que paga -> no hay falsos "nuevos".
  const altaMap = new Map();
  for (const [key, g] of rawGroups) {
    if (tarifaByLD.has(key) || aliasByLD.has(key)) continue;
    const e = altaMap.get(key) || { key, nombre: g.raw, entregas: 0, colectas: 0 };
    e.entregas += g.rows.length;
    altaMap.set(key, e);
  }
  colectas.forEach(c => {
    const confirmada = c.estado === 'verde' || (Array.isArray(c.confirmado_por) && c.confirmado_por.length > 0);
    if (!confirmada) return;
    (c.choferes || []).forEach(ch => {
      const raw = (ch || '').trim();
      if (!raw || norm(raw) === 'a coordinar') return;
      const key = norm(raw);
      if (tarifaByLD.has(key) || aliasByLD.has(key)) return;
      const e = altaMap.get(key) || { key, nombre: raw, entregas: 0, colectas: 0 };
      e.colectas += 1;
      altaMap.set(key, e);
    });
  });
  const porDarAlta = [...altaMap.values()].sort((a, b) => (b.entregas + b.colectas) - (a.entregas + a.colectas));

  // ── Errores de config REALES: un alias 'merge' cuyo paga_como no existe en
  //    cadetes_tarifas. (Distinto de "por dar de alta": acá el alias ya está,
  //    pero apunta a un nombre inexistente, así que esas entregas no se pagan.)
  const configErrors = [];
  for (const a of alias) {
    if (a.regla !== 'merge' || !a.paga_como) continue;
    if (tarifaByLD.has(norm(a.paga_como))) continue;
    const rg = rawGroups.get(norm(a.nombre_lightdata));
    configErrors.push({
      pagaComo: a.paga_como,
      aliasDesde: a.nombre_lightdata,
      cantidad: rg ? rg.rows.length : 0,
      motivo: `El alias «${a.nombre_lightdata}» paga como «${a.paga_como}», que no existe en Config`,
    });
  }

  // CPs a los que entregó cada cadete esta semana (para pre-cargar el modal de precios por CP en Config)
  const cpsPorCadete = new Map();
  for (const [canonKey, g] of canonGroups) {
    const porCp = new Map();
    g.rows.forEach(r => {
      const cp = String(r.cp || '').trim() || '(sin CP)';
      const zona = zonaByLoc.get(norm(r.localidad)) || '';
      let e = porCp.get(cp);
      if (!e) { e = { cp, cantidad: 0, zonas: new Map() }; porCp.set(cp, e); }
      e.cantidad += 1;
      if (zona) e.zonas.set(zona, (e.zonas.get(zona) || 0) + 1);
    });
    const arr = [...porCp.values()].map(e => {
      let zona = '', best = 0;
      e.zonas.forEach((n, z) => { if (n > best) { best = n; zona = z; } });
      return { cp: e.cp, cantidad: e.cantidad, zona };
    }).sort((x, y) => y.cantidad - x.cantidad);
    cpsPorCadete.set(canonKey, arr);
  }
  return { filas, aparte, ignorados, configErrors, colectasSinMatch, sinCadete, colectaResumen, cpsPorCadete, porDarAlta };
}

// aplica el override de cantidad (editable en la UI) a una fila calculada
function filaConOverride(fila, overrideCantidad) {
  if (overrideCantidad == null || overrideCantidad === fila.cantidadOriginal) return fila;
  const precioUnit = fila.cantidadOriginal > 0
    ? (fila.monto || 0) / fila.cantidadOriginal
    : (fila.precioFijo || 0);
  const montoNuevo = precioUnit * overrideCantidad;
  const total = montoNuevo + fila.colecta - fila.ajusteTotal;
  return { ...fila, cantidad: overrideCantidad, monto: montoNuevo, total, editado: true };
}

// overrides de cantidad persistidos por semana (sobreviven al F5 hasta cerrar la semana)
function overridesKey(lunes) { return `pagos_overrides_${lunes}`; }
function loadOverrides(lunes) {
  if (!lunes) return {};
  try { const raw = localStorage.getItem(overridesKey(lunes)); return raw ? JSON.parse(raw) : {}; }
  catch { return {}; }
}
function saveOverrides(lunes, obj) {
  if (!lunes) return;
  try {
    if (obj && Object.keys(obj).length) localStorage.setItem(overridesKey(lunes), JSON.stringify(obj));
    else localStorage.removeItem(overridesKey(lunes));
  } catch { /* localStorage no disponible: seguimos en memoria */ }
}

// ───────────────────────── login ─────────────────────────

function LoginPagos({ onOk }) {
  const [em, setEm] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const inp = { width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${err ? '#FF5C5C' : 'rgba(255,255,255,0.18)'}`, background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: 15, boxSizing: 'border-box', outline: 'none' };
  return (
    <div style={{ minHeight: '62vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 400, maxWidth: '94vw', padding: '36px 32px', borderRadius: 22, border: '1px solid rgba(46,207,170,0.22)', background: 'linear-gradient(165deg, rgba(46,207,170,0.09), rgba(58,143,212,0.06) 55%, rgba(255,255,255,0.02))', textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>💰</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Liquidaciones</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 4, marginBottom: 22 }}>Ingresá con tu usuario del equipo</div>
        <form onSubmit={async e => {
          e.preventDefault(); if (busy) return; setBusy(true); setErr('');
          try { const ses = await login(em, pw); onOk(ses); }
          catch (er) { setErr(er.message || 'No se pudo iniciar sesión'); }
          finally { setBusy(false); }
        }}>
          <input type="email" autoFocus autoComplete="username" value={em} onChange={e => { setEm(e.target.value); setErr(''); }} placeholder="Email" style={{ ...inp, marginBottom: 10 }} />
          <input type="password" autoComplete="current-password" value={pw} onChange={e => { setPw(e.target.value); setErr(''); }} placeholder="Contraseña" style={inp} />
          {err && <div style={{ color: '#FF5C5C', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
          <button type="submit" disabled={busy} style={{ width: '100%', marginTop: 16, padding: '13px 10px', borderRadius: 12, fontSize: 14.5, fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(46,207,170,0.35)', background: 'rgba(46,207,170,0.12)', color: '#2ECFAA' }}>{busy ? 'Entrando…' : 'Entrar'}</button>
        </form>
      </div>
    </div>
  );
}

// ───────────────────────── export a excel ─────────────────────────

function exportarExcel({ filas, aparte, porDarAlta, semanaLunes, subtotales }) {
  const label = fmtSemanaLabel(semanaLunes);
  const header = ['Cadete', 'Cantidad', 'Precio', 'Monto', 'Colecta', 'Ajuste', 'TOTAL', 'Método'];
  const rows = filas.map(f => f.esFletero ? [
    `${f.nombre} (fletero)`, `${f.colectasCant} colectas`, '', '',
    Math.round(f.colecta || 0), Math.round(f.ajusteTotal || 0),
    Math.round(f.total || 0), f.factura ? 'Transferencia' : 'Efectivo',
  ] : [
    f.nombre, f.cantidad,
    f.cantidad ? Math.round((f.monto || 0) / f.cantidad) : (f.precioFijo || ''),
    Math.round(f.monto || 0), Math.round(f.colecta || 0), Math.round(f.ajusteTotal || 0),
    Math.round(f.total || 0), f.factura ? 'Transferencia' : 'Efectivo',
  ]);

  const aoa = [
    [`Liquidaciones — Semana ${label}`],
    [],
    header,
    ...rows,
    [],
    ['TOTAL GENERAL', '', '', '', '', '', Math.round(subtotales.total)],
    ['Transferencia', '', '', '', '', '', Math.round(subtotales.transferencia)],
    ['Efectivo', '', '', '', '', '', Math.round(subtotales.efectivo)],
  ];

  if (aparte.length) {
    aoa.push([], ['PAGOS APARTE (fleteros / no suman al total)']);
    aoa.push(header);
    aparte.forEach(f => aoa.push([
      f.nombre, f.cantidad,
      f.cantidad && f.monto != null ? Math.round((f.monto || 0) / f.cantidad) : (f.precioFijo || ''),
      f.monto != null ? Math.round(f.monto) : 'FALTA PRECIO',
      Math.round(f.colecta || 0), Math.round(f.ajusteTotal || 0),
      f.total != null ? Math.round(f.total) : '', f.factura ? 'Transferencia' : 'Efectivo',
    ]));
  }

  if (porDarAlta && porDarAlta.length) {
    aoa.push([], ['A REVISAR — choferes por dar de alta']);
    aoa.push(['Chofer', 'Entregas', 'Colectas']);
    porDarAlta.forEach(s => aoa.push([s.nombre, s.entregas, s.colectas]));
  }

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  window.XLSX.utils.book_append_sheet(wb, ws, 'Liquidaciones');
  window.XLSX.writeFile(wb, `pagos_semana_${semanaLunes}.xlsx`);
}

// ───────────────────────── sub-vista: Config de cadetes (solo admin) ─────────────────────────

function ConfigCadetes({ tarifas, alias, cpOverrides, cpsPorCadete, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filtro, setFiltro] = useState('');
  const [cpSel, setCpSel] = useState('');
  const [hoverId, setHoverId] = useState(null); // fila de Config bajo el mouse
  const [nuevoCp, setNuevoCp] = useState({ cp: '', precio: '' });
  const [nuevoAlias, setNuevoAlias] = useState({ nombre_lightdata: '', regla: 'merge', paga_como: '', detalle: '' });
  const [nuevoCadete, setNuevoCadete] = useState({ nombre_lightdata: '', nombre: '', factura: false, precio_fijo: '' });
  const [drafts, setDrafts] = useState({}); // id -> campos editados pendientes
  const [cpDraft, setCpDraft] = useState({}); // cp -> precio en edición (modal de CPs)
  useEffect(() => { setCpDraft({}); }, [cpSel]);

  const inp = { padding: '5px 8px', fontSize: 12.5, border: `1px solid ${BRAND.border}`, borderRadius: 6, background: BRAND.faint, color: BRAND.white, outline: 'none' };
  const btn = { padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(46,207,170,0.35)', background: 'rgba(46,207,170,0.12)', color: BRAND.teal };

  const doAction = useCallback(async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); await onRefresh(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [onRefresh]);

  // Tarea 5: baja de cadete con red de seguridad. Si tiene cierres en el histórico,
  // no se borra (se ofrece desactivar); si no, se elimina tarifa + precios por CP.
  const borrarCadete = useCallback((t) => {
    const nombrePago = t.nombre_lightdata || t.nombre;
    const display = t.nombre || nombrePago;
    doAction(async () => {
      const hist = await sb(`pagos_cierres?cadete=eq.${encodeURIComponent(nombrePago)}&select=id&limit=1`);
      if (hist && hist.length > 0) {
        if (window.confirm(`"${display}" tiene semanas pagadas en el histórico — se desactiva para no romper el histórico.\n\n¿Desactivarlo? Deja de aparecer en la liquidación pero se conservan los cierres.`)) {
          await sb(`cadetes_tarifas?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify({ activo: false }) });
        }
        return;
      }
      if (!window.confirm(`¿Borrar a "${display}" definitivamente? No tiene semanas pagadas. Se eliminan su tarifa y sus precios por CP.`)) return;
      if (t.nombre_lightdata) await sb(`cadete_precio_cp?nombre_lightdata=eq.${encodeURIComponent(t.nombre_lightdata)}`, { method: 'DELETE' });
      await sb(`cadetes_tarifas?id=eq.${t.id}`, { method: 'DELETE' });
    });
  }, [doAction]);

  const filtrados = tarifas.filter(t => !filtro || norm(t.nombre_lightdata || t.nombre).includes(norm(filtro)));
  const cadetesCp = tarifas.filter(t => t.nombre_lightdata); // todos los cadetes con nombre (el modal de CPs sirve para cualquiera)
  const overridesDeSel = cpOverrides.filter(o => norm(o.nombre_lightdata) === norm(cpSel));
  const entregasCp = (cpsPorCadete && cpsPorCadete.get(norm(cpSel))) || [];
  const ovByCp = new Map(overridesDeSel.map(o => [String(o.cp).trim(), o.precio]));
  const cpRows = (() => {
    const seen = new Set(); const out = [];
    entregasCp.forEach(({ cp, cantidad, zona }) => { seen.add(cp); out.push({ cp, cantidad, zona: zona || '', precio: ovByCp.has(cp) ? ovByCp.get(cp) : null }); });
    overridesDeSel.forEach(o => { const cp = String(o.cp).trim(); if (!seen.has(cp)) out.push({ cp, cantidad: 0, zona: '', precio: o.precio }); });
    return out;
  })();
  const cpSinPrecio = cpRows.filter(r => r.precio == null && r.cantidad > 0).length;
  const guardarCpRow = (cp, precio) => doAction(async () => {
    if (ovByCp.has(cp)) await sb(`cadete_precio_cp?nombre_lightdata=eq.${encodeURIComponent(cpSel)}&cp=eq.${encodeURIComponent(cp)}`, { method: 'PATCH', body: JSON.stringify({ precio }) });
    else await sb('cadete_precio_cp', { method: 'POST', body: JSON.stringify([{ nombre_lightdata: cpSel, cp, precio }]) });
  });
  const borrarCpRow = (cp) => doAction(async () => { await sb(`cadete_precio_cp?nombre_lightdata=eq.${encodeURIComponent(cpSel)}&cp=eq.${encodeURIComponent(cp)}`, { method: 'DELETE' }); });

  function setDraft(id, field, value) {
    setDrafts(d => ({ ...d, [id]: { ...(d[id] || {}), [field]: value } }));
  }
  function draftVal(t, field) {
    return drafts[t.id]?.[field] !== undefined ? drafts[t.id][field] : t[field];
  }

  return (
    <div>
      {err && <div style={{ background: 'rgba(226,75,74,0.15)', color: BRAND.red, border: `1px solid ${BRAND.red}`, padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{err}</div>}

      {/* Alta rápida de cadete */}
      <div style={{ background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: BRAND.teal }}>Alta de cadete nuevo</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={inp} placeholder="Nombre LightData (exacto)" value={nuevoCadete.nombre_lightdata} onChange={e => setNuevoCadete(s => ({ ...s, nombre_lightdata: e.target.value, nombre: s.nombre || e.target.value }))} />
          <input style={inp} placeholder="Nombre para mostrar" value={nuevoCadete.nombre} onChange={e => setNuevoCadete(s => ({ ...s, nombre: e.target.value }))} />
          <input className="no-spin" style={{ ...inp, width: 100 }} type="number" placeholder="Precio fijo" value={nuevoCadete.precio_fijo} onChange={e => setNuevoCadete(s => ({ ...s, precio_fijo: e.target.value }))} />
          <label style={{ fontSize: 12, color: BRAND.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={nuevoCadete.factura} onChange={e => setNuevoCadete(s => ({ ...s, factura: e.target.checked }))} /> Factura
          </label>
          <button style={btn} disabled={busy || !nuevoCadete.nombre_lightdata.trim()} onClick={() => doAction(async () => {
            await sb('cadetes_tarifas', {
              method: 'POST',
              body: JSON.stringify([{
                nombre: nuevoCadete.nombre.trim() || nuevoCadete.nombre_lightdata.trim(),
                nombre_lightdata: nuevoCadete.nombre_lightdata.trim(),
                factura: nuevoCadete.factura, activo: true, modo: 'fijo',
                precio_fijo: nuevoCadete.precio_fijo ? Number(nuevoCadete.precio_fijo) : null,
              }]),
            });
            setNuevoCadete({ nombre_lightdata: '', nombre: '', factura: false, precio_fijo: '' });
          })}>+ Dar de alta</button>
        </div>
      </div>

      {/* Tabla de tarifas */}
      <div style={{ background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: 14, marginBottom: 16, overflowX: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: BRAND.teal }}>Cadetes ({tarifas.length})</div>
          <input style={inp} placeholder="Buscar..." value={filtro} onChange={e => setFiltro(e.target.value)} />
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760, fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: BRAND.muted, textAlign: 'left' }}>
              <th style={{ padding: '4px 6px' }}>Nombre LightData</th>
              <th style={{ padding: '4px 6px' }}>Factura</th>
              <th style={{ padding: '4px 6px' }} title="Solo hace colectas: cobra el monto de cada colecta y no entra a la liquidación por entregas">Fletero</th>
              <th style={{ padding: '4px 6px' }}>Precio fijo</th>
              <th style={{ padding: '4px 6px' }}>CUIL</th>
              <th style={{ padding: '4px 6px' }}>CBU</th>
              <th style={{ padding: '4px 6px' }}>Alias</th>
              <th style={{ padding: '4px 6px' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(t => {
              const isDirty = !!drafts[t.id];
              const isSel = cpSel && t.nombre_lightdata === cpSel;
              return (
                <tr key={t.id}
                  onMouseEnter={() => setHoverId(t.id)}
                  onMouseLeave={() => setHoverId(h => (h === t.id ? null : h))}
                  style={{ borderTop: `1px solid ${BRAND.border}`, background: isDirty ? 'rgba(255,176,32,0.10)' : isSel ? 'rgba(46,207,170,0.10)' : hoverId === t.id ? 'rgba(255,255,255,0.04)' : 'transparent' }}>
                  <td style={{ padding: '5px 6px', fontWeight: 600, borderLeft: `3px solid ${isSel ? BRAND.teal : 'transparent'}` }}>{t.nombre_lightdata || <span style={{ color: BRAND.amber }}>{t.nombre} (sin nombre_lightdata)</span>}</td>
                  <td style={{ padding: '5px 6px' }}>
                    <input type="checkbox" checked={!!draftVal(t, 'factura')} onChange={e => setDraft(t.id, 'factura', e.target.checked)} />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input type="checkbox" checked={!!draftVal(t, 'fletero')} onChange={e => setDraft(t.id, 'fletero', e.target.checked)} />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input className="no-spin" style={{ ...inp, width: 90 }} type="number" placeholder={t.precio_fijo == null ? 'sin fijar' : ''} value={draftVal(t, 'precio_fijo') ?? ''} onChange={e => setDraft(t.id, 'precio_fijo', e.target.value === '' ? null : Number(e.target.value))} />
                    {draftVal(t, 'precio_fijo') == null && (t.modo !== 'cp') && (() => {
                      const zonas = [['CABA', t.tarifa_caba], ['G1', t.tarifa_gba1], ['G2', t.tarifa_gba2], ['G3', t.tarifa_gba3]].filter(x => x[1] != null);
                      return zonas.length ? <div style={{ fontSize: 10, color: BRAND.muted, marginTop: 3 }}>sin precio fijo — usa zona: {zonas.map(x => x[0] + ' ' + money(x[1])).join(' · ')}</div> : null;
                    })()}
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input style={{ ...inp, width: 110 }} placeholder="sin CUIL" value={draftVal(t, 'cuil') ?? ''} onChange={e => setDraft(t.id, 'cuil', e.target.value)} />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input style={{ ...inp, width: 130 }} placeholder="sin CBU" value={draftVal(t, 'cbu') ?? ''} onChange={e => setDraft(t.id, 'cbu', e.target.value)} />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input style={{ ...inp, width: 110 }} placeholder="sin alias" value={draftVal(t, 'alias') ?? ''} onChange={e => setDraft(t.id, 'alias', e.target.value)} />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    {isDirty && (
                      <>
                        <button style={{ ...btn, padding: '3px 10px' }} disabled={busy} onClick={() => doAction(async () => {
                          await sb(`cadetes_tarifas?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify(drafts[t.id]) });
                          setDrafts(d => { const n = { ...d }; delete n[t.id]; return n; });
                        })}>Guardar</button>
                        <button title="deshacer cambios sin guardar" style={{ ...btn, padding: '3px 10px', marginLeft: 6, borderColor: BRAND.border, color: BRAND.muted, background: BRAND.faint }} disabled={busy} onClick={() => setDrafts(d => { const n = { ...d }; delete n[t.id]; return n; })}>↺</button>
                      </>
                    )}
                    {t.nombre_lightdata && (() => {
                      const nCp = cpOverrides.filter(o => o.nombre_lightdata === t.nombre_lightdata).length;
                      return <button title="agregar precios especiales por CP (excepciones sobre el precio base)" style={{ ...btn, padding: '3px 10px', marginLeft: 6, borderColor: nCp ? BRAND.teal : BRAND.border, color: nCp ? BRAND.teal : BRAND.white, background: nCp ? 'rgba(46,207,170,0.10)' : BRAND.faint }} onClick={() => setCpSel(t.nombre_lightdata)}>CPs extra{nCp ? ` (${nCp})` : ''}</button>;
                    })()}
                    <button title="borrar cadete" style={{ ...btn, padding: '3px 9px', marginLeft: 6, borderColor: BRAND.red, color: BRAND.red, background: 'rgba(226,75,74,0.1)' }} disabled={busy} onClick={() => borrarCadete(t)}>🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Precios por CP — modal (Tarea post-review) */}
      {cpSel && (
        <div onClick={() => setCpSel('')} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width: 480, maxWidth: '94vw', maxHeight: '86vh', overflowY: 'auto', background: BRAND.navyCard, border: `1px solid ${BRAND.teal}`, borderRadius: 14, padding: 18, boxShadow: '0 14px 44px rgba(0,0,0,0.55)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: BRAND.teal }}>Precios por CP · <span style={{ color: BRAND.white }}>{cpSel}</span></div>
              <button onClick={() => setCpSel('')} title="cerrar" style={{ background: 'none', border: 'none', color: BRAND.muted, fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            {cadetesCp.length > 1 && (
              <select style={{ ...inp, width: '100%', marginBottom: 12 }} value={cpSel} onChange={e => setCpSel(e.target.value)}>
                {cadetesCp.map(c => <option key={c.id} value={c.nombre_lightdata}>{c.nombre_lightdata}</option>)}
              </select>
            )}
            {cpRows.length > 0 ? (
              <>
                <div style={{ fontSize: 11.5, color: BRAND.muted, marginBottom: 8 }}>CPs a los que entregó en la semana seleccionada — poné el precio de cada uno (Enter o salí del campo para guardar).{cpSinPrecio > 0 && <span style={{ color: BRAND.amber, fontWeight: 700 }}> · {cpSinPrecio} sin precio</span>}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 12 }}>
                  <thead><tr style={{ color: BRAND.muted, textAlign: 'left' }}><th style={{ padding: '4px 6px' }}>CP</th><th style={{ padding: '4px 6px' }}>Zona</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Entregas</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Precio</th><th></th></tr></thead>
                  <tbody>
                    {cpRows.map(({ cp, cantidad, zona, precio }) => {
                      const val = cpDraft[cp] !== undefined ? cpDraft[cp] : (precio != null ? String(precio) : '');
                      const sinPrecio = precio == null && cantidad > 0;
                      return (
                        <tr key={cp} style={{ borderTop: `1px solid ${BRAND.border}`, background: sinPrecio ? 'rgba(255,176,32,0.06)' : 'transparent' }}>
                          <td style={{ padding: '5px 6px' }}>{cp}</td>
                          <td style={{ padding: '5px 6px', color: BRAND.muted, fontSize: 11.5 }}>{zona || '—'}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right', color: BRAND.muted }}>{cantidad || '—'}</td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                            <input className="no-spin" type="number" placeholder="—" value={val}
                              onChange={e => setCpDraft(d => ({ ...d, [cp]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                              onBlur={() => {
                                const raw = cpDraft[cp]; if (raw === undefined) return;
                                const str = String(raw).trim();
                                if (str === '') { if (precio != null) borrarCpRow(cp); return; }
                                const n = Number(str); if (Number.isNaN(n) || n === Number(precio)) return;
                                guardarCpRow(cp, n);
                              }}
                              style={{ ...inp, width: 88, textAlign: 'right', borderColor: sinPrecio ? BRAND.amber : BRAND.border }} />
                          </td>
                          <td style={{ padding: '5px 6px', textAlign: 'right' }}>
                            {precio != null && <button title="quitar precio de este CP" disabled={busy} onClick={() => borrarCpRow(cp)} style={{ background: 'none', border: 'none', color: BRAND.muted, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <div style={{ fontSize: 12, color: BRAND.muted, padding: '6px 0 14px' }}>Este cadete no tiene entregas en la semana seleccionada. Podés agregar un CP a mano abajo.</div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: `1px solid ${BRAND.border}`, paddingTop: 12 }}>
              <input className="no-spin" style={{ ...inp, flex: 1 }} placeholder="CP" value={nuevoCp.cp} onChange={e => setNuevoCp(s => ({ ...s, cp: e.target.value }))} />
              <input className="no-spin" style={{ ...inp, width: 120 }} type="number" placeholder="Precio" value={nuevoCp.precio} onChange={e => setNuevoCp(s => ({ ...s, precio: e.target.value }))} />
              <button style={btn} disabled={busy || !nuevoCp.cp || !nuevoCp.precio} onClick={() => doAction(async () => {
                await sb('cadete_precio_cp', { method: 'POST', body: JSON.stringify([{ nombre_lightdata: cpSel, cp: nuevoCp.cp.trim(), precio: Number(nuevoCp.precio) }]) });
                setNuevoCp({ cp: '', precio: '' });
              })}>+ Agregar</button>
            </div>
          </div>
        </div>
      )}

      {/* Reglas de alias */}
      <div style={{ background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: 14 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: BRAND.teal }}>Reglas de alias (merge / aparte / ignorar)</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 10 }}>
          <thead><tr style={{ color: BRAND.muted, textAlign: 'left' }}>
            <th style={{ padding: '4px 6px' }}>Nombre LightData</th><th style={{ padding: '4px 6px' }}>Regla</th><th style={{ padding: '4px 6px' }}>Paga como</th><th style={{ padding: '4px 6px' }}>Detalle</th><th></th>
          </tr></thead>
          <tbody>
            {alias.map(a => (
              <tr key={a.nombre_lightdata} style={{ borderTop: `1px solid ${BRAND.border}` }}>
                <td style={{ padding: '5px 6px' }}>{a.nombre_lightdata || <i style={{ color: BRAND.muted }}>(vacío)</i>}</td>
                <td style={{ padding: '5px 6px' }}>{a.regla}</td>
                <td style={{ padding: '5px 6px' }}>{a.paga_como || '—'}</td>
                <td style={{ padding: '5px 6px', color: BRAND.muted }}>{a.detalle || ''}</td>
                <td style={{ padding: '5px 6px' }}>
                  <button style={{ ...btn, borderColor: BRAND.red, color: BRAND.red, background: 'rgba(226,75,74,0.1)' }} disabled={busy} onClick={() => doAction(async () => {
                    await sb(`pagos_cadete_alias?nombre_lightdata=eq.${encodeURIComponent(a.nombre_lightdata)}`, { method: 'DELETE' });
                  })}>Borrar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={inp} placeholder="Nombre LightData" value={nuevoAlias.nombre_lightdata} onChange={e => setNuevoAlias(s => ({ ...s, nombre_lightdata: e.target.value }))} />
          <select style={inp} value={nuevoAlias.regla} onChange={e => setNuevoAlias(s => ({ ...s, regla: e.target.value }))}>
            <option value="merge">merge</option>
            <option value="aparte">aparte</option>
            <option value="ignorar">ignorar</option>
          </select>
          {nuevoAlias.regla === 'merge' && (
            <input style={inp} placeholder="Paga como (nombre_lightdata destino)" value={nuevoAlias.paga_como} onChange={e => setNuevoAlias(s => ({ ...s, paga_como: e.target.value }))} />
          )}
          <input style={inp} placeholder="Detalle / motivo" value={nuevoAlias.detalle} onChange={e => setNuevoAlias(s => ({ ...s, detalle: e.target.value }))} />
          <button style={btn} disabled={busy || !nuevoAlias.nombre_lightdata.trim()} onClick={() => doAction(async () => {
            await sb('pagos_cadete_alias', {
              method: 'POST',
              body: JSON.stringify([{
                nombre_lightdata: nuevoAlias.nombre_lightdata.trim(),
                regla: nuevoAlias.regla,
                paga_como: nuevoAlias.regla === 'merge' ? nuevoAlias.paga_como.trim() : null,
                detalle: nuevoAlias.detalle.trim() || null,
              }]),
            });
            setNuevoAlias({ nombre_lightdata: '', regla: 'merge', paga_como: '', detalle: '' });
          })}>+ Agregar regla</button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── input de cantidad (Tarea 1) ─────────────────────────
// Editable sin spinners: se tipea directo, Enter/blur confirma, inválido/negativo vuelve
// al valor actual. El ↺ restaura al valor original de LightData (borra el override).
function CantidadInput({ value, original, editado, onCommit, onRestore }) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(String(value)); }, [value, focused]);
  const inpSt = { padding: '4px 8px', width: 80, fontSize: 13, textAlign: 'right', border: `1px solid ${BRAND.border}`, borderRadius: 8, background: BRAND.faint, color: BRAND.white, outline: 'none', MozAppearance: 'textfield' };
  const commit = () => {
    const t = text.trim();
    const n = Number(t);
    if (t === '' || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) { setText(String(value)); return; }
    onCommit(n);
  };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        type="text" inputMode="numeric"
        value={text}
        onFocus={e => { setFocused(true); e.target.select(); }}
        onBlur={() => { setFocused(false); commit(); }}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
        style={inpSt}
      />
      {editado && (
        <button title={`volver a ${original}`} onClick={onRestore}
          style={{ background: 'none', border: 'none', color: BRAND.amber, cursor: 'pointer', fontSize: 15, padding: 0, lineHeight: 1 }}>↺</button>
      )}
    </div>
  );
}

// ───────────────────────── tarjeta del panel "A revisar" (Tarea 4) ─────────────────────────
function TarjetaRevisar({ icon, titulo, count, color, right, onToggle, expanded, children }) {
  const collapsible = typeof onToggle === 'function';
  const showBody = !collapsible || expanded;
  return (
    <div style={{ background: BRAND.faint, border: `1px solid ${BRAND.border}`, borderLeft: `3px solid ${color}`, borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
      <div onClick={collapsible ? onToggle : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: collapsible ? 'pointer' : 'default', marginBottom: showBody && children ? 8 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: BRAND.white }}>{icon} {titulo}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, background: 'rgba(255,255,255,0.06)', borderRadius: 20, padding: '1px 8px' }}>{count}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{right}{collapsible && <span style={{ fontSize: 11, color: BRAND.muted }}>{expanded ? '▲' : '▾'}</span>}</span>
      </div>
      {showBody && children}
    </div>
  );
}

// fila de "dar de alta" con formulario inline (precio / fletero / factura).
// Si recibe onIgnorar muestra el botón "Ocultar"; note pinta una aclaración arriba.
function FilaDarAlta({ item, onAlta, onIgnorar, busy, note }) {
  const [open, setOpen] = useState(false);
  const [precio, setPrecio] = useState('');
  const [fletero, setFletero] = useState(false);
  const [factura, setFactura] = useState(false);
  const resumen = [item.entregas ? `${item.entregas} entregas` : null, item.colectas ? `${item.colectas} colectas` : null].filter(Boolean).join(' · ') || '—';
  const inp = { padding: '4px 8px', fontSize: 12, border: `1px solid ${BRAND.border}`, borderRadius: 6, background: BRAND.faint, color: BRAND.white, outline: 'none' };
  const btn = (bg, col, bd) => ({ padding: '3px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8, cursor: busy ? 'default' : 'pointer', border: `1px solid ${bd}`, background: bg, color: col });
  const lbl = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: BRAND.muted, cursor: 'pointer' };
  const puedeConfirmar = !busy && (fletero || precio !== '');
  return (
    <div style={{ padding: '6px 0', borderTop: `1px solid ${BRAND.border}` }}>
      {note && <div style={{ fontSize: 11.5, color: BRAND.muted, marginBottom: 4 }}>{note}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, flexWrap: 'wrap' }}>
        <span style={{ flex: 1, fontWeight: 600, minWidth: 120 }}>{item.nombre}</span>
        <span style={{ color: BRAND.muted }}>{resumen}</span>
        <button onClick={() => setOpen(o => !o)} disabled={busy} style={btn('rgba(46,207,170,0.1)', BRAND.teal, BRAND.teal)}>Dar de alta</button>
        {onIgnorar && <button onClick={() => onIgnorar(item.nombre)} disabled={busy} title="Basura o ya pagado aparte: deja de mostrarlo. Si vuelve a aparecer, te aviso." style={btn(BRAND.faint, BRAND.muted, BRAND.border)}>Ocultar</button>}
      </div>
      {open && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 7, flexWrap: 'wrap' }}>
          <label style={lbl}><input type="checkbox" checked={fletero} onChange={e => setFletero(e.target.checked)} /> Fletero (solo colectas)</label>
          {!fletero && <input type="number" placeholder="Precio x entrega" value={precio} onChange={e => setPrecio(e.target.value)} style={{ ...inp, width: 130 }} />}
          <label style={lbl}><input type="checkbox" checked={factura} onChange={e => setFactura(e.target.checked)} /> Factura (transferencia)</label>
          <button disabled={!puedeConfirmar} onClick={() => onAlta(item.nombre, { precio: fletero ? null : precio, fletero, factura })} style={{ ...btn(BRAND.teal, '#04121a', BRAND.teal), opacity: puedeConfirmar ? 1 : 0.5 }}>Confirmar alta</button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── componente principal ─────────────────────────

function PagosInner({ session }) {
  const xlsxReady = useXLSX();
  const isAdmin = session && session.email === ADMIN_EMAIL;

  const [vista, setVista] = useState('tabla'); // 'tabla' | 'config' | 'pagador'
  const [fecha, setFecha] = useState(todayStr);
  const [semanaLunes, setSemanaLunes] = useState(null); // se resuelve al cargar

  const [tarifas, setTarifas] = useState([]);
  const [alias, setAlias] = useState([]);
  const [cpOverrides, setCpOverrides] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [entregados, setEntregados] = useState([]);
  const [colectas, setColectas] = useState([]);
  const [ajustes, setAjustes] = useState([]);
  const [cierres, setCierres] = useState([]);

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingSemana, setLoadingSemana] = useState(true);
  const [error, setError] = useState('');

  const [overrides, setOverrides] = useState({}); // key -> cantidad editada
  const [filtroMetodo, setFiltroMetodo] = useState('todos'); // todos | transferencia | efectivo
  const [expandido, setExpandido] = useState(null); // key de la fila con detalle abierto
  const [ajusteForm, setAjusteForm] = useState({ concepto: '', monto: '' });
  const [busyAccion, setBusyAccion] = useState(false);
  const [menuEdiciones, setMenuEdiciones] = useState(false); // Tarea 2: menú del chip de ediciones
  const [hoverKey, setHoverKey] = useState(null); // Tarea 3: fila bajo el mouse
  const [copiadoKey, setCopiadoKey] = useState(null); // fila cuyo mensaje se acaba de copiar

  // mensaje para mandarle al cadete por WhatsApp y chequear diferencias
  function copiarMensaje(f) {
    const nombrePila = (f.nombre || '').trim().split(/\s+/)[0];
    let msg;
    if (f.esFletero) {
      msg = `Buen día ${nombrePila}, tengo ${f.colectasCant} colecta${f.colectasCant === 1 ? '' : 's'} por ${money(f.colecta)}.`;
    } else {
      msg = `Buen día ${nombrePila}, tengo ${f.cantidad} envíos entregados` + (f.colecta ? ` y ${money(f.colecta)} de colecta` : '') + `.`;
    }
    navigator.clipboard.writeText(msg).then(() => {
      setCopiadoKey(f.key);
      setTimeout(() => setCopiadoKey(k => (k === f.key ? null : k)), 1500);
    });
  }
  const [revExpand, setRevExpand] = useState({}); // Tarea 4: tarjetas expandibles de 'A revisar'

  // config global (no depende de semana) — se busca al montar
  const refreshConfig = useCallback(async () => {
    setLoadingConfig(true); setError('');
    try {
      const [t, a, cp, z] = await Promise.all([
        sbAll('cadetes_tarifas?select=*&order=nombre_lightdata.asc'),
        sbAll('pagos_cadete_alias?select=*'),
        sbAll('cadete_precio_cp?select=*'),
        sbAll('localidad_zonas?select=localidad,zona'),
      ]);
      setTarifas(t || []); setAlias(a || []); setCpOverrides(cp || []); setZonas(z || []);
    } catch (e) { setError(e.message); }
    finally { setLoadingConfig(false); }
  }, []);

  useEffect(() => { refreshConfig(); }, [refreshConfig]);

  // resolver semana por defecto: la última que tenga datos en pagos_entregados
  useEffect(() => {
    sb('pagos_entregados?select=semana_lunes&order=semana_lunes.desc&limit=1')
      .then(rows => { if (rows && rows[0]) { setSemanaLunes(rows[0].semana_lunes); setFecha(rows[0].semana_lunes); } else { setSemanaLunes(mondayOf(todayStr())); } })
      .catch(() => setSemanaLunes(mondayOf(todayStr())));
  }, []);

  const refreshSemana = useCallback(async (lunes) => {
    if (!lunes) return;
    setLoadingSemana(true); setError(''); setOverrides(loadOverrides(lunes));
    try {
      const sabado = addDays(lunes, 5);
      const [ent, col, aj, ci] = await Promise.all([
        sbAll(`pagos_entregados?select=cadete,localidad,cp,fecha_estado&semana_lunes=eq.${lunes}`),
        sbAll(`colectas_registros?select=fecha,choferes,monto,estado,confirmado_por,colectas_clientes(monto)&fecha=gte.${lunes}&fecha=lte.${sabado}`),
        sbAll(`pagos_ajustes?select=*&semana_label=eq.${lunes}`),
        sbAll(`pagos_cierres?select=*&semana_label=eq.${lunes}`),
      ]);
      setEntregados(ent || []); setColectas(col || []); setAjustes(aj || []);
      setCierres(ci || []);
    } catch (e) { setError(e.message); }
    finally { setLoadingSemana(false); }
  }, []);

  useEffect(() => { if (semanaLunes) refreshSemana(semanaLunes); }, [semanaLunes, refreshSemana]);

  const calc = useMemo(() => {
    if (loadingConfig || loadingSemana) return { filas: [], aparte: [], ignorados: [], configErrors: [], colectasSinMatch: [], sinCadete: [], colectaResumen: new Map(), cpsPorCadete: new Map(), porDarAlta: [] };
    return calcularPagos({ entregados, tarifas, alias, cpOverrides, zonas, colectas, ajustes });
  }, [entregados, tarifas, alias, cpOverrides, zonas, colectas, ajustes, loadingConfig, loadingSemana]);

  const filasEfectivas = useMemo(() => calc.filas.map(f => filaConOverride(f, overrides[f.key])), [calc.filas, overrides]);

  // orden canónico (Factura primero, luego A-Z) — lo usa la vista y el Excel
  const filasOrdenadas = useMemo(() => {
    return [...filasEfectivas].sort((a, b) => {
      if (a.factura !== b.factura) return a.factura ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }, [filasEfectivas]);

  // la vista filtra por método; el Excel exporta SIEMPRE todas (Tarea 1)
  const filasVisibles = useMemo(() =>
    filasOrdenadas.filter(f => filtroMetodo === 'todos' ? true : filtroMetodo === 'transferencia' ? f.factura : !f.factura),
    [filasOrdenadas, filtroMetodo]);

  // Tarea 2: setter que persiste las ediciones de cantidad de la semana en localStorage
  const setOverridesPersist = useCallback((updater) => {
    setOverrides(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveOverrides(semanaLunes, next);
      return next;
    });
  }, [semanaLunes]);

  const nEdiciones = useMemo(() => filasEfectivas.filter(f => f.editado).length, [filasEfectivas]);

  // Tarea 6: totales de las filas visibles (respeta el filtro de método) para la fila de pie
  const totalesVisibles = useMemo(() => filasVisibles.reduce((a, f) => ({
    monto: a.monto + (f.monto || 0), colecta: a.colecta + (f.colecta || 0),
    ajuste: a.ajuste + (f.ajusteTotal || 0), total: a.total + (f.total || 0),
  }), { monto: 0, colecta: 0, ajuste: 0, total: 0 }), [filasVisibles]);

  const subtotales = useMemo(() => {
    const base = filasEfectivas;
    const total = base.reduce((s, f) => s + (f.total || 0), 0);
    const transferencia = base.filter(f => f.factura).reduce((s, f) => s + (f.total || 0), 0);
    const efectivo = base.filter(f => !f.factura).reduce((s, f) => s + (f.total || 0), 0);
    return { total, transferencia, efectivo };
  }, [filasEfectivas]);

  const cardSt = { background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: '1rem 1.1rem' };
  const inpSt = { padding: '6px 10px', fontSize: 13, border: `1px solid ${BRAND.border}`, borderRadius: 8, background: BRAND.faint, color: BRAND.white, outline: 'none' };
  const btnPill = (active) => ({ padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: `1px solid ${active ? BRAND.teal : BRAND.border}`, background: active ? 'rgba(46,207,170,0.15)' : BRAND.faint, color: active ? BRAND.teal : BRAND.muted });
  const thSt = { padding: '10px 12px', position: 'sticky', top: 0, zIndex: 3, background: BRAND.navyCard }; // Tarea 6: header sticky
  const thNum = { ...thSt, textAlign: 'right' };

  const yaCerrada = cierres.length > 0;
  // La columna Ajuste solo se muestra si alguna fila visible tiene ajuste; el descuento se agrega desde el detalle del cadete
  const hayAjustes = filasVisibles.some(f => f.ajusteTotal);
  const nCols = hayAjustes ? 8 : 7; // columna "Pagado" removida — el pago se marca en la vista "Pagar"

  async function cerrarSemana() {
    if (!window.confirm(`¿Cerrar la semana ${fmtSemanaLabel(semanaLunes)}? Esto congela los montos actuales en pagos_cierres (se puede volver a cerrar y se pisa).`)) return;
    setBusyAccion(true); setError('');
    try {
      // Tarea 3: preservar los pagos ya marcados al re-cerrar (matchear por cadete antes del delete+insert)
      const pagadoPrev = new Set(cierres.filter(c => c.pagado).map(c => norm(c.cadete)));
      await sb(`pagos_cierres?semana_label=eq.${semanaLunes}`, { method: 'DELETE' });
      const rows = filasEfectivas.map(f => ({
        semana_label: semanaLunes, cadete: f.nombre,
        detalle: { cantidad: f.cantidad, monto: f.monto, colecta: f.colecta, ajuste: f.ajusteTotal, modo: f.modo, falta_precio: f.faltaPrecio },
        total: f.total, metodo: f.factura ? 'transferencia' : 'efectivo', pagado: pagadoPrev.has(norm(f.nombre)),
      }));
      if (rows.length) await sb('pagos_cierres', { method: 'POST', body: JSON.stringify(rows) });
      // Tarea 2: al cerrar, las ediciones quedan congeladas en el cierre -> limpiar el borrador
      saveOverrides(semanaLunes, {}); setOverrides({});
      await refreshSemana(semanaLunes);
    } catch (e) { setError(e.message); }
    finally { setBusyAccion(false); }
  }

  // dar de alta un chofer con su tarifa completa desde el panel "A revisar".
  // Si el nombre estaba "oculto" (alias ignorar), lo saca primero para que quede activo.
  async function altaCadete(nombreLD, { precio, fletero, factura } = {}) {
    setBusyAccion(true); setError('');
    try {
      const enc = encodeURIComponent(nombreLD);
      await sb(`pagos_cadete_alias?nombre_lightdata=eq.${enc}&regla=eq.ignorar`, { method: 'DELETE' });
      await sb('cadetes_tarifas', { method: 'POST', body: JSON.stringify([{
        nombre: nombreLD, nombre_lightdata: nombreLD,
        activo: true, factura: !!factura, fletero: !!fletero, modo: 'fijo',
        precio_fijo: (fletero || precio === '' || precio == null) ? null : Number(precio),
      }]) });
      await refreshConfig();
    } catch (e) { setError(e.message); }
    finally { setBusyAccion(false); }
  }

  // "Ocultar": marca un nombre como que no hay que mostrarlo (basura o ya pagado
  // aparte) -> alias 'ignorar'. Deja de sumar y de aparecer, pero si vuelve a
  // tener entregas reaparece en la caja "Ocultos que siguen apareciendo".
  async function ignorarChofer(nombreLD) {
    setBusyAccion(true); setError('');
    try {
      await sb('pagos_cadete_alias', { method: 'POST', body: JSON.stringify([{ nombre_lightdata: nombreLD, regla: 'ignorar' }]) });
      await refreshConfig();
    } catch (e) { setError(e.message); }
    finally { setBusyAccion(false); }
  }

  async function agregarAjuste(nombreLD) {
    if (!ajusteForm.concepto.trim() || !ajusteForm.monto) return;
    setBusyAccion(true); setError('');
    try {
      await sb('pagos_ajustes', { method: 'POST', body: JSON.stringify([{ semana_label: semanaLunes, cadete: nombreLD, concepto: ajusteForm.concepto.trim(), monto: Number(ajusteForm.monto) }]) });
      setAjusteForm({ concepto: '', monto: '' });
      await refreshSemana(semanaLunes);
    } catch (e) { setError(e.message); }
    finally { setBusyAccion(false); }
  }

  async function borrarAjuste(id) {
    setBusyAccion(true); setError('');
    try { await sb(`pagos_ajustes?id=eq.${id}`, { method: 'DELETE' }); await refreshSemana(semanaLunes); }
    catch (e) { setError(e.message); }
    finally { setBusyAccion(false); }
  }

  const cargando = loadingConfig || loadingSemana;

  return (
    <div>
      <style>{`@keyframes pagos-spin{to{transform:rotate(360deg)}} .no-spin::-webkit-inner-spin-button,.no-spin::-webkit-outer-spin-button{-webkit-appearance:none;margin:0} .no-spin{-moz-appearance:textfield}`}</style>
      {/* Header interno + navegación tabla/config */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setVista('tabla')} style={btnPill(vista === 'tabla')}>Semana</button>
          <button onClick={() => setVista('colectas')} title="Resumen de lo que se paga por colectas (la gestión del día está en la sección Colectas del menú)" style={btnPill(vista === 'colectas')}>Resumen colectas</button>
          {isAdmin && <button onClick={() => setVista('config')} style={btnPill(vista === 'config')}>Config de cadetes</button>}
          {isAdmin && <button onClick={() => setVista('pagador')} style={btnPill(vista === 'pagador')}>Pagar</button>}
        </div>
        <div style={{ fontSize: 12, color: BRAND.muted }}>
          {session?.nombre} {isAdmin && <span style={{ color: BRAND.teal }}>(admin)</span>} · <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { logout(); window.location.reload(); }}>Salir</span>
        </div>
      </div>

      {error && <div style={{ background: 'rgba(226,75,74,0.15)', color: BRAND.red, border: `1px solid ${BRAND.red}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {vista === 'config' && isAdmin && (
        <ConfigCadetes tarifas={tarifas} alias={alias} cpOverrides={cpOverrides} cpsPorCadete={calc.cpsPorCadete} onRefresh={refreshConfig} />
      )}

      {vista === 'pagador' && isAdmin && (
        <PagosPagador tarifas={tarifas} />
      )}

      {vista === 'colectas' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: BRAND.muted }}>Semana:</span>
            <input type="date" value={fecha} onChange={e => { const v = e.target.value; setFecha(v); setSemanaLunes(mondayOf(v)); }} style={inpSt} />
          </div>
          {cargando && <div style={{ color: BRAND.muted, padding: '2rem', textAlign: 'center' }}>Calculando...</div>}
          {!cargando && (() => {
            const filasCol = [...calc.colectaResumen.values()].sort((a, b) => b.monto - a.monto);
            const totCant = filasCol.reduce((t, r) => t + r.cantidad, 0);
            const totMonto = filasCol.reduce((t, r) => t + r.monto, 0);
            return (
              <>
                <div style={{ fontSize: 11.5, color: BRAND.muted, marginBottom: 10 }}>Solo lectura — la colecta se gestiona en la pestaña Colectas. Estos montos son los que entran a la columna "Colecta" de la liquidación.</div>
                {filasCol.length === 0 && <div style={{ color: BRAND.muted, padding: '2.5rem', textAlign: 'center' }}>Sin colectas confirmadas para esta semana.</div>}
                {filasCol.length > 0 && (
                  <div style={{ ...cardSt, padding: 0, overflow: 'auto', marginBottom: 16 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520, fontSize: 13 }}>
                      <thead>
                        <tr style={{ color: BRAND.muted, textAlign: 'left', borderBottom: `1px solid ${BRAND.border}` }}>
                          <th style={thSt}>Chofer</th>
                          <th style={thSt}>Se imputa a</th>
                          <th style={thNum}>Colectas</th>
                          <th style={thNum}>Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filasCol.map(r => (
                          <tr key={r.chofer} style={{ borderBottom: `1px solid ${BRAND.border}` }}>
                            <td style={{ padding: '9px 12px', fontWeight: 600 }}>{r.chofer}</td>
                            <td style={{ padding: '9px 12px', color: BRAND.muted }}>{r.cadete}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'right' }}>{r.cantidad}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 700, color: BRAND.teal }}>{money(r.monto)}</td>
                          </tr>
                        ))}
                        <tr>
                          <td style={{ padding: '10px 12px', fontWeight: 700 }}>TOTAL</td>
                          <td />
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700 }}>{totCant}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: BRAND.teal }}>{money(totMonto)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
                {calc.colectasSinMatch.length > 0 && (
                  <div style={{ fontSize: 12, color: BRAND.amber }}>⚠️ {calc.colectasSinMatch.length} colecta(s) con chofer sin resolver — no entran acá ni a la liquidación (ver "A revisar" en Semana).</div>
                )}
              </>
            );
          })()}
        </>
      )}

      {vista === 'tabla' && (
        <>
          {/* Selector de semana */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: BRAND.muted }}>Semana:</span>
            <input type="date" value={fecha} onChange={e => { const v = e.target.value; setFecha(v); setSemanaLunes(mondayOf(v)); }} style={inpSt} />
            <span style={{ fontSize: 13, color: BRAND.teal, fontWeight: 600 }}>{fmtSemanaLabel(semanaLunes)}</span>
            {yaCerrada && <span style={{ fontSize: 11, fontWeight: 700, color: BRAND.amber, background: 'rgba(255,176,32,0.12)', border: '1px solid rgba(255,176,32,0.3)', borderRadius: 20, padding: '3px 10px' }}>Semana cerrada</span>}
            {nEdiciones > 0 && (
              <span style={{ position: 'relative' }}>
                <button onClick={() => setMenuEdiciones(v => !v)} title="cantidades editadas a mano; se guardan en este navegador hasta que cierres la semana"
                  style={{ fontSize: 11, fontWeight: 700, color: BRAND.amber, background: 'rgba(255,176,32,0.12)', border: '1px solid rgba(255,176,32,0.3)', borderRadius: 20, padding: '3px 10px', cursor: 'pointer' }}>
                  &#9999;&#65039; {nEdiciones} {nEdiciones === 1 ? 'edición' : 'ediciones'} sin cerrar &#9662;
                </button>
                {menuEdiciones && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30, background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: 10, minWidth: 270, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: BRAND.white }}>Ediciones sin cerrar</span>
                      <button onClick={() => { setOverridesPersist({}); setMenuEdiciones(false); }} style={{ fontSize: 11, color: BRAND.amber, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>restaurar todo</button>
                    </div>
                    {filasEfectivas.filter(f => f.editado).map(f => (
                      <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderTop: `1px solid ${BRAND.border}` }}>
                        <span style={{ flex: 1, fontWeight: 600 }}>{f.nombre}</span>
                        <span style={{ color: BRAND.muted }}>{f.cantidadOriginal} &#8594; <span style={{ color: BRAND.amber, fontWeight: 700 }}>{f.cantidad}</span></span>
                        <button title={`volver a ${f.cantidadOriginal}`} onClick={() => setOverridesPersist(o => { const nn = { ...o }; delete nn[f.key]; return nn; })} style={{ background: 'none', border: 'none', color: BRAND.amber, cursor: 'pointer', fontSize: 14, padding: 0 }}>↺</button>
                      </div>
                    ))}
                  </div>
                )}
              </span>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {xlsxReady && (
                <button onClick={() => exportarExcel({ filas: filasOrdenadas, aparte: calc.aparte, porDarAlta: calc.porDarAlta, semanaLunes, subtotales })}
                  style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${BRAND.teal}`, borderRadius: 8, cursor: 'pointer', background: 'rgba(46,207,170,0.1)', color: BRAND.teal, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ti ti-file-spreadsheet" style={{ fontSize: 15 }} /> Exportar Excel
                </button>
              )}
              <button disabled={busyAccion || cargando} onClick={cerrarSemana}
                title={yaCerrada ? 'Vuelve a congelar los montos actuales, pisando el cierre anterior de esta semana' : 'Congela los montos actuales para pagarlos (se puede volver a cerrar si algo cambia)'}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, border: '1px solid rgba(255,176,32,0.4)', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,176,32,0.1)', color: BRAND.amber }}>
                {yaCerrada ? 'Re-cerrar semana' : 'Cerrar semana'}
              </button>
            </div>
          </div>

          {cargando && (
            <div style={{ padding: '3rem', textAlign: 'center' }}>
              <div style={{ width: 32, height: 32, margin: '0 auto 12px', border: `3px solid ${BRAND.faint}`, borderTopColor: BRAND.teal, borderRadius: '50%', animation: 'pagos-spin 0.8s linear infinite' }} />
              <div style={{ color: BRAND.muted, fontSize: 13 }}>Calculando liquidación…</div>
            </div>
          )}

          {!cargando && (
            <>
              {/* Filtro método (fila propia) */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Método</span>
                {[['todos', 'Todos'], ['transferencia', 'Transferencia'], ['efectivo', 'Efectivo']].map(([k, l]) => (
                  <button key={k} onClick={() => setFiltroMetodo(k)} style={btnPill(filtroMetodo === k)}>{l}</button>
                ))}
              </div>
              {/* Subtotales como tarjetas de métrica */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
                {[['TOTAL', subtotales.total, BRAND.white], ['Transferencia', subtotales.transferencia, BRAND.teal], ['Efectivo', subtotales.efectivo, BRAND.amber]].map(([lbl, val, color]) => (
                  <div key={lbl} style={{ ...cardSt, padding: '12px 14px', textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: BRAND.muted, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{lbl}</div>
                    <div style={{ fontSize: 19, fontWeight: 800, color }}>{money(val)}</div>
                  </div>
                ))}
              </div>

              {/* Tabla principal */}
              <div style={{ ...cardSt, padding: 0, overflow: 'auto', maxHeight: '72vh', marginBottom: 20 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: BRAND.muted, textAlign: 'left', borderBottom: `1px solid ${BRAND.border}` }}>
                      <th style={thSt}>Cadete</th>
                      <th style={thSt}>Cant.</th>
                      <th style={thNum}>Precio</th>
                      <th style={thNum}>Monto</th>
                      <th style={thNum}>Colecta</th>
                      {hayAjustes && <th style={thNum}>Ajuste</th>}
                      <th style={thNum}>TOTAL</th>
                      <th style={thSt}>Método</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasVisibles.map((f, i) => {
                      const precioUnit = f.cantidad ? (f.monto || 0) / f.cantidad : (f.precioFijo || 0);
                      const open = expandido === f.key;
                      return (
                        <React.Fragment key={f.key}>
                          <tr
                            onMouseEnter={() => setHoverKey(f.key)}
                            onMouseLeave={() => setHoverKey(h => (h === f.key ? null : h))}
                            style={{ borderTop: `1px solid ${BRAND.border}`, background: open ? 'rgba(46,207,170,0.05)' : hoverKey === f.key ? 'rgba(255,255,255,0.04)' : f.faltaPrecio ? 'rgba(226,75,74,0.06)' : (i % 2 ? 'rgba(255,255,255,0.022)' : 'transparent') }}>
                            <td onClick={() => setExpandido(open ? null : f.key)} title="ver / ocultar detalle" style={{ padding: '8px 12px', fontWeight: 600, cursor: 'pointer', borderLeft: `3px solid ${open ? BRAND.teal : 'transparent'}` }}>
                              <span style={{ borderBottom: `1px dotted ${BRAND.muted}` }}>{f.nombre}</span>
                              {f.esFletero && <span title="fletero: solo colectas" style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8, color: BRAND.muted, border: `1px solid ${BRAND.border}` }}>fletero</span>}
                              {!f.activo && <span style={{ marginLeft: 6, fontSize: 10, color: BRAND.muted }}>(inactivo)</span>}
                              {f.editado && <span title="cantidad editada manualmente" style={{ marginLeft: 6, fontSize: 10, color: BRAND.amber }}>✎</span>}
                              <span style={{ marginLeft: 6, fontSize: 10, color: BRAND.muted }}>{open ? '▲' : '▾'}</span>
                            </td>
                            <td style={{ padding: '8px 12px', background: f.editado ? 'rgba(255,176,32,0.12)' : 'transparent' }}>
                              {f.esFletero ? (
                                <span title="cantidad de colectas de la semana" style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>{f.colectasCant} col.</span>
                              ) : (
                              <CantidadInput
                                value={f.cantidad}
                                original={f.cantidadOriginal}
                                editado={f.editado}
                                onCommit={n => setOverridesPersist(o => { const nn = { ...o }; if (n === f.cantidadOriginal) delete nn[f.key]; else nn[f.key] = n; return nn; })}
                                onRestore={() => setOverridesPersist(o => { const nn = { ...o }; delete nn[f.key]; return nn; })}
                              />
                              )}
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>{f.esFletero ? '—' : <>{money(precioUnit)}{f.modo === 'cp' && <span style={{ fontSize: 10, color: BRAND.muted }}> (CP)</span>}</>}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>{f.esFletero ? '—' : f.faltaPrecio ? <span style={{ color: BRAND.red, fontWeight: 700 }}>FALTA PRECIO</span> : money(f.monto)}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', color: 'rgba(255,255,255,0.6)' }}>{money(f.colecta)}</td>
                            {hayAjustes && (
                              <td style={{ padding: '8px 12px', textAlign: 'right', cursor: 'pointer' }} onClick={() => setExpandido(open ? null : f.key)}>
                                {f.ajusteTotal ? <span style={{ color: BRAND.red, textDecoration: 'underline dotted' }}>{money(-f.ajusteTotal)}</span> : null}
                              </td>
                            )}
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 800, color: BRAND.teal }}>{money(f.total)}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: f.factura ? BRAND.teal : BRAND.amber, background: f.factura ? 'rgba(46,207,170,0.12)' : 'rgba(255,176,32,0.12)' }}>
                                {f.factura ? 'Transferencia' : 'Efectivo'}
                              </span>
                              <button onClick={e => { e.stopPropagation(); copiarMensaje(f); }}
                                title={'copiar mensaje para el cadete: "Hola ..., esta semana me figuran X envíos y $Y de colecta"'}
                                style={{ marginLeft: 6, fontSize: 14, padding: '4px 8px', borderRadius: 8, background: 'none', border: 'none', cursor: 'pointer', color: copiadoKey === f.key ? BRAND.teal : BRAND.muted }}>
                                {copiadoKey === f.key ? '✓ copiado' : '💬'}
                              </button>
                              {f.modo === 'cp' && (
                                <button onClick={() => setExpandido(open ? null : f.key)} style={{ marginLeft: 8, fontSize: 11, color: BRAND.muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>detalle</button>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={nCols} style={{ padding: '10px 16px', background: 'rgba(46,207,170,0.05)', borderLeft: `3px solid ${BRAND.teal}` }}>
                                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11.5, color: BRAND.muted, marginBottom: 10 }}>
                                  {f.esFletero ? (
                                    <>
                                      <span>Fletero — cobra el monto de cada colecta</span>
                                      <span>Colectas: <b style={{ color: BRAND.white }}>{f.colectasCant}</b> por <b style={{ color: BRAND.white }}>{money(f.colecta)}</b></span>
                                      {f.entregasLD > 0 && <span style={{ color: BRAND.amber }}>{f.entregasLD} entregas en LightData — no se pagan</span>}
                                    </>
                                  ) : (
                                    <>
                                      <span>Precio unit.: <b style={{ color: BRAND.white }}>{money(precioUnit)}</b>{f.modo === 'cp' ? ' (por CP)' : ''}</span>
                                      <span>Entregas LightData: <b style={{ color: BRAND.white }}>{f.cantidadOriginal}</b></span>
                                    </>
                                  )}
                                  <span>Método: <b style={{ color: f.factura ? BRAND.teal : BRAND.amber }}>{f.factura ? 'Transferencia' : 'Efectivo'}</b></span>
                                  {!f.activo && <span style={{ color: BRAND.amber }}>inactivo</span>}
                                </div>
                                {f.modo === 'cp' && f.cpBreakdown && (
                                  <div style={{ marginBottom: 10 }}>
                                    <div style={{ fontSize: 11, color: BRAND.muted, marginBottom: 4 }}>Desglose por CP</div>
                                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                      {f.cpBreakdown.map(b => (
                                        <div key={b.cp} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: BRAND.faint, border: `1px solid ${b.precio == null ? BRAND.red : BRAND.border}` }}>
                                          CP {b.cp}: {b.cantidad} × {b.precio != null ? money(b.precio) : 'SIN PRECIO'}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {f.fallbackInfo && <div style={{ fontSize: 11.5, color: BRAND.amber, marginBottom: 8 }}>⚠ {f.fallbackInfo}</div>}
                                <div style={{ fontSize: 11, color: BRAND.muted, marginBottom: 4 }}>Ajustes de la semana</div>
                                {f.ajusteRows.map(a => (
                                  <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 4 }}>
                                    <span style={{ flex: 1 }}>{a.concepto}</span>
                                    <span>{money(a.monto)}</span>
                                    <button onClick={() => borrarAjuste(a.id)} disabled={busyAccion} style={{ fontSize: 11, color: BRAND.red, background: 'none', border: 'none', cursor: 'pointer' }}>borrar</button>
                                  </div>
                                ))}
                                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                                  <input placeholder="Concepto (ej. doble bulto)" value={ajusteForm.concepto} onChange={e => setAjusteForm(s => ({ ...s, concepto: e.target.value }))} style={{ ...inpSt, flex: 1, padding: '4px 8px' }} />
                                  <input placeholder="Monto a descontar" type="number" value={ajusteForm.monto} onChange={e => setAjusteForm(s => ({ ...s, monto: e.target.value }))} style={{ ...inpSt, width: 130, padding: '4px 8px' }} />
                                  <button onClick={() => agregarAjuste(f.nombre)} disabled={busyAccion} style={{ padding: '4px 12px', fontSize: 11.5, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: `1px solid ${BRAND.teal}`, background: 'rgba(46,207,170,0.1)', color: BRAND.teal }}>+ Ajuste</button>
                                </div>
                                <div style={{ fontSize: 10.5, color: BRAND.muted, marginTop: 6 }}>La colecta se edita en la pestaña Colectas. Acá se muestra solo lectura.</div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                    {filasVisibles.length === 0 && (
                      <tr><td colSpan={nCols} style={{ padding: '2rem', textAlign: 'center', color: BRAND.muted }}>Sin datos para esta semana / filtro.</td></tr>
                    )}
                  </tbody>
                  {filasVisibles.length > 0 && (
                    <tfoot>
                      <tr style={{ borderTop: `2px solid ${BRAND.border}`, fontWeight: 700, background: BRAND.navyCard, position: 'sticky', bottom: 0 }}>
                        <td style={{ padding: '10px 12px', borderLeft: '3px solid transparent' }}>Totales ({filasVisibles.length})</td>
                        <td></td>
                        <td></td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(totalesVisibles.monto)}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{money(totalesVisibles.colecta)}</td>
                        {hayAjustes && <td style={{ padding: '10px 12px', textAlign: 'right', color: BRAND.red }}>{totalesVisibles.ajuste ? money(-totalesVisibles.ajuste) : '—'}</td>}
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: BRAND.teal }}>{money(totalesVisibles.total)}</td>
                        <td></td>
                        {yaCerrada && <td></td>}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>

              {/* Panel A revisar — reordenado por acción (accionable arriba, info abajo) */}
              {(() => {
                const porDarAlta = calc.porDarAlta || [];
                // "Siguen apareciendo" = ocultados en una semana ANTERIOR que vuelven a
                // tener entregas. Los ocultados en la semana que estás viendo no molestan.
                const ignoradosActivos = (calc.ignorados || [])
                  .filter(ig => !ig.desde || String(ig.desde).slice(0, 10) < semanaLunes)
                  .sort((a, b) => b.cantidad - a.cantidad);
                const UMBRAL_REAP = 15; // reaparición "fuerte": abre la caja sola y avisa
                const reapFuerte = ignoradosActivos.filter(i => i.cantidad >= UMBRAL_REAP);
                const nAccion = porDarAlta.length + calc.configErrors.length;
                const hayInfo = (calc.sinCadete && calc.sinCadete.length) || calc.aparte.length || ignoradosActivos.length;
                const igExpanded = revExpand.ignorados === undefined ? reapFuerte.length > 0 : revExpand.ignorados;
                return (
              <div style={{ ...cardSt, marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: BRAND.amber }}>⚠ A revisar{nAccion > 0 ? ` (${nAccion})` : ''}</div>

                {/* 1 · Choferes por dar de alta (junta entregas y colectas de desconocidos) */}
                {porDarAlta.length > 0 && (
                  <TarjetaRevisar icon="🆕" titulo="Choferes por dar de alta" count={porDarAlta.length} color={BRAND.amber}>
                    <div style={{ fontSize: 11.5, color: BRAND.muted, marginBottom: 2 }}>Aparecieron esta semana pero no están en Config. Dales de alta con su precio (o marcá Fletero si solo hacen colectas). Si no es un chofer o ya lo pagaste aparte, "Ocultar".</div>
                    {porDarAlta.map(item => (
                      <FilaDarAlta key={item.key} item={item} busy={busyAccion}
                        onAlta={(nombre, opts) => altaCadete(nombre, opts)}
                        onIgnorar={(nombre) => ignorarChofer(nombre)} />
                    ))}
                  </TarjetaRevisar>
                )}

                {/* 2 · Errores de config reales (alias que apunta a un nombre inexistente) */}
                {calc.configErrors.length > 0 && (
                  <TarjetaRevisar icon="⛔" titulo="Errores de config" count={calc.configErrors.length} color={BRAND.red}
                    right={isAdmin && <button onClick={() => setVista('config')} style={{ fontSize: 11, color: BRAND.teal, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>ir a Config</button>}>
                    {calc.configErrors.map((c, i) => (
                      <FilaDarAlta key={i} item={{ key: c.pagaComo, nombre: c.pagaComo, entregas: c.cantidad, colectas: 0 }} busy={busyAccion}
                        note={`${c.motivo}${c.cantidad ? ` · ${c.cantidad} entregas afectadas` : ''}`}
                        onAlta={(nombre, opts) => altaCadete(nombre, opts)} />
                    ))}
                  </TarjetaRevisar>
                )}

                {nAccion === 0 && (
                  <div style={{ fontSize: 12.5, color: BRAND.muted, marginBottom: hayInfo ? 12 : 0 }}>✓ Nada por resolver esta semana.</div>
                )}

                {/* ── Información (no accionable): separado del bloque de arriba ── */}
                {hayInfo ? (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${BRAND.border}` }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Información</div>

                    {ignoradosActivos.length > 0 && (
                      <TarjetaRevisar icon="🙈" titulo="Ocultos que siguen apareciendo" count={ignoradosActivos.length}
                        color={reapFuerte.length > 0 ? BRAND.amber : BRAND.muted}
                        right={reapFuerte.length > 0 ? <span style={{ fontSize: 11, color: BRAND.amber }}>⚠ {reapFuerte.length} con actividad fuerte</span> : null}
                        onToggle={() => setRevExpand(r => ({ ...r, ignorados: !igExpanded }))} expanded={igExpanded}>
                        <div style={{ fontSize: 11.5, color: BRAND.muted, marginBottom: 6 }}>Los marcaste como "Ocultar" pero volvieron a tener entregas. Si alguno se volvió fijo (o lo ocultaste sin querer), dalo de alta.</div>
                        {ignoradosActivos.map((ig, i) => (
                          <FilaDarAlta key={i} item={{ key: ig.raw, nombre: ig.raw, entregas: ig.cantidad, colectas: 0 }} busy={busyAccion}
                            onAlta={(nombre, opts) => altaCadete(nombre, opts)} />
                        ))}
                      </TarjetaRevisar>
                    )}

                    {calc.sinCadete && calc.sinCadete.length > 0 && (() => {
                      const fechas = calc.sinCadete.map(e => String(e.fecha_estado || '').slice(0, 10)).filter(Boolean).sort();
                      const rango = fechas.length ? (fechas[0] === fechas[fechas.length - 1] ? fmtDM(fechas[0]) : `${fmtDM(fechas[0])} → ${fmtDM(fechas[fechas.length - 1])}`) : 'sin fecha';
                      const porFecha = {};
                      calc.sinCadete.forEach(e => { const d = String(e.fecha_estado || '').slice(0, 10) || 'sin fecha'; porFecha[d] = (porFecha[d] || 0) + 1; });
                      return (
                        <TarjetaRevisar icon="🕳" titulo="Entregas sin cadete en LightData" count={calc.sinCadete.length} color={BRAND.muted}
                          right={<span style={{ fontSize: 11, color: BRAND.muted }}>{rango}</span>}
                          onToggle={() => setRevExpand(r => ({ ...r, sinCadete: !r.sinCadete }))} expanded={!!revExpand.sinCadete}>
                          <div style={{ fontSize: 11.5, color: BRAND.muted, marginBottom: 6 }}>Envíos entregados que en LightData no tienen cadete asignado. No es algo que des de alta acá: se corrige asignando el cadete en LightData.</div>
                          {Object.entries(porFecha).sort().map(([d, n]) => (
                            <div key={d} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderTop: `1px solid ${BRAND.border}` }}>
                              <span>{fmtDM(d)}</span><span style={{ color: BRAND.muted }}>{n} entrega{n === 1 ? '' : 's'}</span>
                            </div>
                          ))}
                        </TarjetaRevisar>
                      );
                    })()}

                    {calc.aparte.length > 0 && (
                      <TarjetaRevisar icon="💰" titulo="Pagos aparte (fleteros — no suman al total)" count={calc.aparte.length} color={BRAND.muted}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                          <thead><tr style={{ color: BRAND.muted, textAlign: 'left' }}><th style={{ padding: '4px 6px' }}>Cadete</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Cant.</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Monto</th></tr></thead>
                          <tbody>
                            {calc.aparte.map(f => (
                              <tr key={f.key} style={{ borderTop: `1px solid ${BRAND.border}` }}>
                                <td style={{ padding: '5px 6px' }}>{f.nombre}</td>
                                <td style={{ padding: '5px 6px', textAlign: 'right' }}>{f.cantidad}</td>
                                <td style={{ padding: '5px 6px', textAlign: 'right' }}>{f.monto != null ? money(f.monto) : <span style={{ color: BRAND.red }}>FALTA PRECIO</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </TarjetaRevisar>
                    )}
                  </div>
                ) : null}
              </div>
                );
              })()}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SoloAdmin() {
  return (
    <div style={{ maxWidth: 440, margin: '80px auto', textAlign: 'center', color: 'rgba(255,255,255,0.85)' }}>
      <div style={{ fontSize: 42, marginBottom: 12 }}>🔒</div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Sección solo para administradores</div>
      <div style={{ fontSize: 14, marginBottom: 18, color: 'rgba(255,255,255,0.6)' }}>Las liquidaciones son confidenciales. Ingresá con la cuenta de administrador.</div>
      <button onClick={() => { logout(); window.location.reload(); }} style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#fff', cursor: 'pointer' }}>Cambiar de cuenta</button>
    </div>
  );
}

export default function Pagos() {
  const [session, setSession] = useState(() => getSession());
  if (!session) return <LoginPagos onOk={setSession} />;
  if (session.email !== ADMIN_EMAIL) return <SoloAdmin />;
  return <PagosInner session={session} />;
}
