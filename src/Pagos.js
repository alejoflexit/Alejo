// src/Pagos.js — Pestaña Pagos: liquidación semanal de cadetes por entregados.
// Lee pagos_entregados (snapshot semanal) + cadetes_tarifas + pagos_cadete_alias +
// cadete_precio_cp + localidad_zonas + colectas_registros + pagos_ajustes.
// Maker/checker: la app calcula y muestra; Alejo revisa, edita y confirma — nada se paga solo.
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { login, logout, getSession, authedFetch } from './auth';

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
  muted:    "rgba(255,255,255,0.45)",
  faint:    "rgba(255,255,255,0.06)",
  border:   "rgba(255,255,255,0.09)",
};

// ───────────────────────── helpers ─────────────────────────

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
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
  let monto = 0, faltaPrecio = false, fallbackInfo = null, cpBreakdown = null;

  if (tarifa.modo === 'cp') {
    const porCp = new Map();
    rows.forEach(r => {
      const cp = String(r.cp || '').trim() || '(sin CP)';
      porCp.set(cp, (porCp.get(cp) || 0) + 1);
    });
    cpBreakdown = [];
    let faltantes = 0;
    porCp.forEach((n, cp) => {
      let precio = cpPriceMap.get(`${key}|${cp}`);
      if (precio == null) precio = tarifa.precio_fijo != null ? Number(tarifa.precio_fijo) : null;
      if (precio == null) { faltantes += n; }
      else monto += precio * n;
      cpBreakdown.push({ cp, cantidad: n, precio });
    });
    cpBreakdown.sort((a, b) => b.cantidad - a.cantidad);
    if (faltantes > 0) { faltaPrecio = true; fallbackInfo = `${faltantes} entrega(s) sin precio de CP ni precio base`; }
  } else {
    let precio = tarifa.precio_fijo != null ? Number(tarifa.precio_fijo) : null;
    if (precio == null) {
      const fb = precioZonaDominante(rows, tarifa, zonaByLoc);
      precio = fb.precio;
      fallbackInfo = fb.zona
        ? `sin precio fijo — fallback tarifa zona "${fb.zona}"`
        : 'sin precio fijo y sin zona detectada';
    }
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
    modo: tarifa.modo || 'fijo',
    precioFijo: tarifa.precio_fijo != null ? Number(tarifa.precio_fijo) : null,
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
  entregados.forEach(e => {
    const raw = (e.cadete || '').trim();
    if (!raw) return; // sin asignar: no se paga, no entra a "nuevos" (es un hueco de dato, no un cadete)
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
    if (al && al.regla === 'ignorar') { ignorados.push({ raw: g.raw, cantidad: g.rows.length }); continue; }
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
  colectas.forEach(c => {
    const monto = Number(c.monto) || 0;
    (c.choferes || []).forEach(ch => {
      const raw = (ch || '').trim();
      if (!raw || norm(raw) === 'a coordinar') return;
      const key = norm(raw);
      if (tarifaByLD.has(key)) {
        colectaByKey.set(key, (colectaByKey.get(key) || 0) + monto);
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
  const configErrors = [];
  for (const [key, g] of canonGroups) {
    const tarifa = tarifaByLD.get(key);
    if (!tarifa) {
      configErrors.push({ nombre: g.canonName, cantidad: g.rows.length, motivo: 'canónico sin fila en cadetes_tarifas (revisar pagos_cadete_alias.paga_como o dar de alta)' });
      continue;
    }
    filas.push(calcularFila(g.canonName, g.rows, tarifa, ctx));
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

  return { filas, aparte, ignorados, configErrors, colectasSinMatch };
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

function exportarExcel({ filas, aparte, sinResolver, semanaLunes, subtotales }) {
  const label = fmtSemanaLabel(semanaLunes);
  const header = ['Cadete', 'Cantidad', 'Precio', 'Monto', 'Colecta', 'Ajuste', 'TOTAL', 'Método'];
  const rows = filas.map(f => [
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

  if (sinResolver.length) {
    aoa.push([], ['A REVISAR — choferes nuevos sin dar de alta']);
    aoa.push(['Cadete', 'Entregas', 'Primera', 'Última']);
    sinResolver.forEach(s => aoa.push([s.cadete, s.entregas, s.primera, s.ultima]));
  }

  const wb = window.XLSX.utils.book_new();
  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  window.XLSX.utils.book_append_sheet(wb, ws, 'Liquidaciones');
  window.XLSX.writeFile(wb, `pagos_semana_${semanaLunes}.xlsx`);
}

// ───────────────────────── sub-vista: Config de cadetes (solo admin) ─────────────────────────

function ConfigCadetes({ tarifas, alias, cpOverrides, onRefresh }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [filtro, setFiltro] = useState('');
  const [cpSel, setCpSel] = useState('');
  const [nuevoCp, setNuevoCp] = useState({ cp: '', precio: '' });
  const [nuevoAlias, setNuevoAlias] = useState({ nombre_lightdata: '', regla: 'merge', paga_como: '', detalle: '' });
  const [nuevoCadete, setNuevoCadete] = useState({ nombre_lightdata: '', nombre: '', factura: false, precio_fijo: '' });
  const [drafts, setDrafts] = useState({}); // id -> campos editados pendientes

  const inp = { padding: '5px 8px', fontSize: 12.5, border: `1px solid ${BRAND.border}`, borderRadius: 6, background: BRAND.faint, color: BRAND.white, outline: 'none' };
  const btn = { padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: '1px solid rgba(46,207,170,0.35)', background: 'rgba(46,207,170,0.12)', color: BRAND.teal };

  const doAction = useCallback(async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); await onRefresh(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }, [onRefresh]);

  const filtrados = tarifas.filter(t => !filtro || norm(t.nombre_lightdata || t.nombre).includes(norm(filtro)));
  const cadetesCp = tarifas.filter(t => t.modo === 'cp');
  const overridesDeSel = cpOverrides.filter(o => norm(o.nombre_lightdata) === norm(cpSel));

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
          <input style={{ ...inp, width: 100 }} type="number" placeholder="Precio fijo" value={nuevoCadete.precio_fijo} onChange={e => setNuevoCadete(s => ({ ...s, precio_fijo: e.target.value }))} />
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
              <th style={{ padding: '4px 6px' }}>Activo</th>
              <th style={{ padding: '4px 6px' }}>Factura</th>
              <th style={{ padding: '4px 6px' }}>Modo</th>
              <th style={{ padding: '4px 6px' }}>Precio fijo</th>
              <th style={{ padding: '4px 6px' }}></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(t => {
              const isDirty = !!drafts[t.id];
              return (
                <tr key={t.id} style={{ borderTop: `1px solid ${BRAND.border}` }}>
                  <td style={{ padding: '5px 6px', fontWeight: 600 }}>{t.nombre_lightdata || <span style={{ color: BRAND.amber }}>{t.nombre} (sin nombre_lightdata)</span>}</td>
                  <td style={{ padding: '5px 6px' }}>
                    <input type="checkbox" checked={!!draftVal(t, 'activo')} onChange={e => setDraft(t.id, 'activo', e.target.checked)} />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input type="checkbox" checked={!!draftVal(t, 'factura')} onChange={e => setDraft(t.id, 'factura', e.target.checked)} />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <select style={inp} value={draftVal(t, 'modo') || 'fijo'} onChange={e => setDraft(t.id, 'modo', e.target.value)}>
                      <option value="fijo">fijo</option>
                      <option value="cp">cp</option>
                    </select>
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    <input style={{ ...inp, width: 90 }} type="number" value={draftVal(t, 'precio_fijo') ?? ''} onChange={e => setDraft(t.id, 'precio_fijo', e.target.value === '' ? null : Number(e.target.value))} />
                  </td>
                  <td style={{ padding: '5px 6px' }}>
                    {isDirty && (
                      <button style={{ ...btn, padding: '3px 10px' }} disabled={busy} onClick={() => doAction(async () => {
                        await sb(`cadetes_tarifas?id=eq.${t.id}`, { method: 'PATCH', body: JSON.stringify(drafts[t.id]) });
                        setDrafts(d => { const n = { ...d }; delete n[t.id]; return n; });
                      })}>Guardar</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Overrides por CP */}
      <div style={{ background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: BRAND.teal }}>Precios por CP (cadetes en modo "cp")</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <select style={inp} value={cpSel} onChange={e => setCpSel(e.target.value)}>
            <option value="">— elegir cadete modo cp —</option>
            {cadetesCp.map(c => <option key={c.id} value={c.nombre_lightdata}>{c.nombre_lightdata}</option>)}
          </select>
        </div>
        {cpSel && (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginBottom: 10 }}>
              <thead><tr style={{ color: BRAND.muted, textAlign: 'left' }}><th style={{ padding: '4px 6px' }}>CP</th><th style={{ padding: '4px 6px' }}>Precio</th><th></th></tr></thead>
              <tbody>
                {overridesDeSel.map(o => (
                  <tr key={o.cp} style={{ borderTop: `1px solid ${BRAND.border}` }}>
                    <td style={{ padding: '5px 6px' }}>{o.cp}</td>
                    <td style={{ padding: '5px 6px' }}>{money(o.precio)}</td>
                    <td style={{ padding: '5px 6px' }}>
                      <button style={{ ...btn, borderColor: BRAND.red, color: BRAND.red, background: 'rgba(226,75,74,0.1)' }} disabled={busy} onClick={() => doAction(async () => {
                        await sb(`cadete_precio_cp?nombre_lightdata=eq.${encodeURIComponent(o.nombre_lightdata)}&cp=eq.${encodeURIComponent(o.cp)}`, { method: 'DELETE' });
                      })}>Borrar</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input style={{ ...inp, width: 100 }} placeholder="CP" value={nuevoCp.cp} onChange={e => setNuevoCp(s => ({ ...s, cp: e.target.value }))} />
              <input style={{ ...inp, width: 100 }} type="number" placeholder="Precio" value={nuevoCp.precio} onChange={e => setNuevoCp(s => ({ ...s, precio: e.target.value }))} />
              <button style={btn} disabled={busy || !nuevoCp.cp || !nuevoCp.precio} onClick={() => doAction(async () => {
                await sb('cadete_precio_cp', { method: 'POST', body: JSON.stringify([{ nombre_lightdata: cpSel, cp: nuevoCp.cp.trim(), precio: Number(nuevoCp.precio) }]) });
                setNuevoCp({ cp: '', precio: '' });
              })}>+ Agregar</button>
            </div>
          </>
        )}
      </div>

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

// ───────────────────────── componente principal ─────────────────────────

function PagosInner({ session }) {
  const xlsxReady = useXLSX();
  const isAdmin = session && session.email === ADMIN_EMAIL;

  const [vista, setVista] = useState('tabla'); // 'tabla' | 'config'
  const [fecha, setFecha] = useState(todayStr);
  const [semanaLunes, setSemanaLunes] = useState(null); // se resuelve al cargar

  const [tarifas, setTarifas] = useState([]);
  const [alias, setAlias] = useState([]);
  const [cpOverrides, setCpOverrides] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [entregados, setEntregados] = useState([]);
  const [colectas, setColectas] = useState([]);
  const [ajustes, setAjustes] = useState([]);
  const [sinResolver, setSinResolver] = useState([]);
  const [cierres, setCierres] = useState([]);

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingSemana, setLoadingSemana] = useState(true);
  const [error, setError] = useState('');

  const [overrides, setOverrides] = useState({}); // key -> cantidad editada
  const [filtroMetodo, setFiltroMetodo] = useState('todos'); // todos | transferencia | efectivo
  const [expandido, setExpandido] = useState(null); // key de la fila con detalle abierto
  const [ajusteForm, setAjusteForm] = useState({ concepto: '', monto: '' });
  const [busyAccion, setBusyAccion] = useState(false);

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
    setLoadingSemana(true); setError(''); setOverrides({});
    try {
      const sabado = addDays(lunes, 5);
      const [ent, col, aj, sr, ci] = await Promise.all([
        sbAll(`pagos_entregados?select=cadete,localidad,cp&semana_lunes=eq.${lunes}`),
        sbAll(`colectas_registros?select=fecha,choferes,monto&fecha=gte.${lunes}&fecha=lte.${sabado}`),
        sbAll(`pagos_ajustes?select=*&semana_label=eq.${lunes}`),
        sb(`pagos_cadetes_sin_resolver?semana_lunes=eq.${lunes}`),
        sbAll(`pagos_cierres?select=*&semana_label=eq.${lunes}`),
      ]);
      setEntregados(ent || []); setColectas(col || []); setAjustes(aj || []);
      setSinResolver(sr || []); setCierres(ci || []);
    } catch (e) { setError(e.message); }
    finally { setLoadingSemana(false); }
  }, []);

  useEffect(() => { if (semanaLunes) refreshSemana(semanaLunes); }, [semanaLunes, refreshSemana]);

  const calc = useMemo(() => {
    if (loadingConfig || loadingSemana) return { filas: [], aparte: [], ignorados: [], configErrors: [], colectasSinMatch: [] };
    return calcularPagos({ entregados, tarifas, alias, cpOverrides, zonas, colectas, ajustes });
  }, [entregados, tarifas, alias, cpOverrides, zonas, colectas, ajustes, loadingConfig, loadingSemana]);

  const filasEfectivas = useMemo(() => calc.filas.map(f => filaConOverride(f, overrides[f.key])), [calc.filas, overrides]);

  const filasVisibles = useMemo(() => {
    let arr = filasEfectivas.filter(f => filtroMetodo === 'todos' ? true : filtroMetodo === 'transferencia' ? f.factura : !f.factura);
    arr = [...arr].sort((a, b) => {
      if (a.factura !== b.factura) return a.factura ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
    return arr;
  }, [filasEfectivas, filtroMetodo]);

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

  const yaCerrada = cierres.length > 0;

  async function cerrarSemana() {
    if (!window.confirm(`¿Cerrar la semana ${fmtSemanaLabel(semanaLunes)}? Esto congela los montos actuales en pagos_cierres (se puede volver a cerrar y se pisa).`)) return;
    setBusyAccion(true); setError('');
    try {
      await sb(`pagos_cierres?semana_label=eq.${semanaLunes}`, { method: 'DELETE' });
      const rows = filasEfectivas.map(f => ({
        semana_label: semanaLunes, cadete: f.nombre,
        detalle: { cantidad: f.cantidad, monto: f.monto, colecta: f.colecta, ajuste: f.ajusteTotal, modo: f.modo, falta_precio: f.faltaPrecio },
        total: f.total, metodo: f.factura ? 'transferencia' : 'efectivo', pagado: false,
      }));
      if (rows.length) await sb('pagos_cierres', { method: 'POST', body: JSON.stringify(rows) });
      await refreshSemana(semanaLunes);
    } catch (e) { setError(e.message); }
    finally { setBusyAccion(false); }
  }

  async function altaRapida(nombreLD) {
    setBusyAccion(true); setError('');
    try {
      await sb('cadetes_tarifas', { method: 'POST', body: JSON.stringify([{ nombre: nombreLD, nombre_lightdata: nombreLD, activo: true, factura: false, modo: 'fijo' }]) });
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
      {/* Header interno + navegación tabla/config */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setVista('tabla')} style={btnPill(vista === 'tabla')}>Semana</button>
          {isAdmin && <button onClick={() => setVista('config')} style={btnPill(vista === 'config')}>Config de cadetes</button>}
        </div>
        <div style={{ fontSize: 12, color: BRAND.muted }}>
          {session?.nombre} {isAdmin && <span style={{ color: BRAND.teal }}>(admin)</span>} · <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => { logout(); window.location.reload(); }}>Salir</span>
        </div>
      </div>

      {error && <div style={{ background: 'rgba(226,75,74,0.15)', color: BRAND.red, border: `1px solid ${BRAND.red}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {vista === 'config' && isAdmin && (
        <ConfigCadetes tarifas={tarifas} alias={alias} cpOverrides={cpOverrides} onRefresh={refreshConfig} />
      )}

      {vista === 'tabla' && (
        <>
          {/* Selector de semana */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: BRAND.muted }}>Semana:</span>
            <input type="date" value={fecha} onChange={e => { const v = e.target.value; setFecha(v); setSemanaLunes(mondayOf(v)); }} style={inpSt} />
            <span style={{ fontSize: 13, color: BRAND.teal, fontWeight: 600 }}>{fmtSemanaLabel(semanaLunes)}</span>
            {yaCerrada && <span style={{ fontSize: 11, fontWeight: 700, color: BRAND.amber, background: 'rgba(255,176,32,0.12)', border: '1px solid rgba(255,176,32,0.3)', borderRadius: 20, padding: '3px 10px' }}>Semana cerrada</span>}

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {xlsxReady && (
                <button onClick={() => exportarExcel({ filas: filasVisibles, aparte: calc.aparte, sinResolver, semanaLunes, subtotales })}
                  style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, border: `1px solid ${BRAND.teal}`, borderRadius: 8, cursor: 'pointer', background: 'rgba(46,207,170,0.1)', color: BRAND.teal, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="ti ti-file-spreadsheet" style={{ fontSize: 15 }} /> Exportar Excel
                </button>
              )}
              <button disabled={busyAccion || cargando} onClick={cerrarSemana}
                style={{ padding: '6px 14px', fontSize: 12, fontWeight: 700, border: '1px solid rgba(255,176,32,0.4)', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,176,32,0.1)', color: BRAND.amber }}>
                {yaCerrada ? 'Re-cerrar semana' : 'Cerrar semana'}
              </button>
            </div>
          </div>

          {cargando && <div style={{ color: BRAND.muted, padding: '2rem', textAlign: 'center' }}>Calculando…</div>}

          {!cargando && (
            <>
              {/* Filtro método + subtotales */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'stretch' }}>
                <div style={{ ...cardSt, flex: '0 0 auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                  {[['todos', 'Todos'], ['transferencia', 'Transferencia'], ['efectivo', 'Efectivo']].map(([k, l]) => (
                    <button key={k} onClick={() => setFiltroMetodo(k)} style={btnPill(filtroMetodo === k)}>{l}</button>
                  ))}
                </div>
                <div style={{ ...cardSt, flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, minWidth: 280 }}>
                  {[['TOTAL', subtotales.total, BRAND.white], ['Transferencia', subtotales.transferencia, BRAND.teal], ['Efectivo', subtotales.efectivo, BRAND.amber]].map(([lbl, val, color]) => (
                    <div key={lbl} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: BRAND.muted, marginBottom: 2 }}>{lbl}</div>
                      <div style={{ fontSize: 17, fontWeight: 700, color }}>{money(val)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tabla principal */}
              <div style={{ ...cardSt, padding: 0, overflowX: 'auto', marginBottom: 20 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: BRAND.muted, textAlign: 'left', borderBottom: `1px solid ${BRAND.border}` }}>
                      <th style={{ padding: '10px 12px' }}>Cadete</th>
                      <th style={{ padding: '10px 12px' }}>Cant.</th>
                      <th style={{ padding: '10px 12px' }}>Precio</th>
                      <th style={{ padding: '10px 12px' }}>Monto</th>
                      <th style={{ padding: '10px 12px' }}>Colecta</th>
                      <th style={{ padding: '10px 12px' }}>Ajuste</th>
                      <th style={{ padding: '10px 12px' }}>TOTAL</th>
                      <th style={{ padding: '10px 12px' }}>Método</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filasVisibles.map(f => {
                      const precioUnit = f.cantidad ? (f.monto || 0) / f.cantidad : (f.precioFijo || 0);
                      const open = expandido === f.key;
                      return (
                        <React.Fragment key={f.key}>
                          <tr style={{ borderTop: `1px solid ${BRAND.border}`, background: f.faltaPrecio ? 'rgba(226,75,74,0.06)' : 'transparent' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                              {f.nombre}
                              {!f.activo && <span style={{ marginLeft: 6, fontSize: 10, color: BRAND.muted }}>(inactivo)</span>}
                              {f.editado && <span title="cantidad editada manualmente" style={{ marginLeft: 6, fontSize: 10, color: BRAND.amber }}>✎</span>}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              <input type="number" value={f.cantidad} style={{ ...inpSt, width: 68, padding: '4px 6px' }}
                                onChange={e => setOverrides(o => ({ ...o, [f.key]: e.target.value === '' ? f.cantidadOriginal : Number(e.target.value) }))} />
                            </td>
                            <td style={{ padding: '8px 12px' }}>{money(precioUnit)}{f.modo === 'cp' && <span style={{ fontSize: 10, color: BRAND.muted }}> (CP)</span>}</td>
                            <td style={{ padding: '8px 12px' }}>{f.faltaPrecio ? <span style={{ color: BRAND.red, fontWeight: 700 }}>FALTA PRECIO</span> : money(f.monto)}</td>
                            <td style={{ padding: '8px 12px' }}>{money(f.colecta)}</td>
                            <td style={{ padding: '8px 12px', cursor: 'pointer', textDecoration: 'underline dotted' }} onClick={() => setExpandido(open ? null : f.key)}>
                              {f.ajusteTotal ? money(-f.ajusteTotal) : '—'}
                            </td>
                            <td style={{ padding: '8px 12px', fontWeight: 700 }}>{money(f.total)}</td>
                            <td style={{ padding: '8px 12px' }}>
                              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, color: f.factura ? BRAND.teal : BRAND.amber, background: f.factura ? 'rgba(46,207,170,0.12)' : 'rgba(255,176,32,0.12)' }}>
                                {f.factura ? 'Transferencia' : 'Efectivo'}
                              </span>
                              {f.modo === 'cp' && (
                                <button onClick={() => setExpandido(open ? null : f.key)} style={{ marginLeft: 8, fontSize: 11, color: BRAND.muted, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>detalle</button>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={8} style={{ padding: '10px 16px', background: 'rgba(255,255,255,0.02)' }}>
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
                      <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: BRAND.muted }}>Sin datos para esta semana / filtro.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Panel A revisar */}
              <div style={{ ...cardSt, marginBottom: 20 }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: BRAND.amber }}>⚠ A revisar</div>

                {sinResolver.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: BRAND.muted, marginBottom: 6 }}>Choferes nuevos (sin dar de alta)</div>
                    {sinResolver.map(s => (
                      <div key={s.cadete} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '5px 0', fontSize: 12.5, borderTop: `1px solid ${BRAND.border}` }}>
                        <span style={{ flex: 1, fontWeight: 600 }}>{s.cadete}</span>
                        <span style={{ color: BRAND.muted }}>{s.entregas} entregas</span>
                        <button onClick={() => altaRapida(s.cadete)} disabled={busyAccion} style={{ padding: '3px 10px', fontSize: 11, fontWeight: 700, borderRadius: 8, cursor: 'pointer', border: `1px solid ${BRAND.teal}`, background: 'rgba(46,207,170,0.1)', color: BRAND.teal }}>Dar de alta</button>
                      </div>
                    ))}
                  </div>
                )}

                {calc.configErrors.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: BRAND.muted, marginBottom: 6 }}>Errores de configuración (alias apunta a un cadete que no existe)</div>
                    {calc.configErrors.map((c, i) => (
                      <div key={i} style={{ fontSize: 12.5, padding: '4px 0', color: BRAND.red }}>{c.nombre} — {c.cantidad} entregas — {c.motivo}</div>
                    ))}
                  </div>
                )}

                {calc.colectasSinMatch.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 12, color: BRAND.muted, marginBottom: 6 }}>Colectas sin cadete resuelto ({calc.colectasSinMatch.length})</div>
                    <div style={{ fontSize: 12, color: BRAND.muted }}>{[...new Set(calc.colectasSinMatch.map(c => c.chofer))].join(', ')}</div>
                  </div>
                )}

                {calc.aparte.length > 0 && (
                  <div>
                    <div style={{ fontSize: 12, color: BRAND.muted, marginBottom: 6 }}>PAGOS APARTE (fleteros — no suman al total)</div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                      <thead><tr style={{ color: BRAND.muted, textAlign: 'left' }}><th style={{ padding: '4px 6px' }}>Cadete</th><th style={{ padding: '4px 6px' }}>Cant.</th><th style={{ padding: '4px 6px' }}>Monto</th></tr></thead>
                      <tbody>
                        {calc.aparte.map(f => (
                          <tr key={f.key} style={{ borderTop: `1px solid ${BRAND.border}` }}>
                            <td style={{ padding: '5px 6px' }}>{f.nombre}</td>
                            <td style={{ padding: '5px 6px' }}>{f.cantidad}</td>
                            <td style={{ padding: '5px 6px' }}>{f.monto != null ? money(f.monto) : <span style={{ color: BRAND.red }}>FALTA PRECIO</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {sinResolver.length === 0 && calc.configErrors.length === 0 && calc.colectasSinMatch.length === 0 && calc.aparte.length === 0 && (
                  <div style={{ fontSize: 12.5, color: BRAND.muted }}>Nada para revisar esta semana.</div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default function Pagos() {
  const [session, setSession] = useState(() => getSession());
  if (!session) return <LoginPagos onOk={setSession} />;
  return <PagosInner session={session} />;
}
