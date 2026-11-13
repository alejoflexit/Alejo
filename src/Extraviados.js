// src/Extraviados.js — Liquidaciones › Extraviados (pedido de Alejo 13/11/2026).
// Reemplaza el Excel "Paquetes extraviados que debemos descontar de la factura del cliente".
// Se carga el IDML → cruza con envios_busqueda (cliente, transportista) → el valor declarado lo trae
// el workflow extraviados.yml desde la ficha de LightData. Tildar "Descontar" crea una fila de
// pagos_ajustes por cuota (semanas consecutivas) y aparece sola en la Semana de Liquidaciones.
// Datos: extraviados + pagos_ajustes.extraviado_id (migración 20261113150000_extraviados.sql).
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { authedFetch, getSession } from './auth';
import {
  norm, montoDe, cuotasDe, planDescuento, cadeteDePago, cierreDe, estadoCuotas,
  addDays, mondayOf, hoyAR, ddmm, semanaTxt, filtroEnvio, codigoLimpio, parseValor,
} from './extraviadosShared';

const SUPABASE_URL = 'https://svlagoosmxxcsbevkrhy.supabase.co';
const C = {
  navy: '#0d1b2a', card: '#162d42', teal: '#2ECFAA', red: '#E24B4A', amber: '#FFB020', blue: '#4C8DFF',
  white: '#FFFFFF', muted: 'rgba(255,255,255,0.62)', faint: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.09)',
};
const money = (n) => (n == null || Number.isNaN(n) ? '—' : '$' + Math.round(n).toLocaleString('es-AR'));
const yo = () => { const s = getSession(); return (s && (s.nombre || s.email)) || 'admin'; };
const sinTabla = (e) => /extraviados|extraviado_id|relation|schema cache|PGRST20|42P01|42703/i.test(String(e && e.message));

async function sb(path, options = {}) {
  const res = await authedFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options, headers: { Prefer: 'return=representation', ...(options.headers || {}) },
  });
  if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`Supabase ${res.status}: ${t.slice(0, 300)}`); }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

// Mismo criterio que Liquidaciones (syncCierrePorDescuento): si el chofer ya está confirmado y no
// pagado, el total del cierre está congelado → se ajusta por el delta del descuento.
async function syncCierre(cierre, delta) {
  if (!cierre || !cierre.id || cierre.estado !== 'confirmado' || cierre.pagado) return;
  const total = (Number(cierre.total) || 0) + delta;
  const ajuste = (Number(cierre.detalle?.ajuste) || 0) - delta;
  await sb(`pagos_cierres?id=eq.${cierre.id}`, { method: 'PATCH', body: JSON.stringify({ total, detalle: { ...(cierre.detalle || {}), ajuste } }) });
  cierre.total = total; cierre.detalle = { ...(cierre.detalle || {}), ajuste };
}
const cierresDe = async (semanas) => {
  const lista = [...new Set(semanas)].filter(Boolean);
  if (!lista.length) return [];
  return (await sb(`pagos_cierres?select=id,semana_label,cadete,estado,pagado,total,detalle,factura_ok&semana_label=in.(${lista.join(',')})`)) || [];
};

const FORM0 = (semana) => ({ tipo: 'extraviado', codigo: '', fecha: hoyAR(), cliente: '', cadete: '', cadete_ld: '', info: '', valor_manual: '', semana_inicio: semana, cuotas: 1, envio: null, buscando: false });

export default function Extraviados({ tarifas = [], alias = [], semanaLunes, onCambio }) {
  const semanaBase = semanaLunes || mondayOf(hoyAR());
  const [rows, setRows] = useState([]);
  const [ajustes, setAjustes] = useState([]);
  const [cierres, setCierres] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [faltaMigracion, setFaltaMigracion] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busy, setBusy] = useState(null);
  const [form, setForm] = useState(() => FORM0(semanaBase));
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState('todos');
  const [q, setQ] = useState('');
  const [copiado, setCopiado] = useState(false);

  const cadetesOpts = useMemo(() => [...new Set(tarifas.map((t) => t.nombre_lightdata).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es')), [tarifas]);
  const semanasOpts = useMemo(() => {
    const out = []; const base = mondayOf(hoyAR());
    for (let i = -6; i <= 12; i++) out.push(addDays(base, 7 * i));
    if (semanaLunes && !out.includes(semanaLunes)) out.push(semanaLunes);
    return out.sort();
  }, [semanaLunes]);

  const cargar = useCallback(async () => {
    setError('');
    try {
      const [r, aj] = await Promise.all([
        sb('extraviados?select=*&order=fecha.desc,id.desc&limit=2000'),
        sb('pagos_ajustes?extraviado_id=not.is.null&select=id,semana_label,cadete,monto,cuota,extraviado_id&limit=5000'),
      ]);
      const ci = await cierresDe((aj || []).map((a) => a.semana_label));
      setRows(r || []); setAjustes(aj || []); setCierres(ci); setFaltaMigracion(false);
    } catch (e) {
      if (sinTabla(e)) setFaltaMigracion(true); else setError(e.message);
    } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);
  // El valor declarado lo completa el workflow cada 30 min: refresco liviano si hay filas esperándolo
  const esperando = rows.some((r) => r.valor_declarado == null && r.valor_manual == null && !r.valor_error);
  useEffect(() => { if (!esperando) return undefined; const t = setInterval(cargar, 120000); return () => clearInterval(t); }, [esperando, cargar]);

  const ajPorId = useMemo(() => {
    const m = new Map();
    ajustes.forEach((a) => { if (!m.has(a.extraviado_id)) m.set(a.extraviado_id, []); m.get(a.extraviado_id).push(a); });
    return m;
  }, [ajustes]);

  // ── alta: cruce con envios_busqueda mientras se tipea el IDML ──
  const busq = useRef(0);
  useEffect(() => {
    const c = codigoLimpio(form.codigo);
    const f = filtroEnvio(c);
    if (!f || c.length < 5) { setForm((s) => (s.envio || s.buscando ? { ...s, envio: null, buscando: false } : s)); return undefined; }
    const n = ++busq.current;
    setForm((s) => ({ ...s, buscando: true }));
    const t = setTimeout(async () => {
      try {
        const e = ((await sb(`envios_busqueda?${f}&select=id_interno,tracking,id_venta_ml,razon_social,cadete&limit=1`)) || [])[0] || null;
        if (n !== busq.current) return;
        setForm((s) => ({
          ...s, buscando: false, envio: e || false,
          cliente: s.cliente || (e && e.razon_social) || '',
          cadete_ld: (e && e.cadete) || '',
          cadete: s.cadete || (e ? cadeteDePago(e.cadete, tarifas, alias) : ''),
        }));
      } catch { if (n === busq.current) setForm((s) => ({ ...s, buscando: false, envio: false })); }
    }, 450);
    return () => clearTimeout(t);
  }, [form.codigo, tarifas, alias]);

  const duplicado = useMemo(() => {
    const c = norm(codigoLimpio(form.codigo));
    if (!c) return null;
    const ids = [c, norm(form.envio && form.envio.id_interno), norm(form.envio && form.envio.id_venta_ml), norm(form.envio && form.envio.tracking)].filter(Boolean);
    return rows.find((r) => [r.codigo, r.id_interno, r.id_venta_ml, r.tracking].some((v) => v && ids.includes(norm(v)))) || null;
  }, [form.codigo, form.envio, rows]);

  async function agregar() {
    if (!form.codigo.trim() && !form.cliente.trim()) { setError('Cargá al menos el IDML o el cliente.'); return; }
    if (duplicado && !window.confirm(`Ese envío ya está cargado (${ddmm(duplicado.fecha)} · ${duplicado.cliente || ''}). ¿Cargarlo igual?`)) return;
    setBusy('alta'); setError('');
    try {
      const e = form.envio || null;
      await sb('extraviados', { method: 'POST', body: JSON.stringify([{
        tipo: form.tipo, fecha: form.fecha || hoyAR(), codigo: codigoLimpio(form.codigo) || null,
        id_interno: e ? String(e.id_interno || '') || null : null, tracking: e ? e.tracking || null : null, id_venta_ml: e ? e.id_venta_ml || null : null,
        cliente: form.cliente.trim() || null, cadete: form.cadete || null, cadete_ld: form.cadete_ld || null,
        info: form.info.trim() || null, valor_manual: parseValor(form.valor_manual),
        cuotas: Number(form.cuotas) || 1, semana_inicio: form.semana_inicio || semanaBase, creado_por: yo(),
      }]) });
      setForm(FORM0(form.semana_inicio || semanaBase));
      await cargar();
    } catch (e) { setError(sinTabla(e) ? 'Falta correr la migración de Extraviados en Supabase.' : e.message); }
    finally { setBusy(null); }
  }

  async function editar(r, campos) {
    setRows((xs) => xs.map((x) => (x.id === r.id ? { ...x, ...campos } : x)));
    try { await sb(`extraviados?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...campos, actualizado_at: new Date().toISOString() }) }); }
    catch (e) { setError(e.message); cargar(); }
  }

  async function descontar(r) {
    const plan = planDescuento(r);
    if (!plan.length) {
      setError(!r.cadete ? 'Elegí el transportista antes de tildar Descontar.' : !montoDe(r) ? 'Todavía no hay valor: esperá el de LightData o cargalo a mano.' : 'Elegí la semana de la primera cuota.');
      return;
    }
    setBusy(r.id); setError(''); setAviso('');
    try {
      const ci = await cierresDe(plan.map((p) => p.semana_label));
      const pagada = plan.find((p) => { const c = cierreDe(ci, p.semana_label, p.cadete); return c && c.pagado; });
      if (pagada) { setError(`La semana ${semanaTxt(pagada.semana_label)} ya se le pagó a ${r.cadete}. Elegí una semana posterior para la primera cuota.`); return; }
      const conFactura = plan.filter((p) => { const c = cierreDe(ci, p.semana_label, p.cadete); return c && c.estado === 'confirmado' && c.factura_ok; });
      const n = plan.length;
      const txt = `Descontar ${money(montoDe(r))} a ${r.cadete}` +
        (n > 1 ? ` en ${n} cuotas (${plan.map((p) => money(p.monto)).join(' + ')}), semanas del ${ddmm(plan[0].semana_label)} al ${ddmm(plan[n - 1].semana_label)}.` : ` en la semana ${semanaTxt(plan[0].semana_label)}.`) +
        (conFactura.length ? `\n\nOjo: ya tiene la factura marcada en ${conFactura.map((p) => semanaTxt(p.semana_label)).join(', ')}; el total va a cambiar y la factura no va a coincidir.` : '');
      if (!window.confirm(txt)) return;
      const creadas = await sb('pagos_ajustes', { method: 'POST', body: JSON.stringify(plan) });
      try {
        await sb(`extraviados?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ descontar: true, actualizado_at: new Date().toISOString() }) });
      } catch (e) {
        // sin la marca no se ve que hay cuotas: se deshace para no dejar descuentos huérfanos
        await sb(`pagos_ajustes?id=in.(${(creadas || []).map((a) => a.id).join(',')})`, { method: 'DELETE' }).catch(() => {});
        throw e;
      }
      for (const p of plan) await syncCierre(cierreDe(ci, p.semana_label, p.cadete), -p.monto);
      await cargar(); onCambio && onCambio();
    } catch (e) { setError(sinTabla(e) ? 'Falta correr la migración de Extraviados en Supabase.' : e.message); }
    finally { setBusy(null); }
  }

  async function quitarDescuento(r) {
    const mias = ajPorId.get(r.id) || [];
    setBusy(r.id); setError(''); setAviso('');
    try {
      const ci = await cierresDe(mias.map((a) => a.semana_label));
      const pagadas = mias.filter((a) => { const c = cierreDe(ci, a.semana_label, a.cadete); return c && c.pagado; });
      const borrables = mias.filter((a) => !pagadas.includes(a));
      if (!borrables.length && mias.length) { setError('Todas las cuotas ya se pagaron: no hay nada para sacar.'); return; }
      if (!window.confirm(`Sacar ${borrables.length} cuota${borrables.length === 1 ? '' : 's'} (${money(borrables.reduce((s, a) => s + Number(a.monto || 0), 0))}) de Liquidaciones?` +
        (pagadas.length ? `\n${pagadas.length} ya pagada${pagadas.length === 1 ? '' : 's'} quedan como están.` : ''))) return;
      if (borrables.length) await sb(`pagos_ajustes?id=in.(${borrables.map((a) => a.id).join(',')})`, { method: 'DELETE' });
      for (const a of borrables) await syncCierre(cierreDe(ci, a.semana_label, a.cadete), Number(a.monto) || 0);
      if (!pagadas.length) await sb(`extraviados?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ descontar: false, actualizado_at: new Date().toISOString() }) });
      else setAviso(`Quedaron ${pagadas.length} cuota${pagadas.length === 1 ? '' : 's'} ya pagada${pagadas.length === 1 ? '' : 's'}; se sacaron las demás.`);
      await cargar(); onCambio && onCambio();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  async function borrar(r) {
    if ((ajPorId.get(r.id) || []).length) { setError('Primero destildá Descontar (tiene cuotas en Liquidaciones).'); return; }
    if (!window.confirm(`Borrar el ${r.tipo === 'roto' ? 'roto' : 'extraviado'} de ${r.cliente || r.codigo || ''}?`)) return;
    setBusy(r.id);
    try { await sb(`extraviados?id=eq.${r.id}`, { method: 'DELETE' }); await cargar(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  }

  // ── vista ──
  const filas = useMemo(() => rows.map((r) => ({ ...r, monto: montoDe(r), est: estadoCuotas(ajPorId.get(r.id), cierres) })), [rows, ajPorId, cierres]);
  const visibles = useMemo(() => {
    const k = norm(q);
    return filas.filter((r) => {
      if (filtro === 'decidir' && r.descontar) return false;
      if (filtro === 'cuotas' && !(r.descontar && r.est.resta > 0)) return false;
      if (filtro === 'saldados' && !(r.descontar && r.est.n && r.est.resta === 0)) return false;
      if (filtro === 'rotos' && r.tipo !== 'roto') return false;
      if (!k) return true;
      return [r.cliente, r.cadete, r.codigo, r.id_interno, r.info, r.obs].some((v) => norm(v).includes(k));
    });
  }, [filas, filtro, q]);
  const tot = useMemo(() => visibles.reduce((a, r) => ({
    valor: a.valor + (r.monto || 0), aDescontar: a.aDescontar + (r.descontar ? r.est.total : 0), resta: a.resta + (r.descontar ? r.est.resta : 0),
  }), { valor: 0, aDescontar: 0, resta: 0 }), [visibles]);

  function copiarExcel() {
    // mismas columnas que la planilla: fecha · cliente · transportista · info · valor · obs · idml
    const txt = [...visibles].reverse().map((r) => [ddmm(r.fecha), r.cliente || '', r.cadete || r.cadete_ld || '', [r.tipo === 'roto' ? 'Roto' : 'Extraviado', r.info].filter(Boolean).join(' · '),
      r.monto ? Math.round(r.monto) : 'S/N', r.obs || '', r.codigo || r.id_interno || ''].join('\t')).join('\n');
    navigator.clipboard.writeText(txt).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1800); }).catch(() => setError('No se pudo copiar.'));
  }

  const inp = { padding: '9px 11px', borderRadius: 9, border: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.22)', color: C.white, fontSize: 13, outline: 'none', minWidth: 0 };
  const sel = { ...inp, cursor: 'pointer' };
  const chip = (on, color = C.blue) => ({ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${on ? color : C.border}`, background: on ? `${color}22` : C.faint, color: on ? color : C.muted });
  const th = { position: 'sticky', top: 0, zIndex: 2, background: C.card, boxShadow: `0 1px 0 ${C.border}`, padding: '10px 10px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'left', whiteSpace: 'nowrap' };
  const td = { padding: '10px 10px', fontSize: 13, borderTop: `1px solid ${C.border}`, verticalAlign: 'top' };
  const opt = { background: C.navy };

  if (cargando) return <div style={{ color: C.muted, padding: '2rem', textAlign: 'center' }}>Cargando extraviados…</div>;
  if (faltaMigracion) return (
    <div style={{ background: 'rgba(255,176,32,0.1)', border: `1px solid ${C.amber}`, color: C.amber, padding: 16, borderRadius: 12, fontSize: 13.5, lineHeight: 1.5 }}>
      Falta crear la tabla. En Supabase › SQL Editor corré <b>supabase/migrations/20261113150000_extraviados.sql</b> y volvé a entrar.
    </div>
  );

  return (
    <div>
      {/* Resumen + acciones */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {[['Valor de lo listado', money(tot.valor), C.white], ['A descontar a transportistas', money(tot.aDescontar), C.amber], ['Falta descontar', money(tot.resta), tot.resta ? C.red : C.teal]].map(([k, v, col]) => (
          <div key={k} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 14px', minWidth: 150 }}>
            <div style={{ fontSize: 11, color: C.muted }}>{k}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: col }}>{v}</div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={copiarExcel} disabled={!visibles.length} style={{ ...chip(false), padding: '9px 14px' }}>{copiado ? '✓ Copiado' : 'Copiar para Excel'}</button>
        <button onClick={() => setAbierto((v) => !v)} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: C.blue, color: C.navy, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{abierto ? 'Cerrar' : '+ Cargar extraviado / roto'}</button>
      </div>

      {error && <div style={{ background: 'rgba(226,75,74,0.15)', color: C.red, border: `1px solid ${C.red}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>{error}</span><button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: C.red, cursor: 'pointer' }}>✕</button></div>}
      {aviso && <div style={{ background: 'rgba(255,176,32,0.12)', color: C.amber, border: `1px solid ${C.amber}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{aviso}</div>}

      {/* Alta */}
      {abierto && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button onClick={() => setForm((s) => ({ ...s, tipo: 'extraviado' }))} style={chip(form.tipo === 'extraviado', C.amber)}>Extraviado</button>
            <button onClick={() => setForm((s) => ({ ...s, tipo: 'roto' }))} style={chip(form.tipo === 'roto', C.red)}>Roto</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: C.muted }}>IDML / tracking / ID LightData
              <input autoFocus value={form.codigo} onChange={(e) => setForm((s) => ({ ...s, codigo: e.target.value, envio: null }))} placeholder="2000019384679834" style={{ ...inp, fontFamily: 'monospace' }} />
              <span style={{ fontSize: 11, minHeight: 14, color: form.envio ? C.teal : form.envio === false ? C.amber : C.muted }}>
                {form.buscando ? 'Buscando en LightData…' : form.envio ? `✓ Encontrado · ID ${form.envio.id_interno}${form.cadete_ld ? ` · ${form.cadete_ld}` : ''}` : form.envio === false ? 'No está en los últimos días de LightData: completá a mano' : ''}
              </span>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: C.muted, alignContent: 'start' }}>Fecha
              <input type="date" value={form.fecha} onChange={(e) => setForm((s) => ({ ...s, fecha: e.target.value }))} style={inp} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: C.muted, alignContent: 'start' }}>Cliente
              <input value={form.cliente} onChange={(e) => setForm((s) => ({ ...s, cliente: e.target.value }))} style={inp} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: C.muted, alignContent: 'start' }}>Transportista
              <select value={form.cadete} onChange={(e) => setForm((s) => ({ ...s, cadete: e.target.value }))} style={sel}>
                <option value="" style={opt}>— sin transportista —</option>
                {cadetesOpts.map((n) => <option key={n} value={n} style={opt}>{n}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: C.muted, alignContent: 'start' }}>Info
              <input value={form.info} onChange={(e) => setForm((s) => ({ ...s, info: e.target.value }))} placeholder="qué pasó" style={inp} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: C.muted, alignContent: 'start' }}>Valor a mano (opcional)
              <input className="no-spin" type="number" value={form.valor_manual} onChange={(e) => setForm((s) => ({ ...s, valor_manual: e.target.value }))} placeholder="si no, el declarado de LightData" style={inp} />
            </label>
          </div>
          {duplicado && <div style={{ marginTop: 10, fontSize: 12.5, color: C.amber }}>Ya está cargado: {ddmm(duplicado.fecha)} · {duplicado.cliente || ''} · {duplicado.cadete || ''}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button onClick={agregar} disabled={busy === 'alta'} style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: C.teal, color: C.navy, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: busy === 'alta' ? 0.6 : 1 }}>{busy === 'alta' ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        {[['todos', 'Todos'], ['decidir', 'Sin descontar'], ['cuotas', 'Descontando'], ['saldados', 'Saldados'], ['rotos', 'Rotos']].map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)} style={chip(filtro === k)}>{l}</button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar cliente, transportista, IDML…" style={{ ...inp, marginLeft: 'auto', width: 260 }} />
      </div>

      {/* Tabla */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'auto', maxHeight: '70vh' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', color: C.white }}>
          <thead><tr>
            {['Fecha', 'Cliente', 'Transportista', 'IDML', 'Valor', 'Info / Obs', 'Descontar', ''].map((h, i) => <th key={i} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {!visibles.length && <tr><td colSpan={8} style={{ ...td, textAlign: 'center', color: C.muted, padding: 28 }}>{rows.length ? 'Nada con ese filtro.' : 'Todavía no hay extraviados cargados.'}</td></tr>}
            {visibles.map((r) => {
              const bloqueado = r.descontar || busy === r.id;
              const cuotas = cuotasDe(r.monto, r.cuotas);
              return (
                <tr key={r.id}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <div>{ddmm(r.fecha)}</div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: r.tipo === 'roto' ? C.red : C.amber }}>{r.tipo === 'roto' ? 'ROTO' : 'EXTRAVIADO'}</span>
                  </td>
                  <td style={td}>{r.cliente || <span style={{ color: C.muted }}>—</span>}</td>
                  <td style={td}>
                    <select value={r.cadete || ''} disabled={bloqueado} onChange={(e) => editar(r, { cadete: e.target.value || null })} style={{ ...sel, padding: '6px 8px', maxWidth: 170, opacity: bloqueado ? 0.75 : 1 }}>
                      <option value="" style={opt}>—</option>
                      {r.cadete && !cadetesOpts.includes(r.cadete) && <option value={r.cadete} style={opt}>{r.cadete}</option>}
                      {cadetesOpts.map((n) => <option key={n} value={n} style={opt}>{n}</option>)}
                    </select>
                    {r.cadete_ld && norm(r.cadete_ld) !== norm(r.cadete) && <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>LightData: {r.cadete_ld}</div>}
                  </td>
                  <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                    {r.codigo || '—'}
                    {r.id_interno && r.id_interno !== r.codigo && <div style={{ fontSize: 11, color: C.muted }}>LD {r.id_interno}</div>}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 700 }}>{r.monto ? money(r.monto) : <span style={{ color: C.muted }}>{r.valor_error ? 'S/N' : 'buscando…'}</span>}</div>
                    {r.valor_manual != null && r.valor_declarado != null && <div style={{ fontSize: 11, color: C.muted }}>declarado {money(Number(r.valor_declarado))}</div>}
                    {r.valor_manual == null && r.valor_declarado != null && <div style={{ fontSize: 11, color: C.muted }}>declarado LightData</div>}
                    {!r.monto && r.valor_error && <div style={{ fontSize: 11, color: C.amber, maxWidth: 170, whiteSpace: 'normal' }}>{r.valor_error}</div>}
                    {!r.descontar && (
                      <input className="no-spin" type="number" defaultValue={r.valor_manual ?? ''} placeholder="a mano" title="si lo cargás, manda sobre el declarado"
                        onBlur={(e) => { const v = parseValor(e.target.value); if (v !== (r.valor_manual == null ? null : Number(r.valor_manual))) editar(r, { valor_manual: v }); }}
                        style={{ ...inp, padding: '5px 8px', width: 100, marginTop: 5, fontSize: 12 }} />
                    )}
                  </td>
                  <td style={{ ...td, minWidth: 160 }}>
                    {r.info && <div style={{ marginBottom: 4 }}>{r.info}</div>}
                    <input defaultValue={r.obs || ''} placeholder="obs" onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (r.obs || null)) editar(r, { obs: v }); }}
                      style={{ ...inp, padding: '5px 8px', width: '100%', fontSize: 12 }} />
                  </td>
                  <td style={{ ...td, minWidth: 230 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: busy === r.id ? 'wait' : 'pointer', fontWeight: 700, color: r.descontar ? C.teal : C.white }}>
                      <input type="checkbox" checked={!!r.descontar} disabled={busy === r.id} onChange={() => (r.descontar ? quitarDescuento(r) : descontar(r))} style={{ width: 18, height: 18, accentColor: C.teal, cursor: 'pointer' }} />
                      {busy === r.id ? 'Guardando…' : r.descontar ? 'Descontando' : 'Descontar'}
                    </label>
                    {!r.descontar ? (
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: C.muted }}>
                        <select value={r.cuotas || 1} onChange={(e) => editar(r, { cuotas: Number(e.target.value) })} style={{ ...sel, padding: '5px 8px', fontSize: 12 }}>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n} style={opt}>{n === 1 ? '1 pago' : `${n} cuotas`}</option>)}
                        </select>
                        desde
                        <select value={r.semana_inicio || ''} onChange={(e) => editar(r, { semana_inicio: e.target.value })} style={{ ...sel, padding: '5px 8px', fontSize: 12 }}>
                          {!r.semana_inicio && <option value="" style={opt}>semana…</option>}
                          {r.semana_inicio && !semanasOpts.includes(r.semana_inicio) && <option value={r.semana_inicio} style={opt}>{semanaTxt(r.semana_inicio)}</option>}
                          {semanasOpts.map((s) => <option key={s} value={s} style={opt}>{semanaTxt(s)}</option>)}
                        </select>
                        {r.monto && (r.cuotas || 1) > 1 ? <span>{`de ${money(cuotas[0])}`}</span> : null}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>
                        {r.est.n > 1 ? `${r.est.pagadas}/${r.est.n} cuotas pagadas` : r.est.pagadas ? 'Ya descontado' : 'Pendiente'}
                        {r.est.proxima && <> · {r.est.n > 1 ? 'próxima' : 'semana'} {semanaTxt(r.est.proxima)}</>}
                        {r.est.resta > 0 && r.est.n > 1 && <div>Falta {money(r.est.resta)} de {money(r.est.total)}</div>}
                        {!r.est.n && <div style={{ color: C.amber }}>Sin cuotas en Liquidaciones (¿se borraron a mano?)</div>}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, width: 30 }}>
                    <button onClick={() => borrar(r)} disabled={bloqueado} title={r.descontar ? 'destildá Descontar para borrar' : 'borrar'} style={{ background: 'none', border: 'none', color: C.muted, cursor: bloqueado ? 'not-allowed' : 'pointer', opacity: bloqueado ? 0.35 : 1, fontSize: 14 }}>✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 10, lineHeight: 1.5 }}>
        El valor declarado se trae de LightData cada 30 min. Al tildar <b>Descontar</b>, cada cuota aparece como descuento del transportista en la Semana correspondiente de Liquidaciones.
      </div>
    </div>
  );
}
