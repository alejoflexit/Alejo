// src/PagosPagador.js — Vista de pago semanal de cadetes (para quien ejecuta los pagos).
// Solo LEE pagos_cierres + cadetes_tarifas. No recalcula, no edita montos, sin export, sin Config.
// Ver wiki/analisis/spec-pagos-vista-pagador.md
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { authedFetch } from './auth';

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";

const BRAND = {
  navyCard: "#162d42",
  teal:     "#2ECFAA",
  red:      "#E24B4A",
  amber:    "#FFB020",
  white:    "#FFFFFF",
  muted:    "rgba(255,255,255,0.58)",
  faint:    "rgba(255,255,255,0.06)",
  border:   "rgba(255,255,255,0.09)",
};

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function maskCbu(cbu) {
  const s = String(cbu || '');
  return s.length > 8 ? '…' + s.slice(-6) : s;
}

function fmtSemanaLabel(lunes) {
  if (!lunes) return '';
  const d = new Date(lunes + 'T00:00:00');
  const sab = new Date(d); sab.setDate(d.getDate() + 5);
  const f = (x) => `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
  return `${f(d)} al ${f(sab)}`;
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

function copiar(valor, setCopiado, key) {
  if (!valor) return;
  navigator.clipboard.writeText(valor).then(() => {
    setCopiado(key);
    setTimeout(() => setCopiado(c => (c === key ? null : c)), 1200);
  }).catch(() => {});
}

// Chip copiable de un dato bancario. `display` opcional (ej. CBU enmascarado); copia el valor completo.
function CopyField({ label, valor, display, campoKey, copiado, setCopiado }) {
  if (!valor) return null;
  const isCopiado = copiado === campoKey;
  return (
    <span onClick={() => copiar(valor, setCopiado, campoKey)} title={`Tocar para copiar ${label}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5,
        padding: '5px 10px', borderRadius: 8, background: isCopiado ? 'rgba(46,207,170,0.15)' : BRAND.faint,
        border: `1px solid ${isCopiado ? 'rgba(46,207,170,0.4)' : BRAND.border}` }}>
      <span style={{ color: BRAND.muted }}>{label}</span>
      <span style={{ fontWeight: 600, color: BRAND.white, wordBreak: 'break-all' }}>{display || valor}</span>
      <span style={{ fontSize: 12, color: isCopiado ? BRAND.teal : BRAND.muted }}>{isCopiado ? '✓' : '📋'}</span>
    </span>
  );
}

// tarifas: array de cadetes_tarifas ya cargado por Pagos.js (evita refetch).
export default function PagosPagador({ tarifas }) {
  const [semanas, setSemanas] = useState([]);
  const [semanaSel, setSemanaSel] = useState(null);
  const [cierres, setCierres] = useState([]);
  const [loadingSemanas, setLoadingSemanas] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('pendientes');      // pendientes | pagados | todos
  const [filtroMetodo, setFiltroMetodo] = useState('todos'); // todos | factura | efectivo
  const [copiado, setCopiado] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    sb('pagos_cierres?select=semana_label')
      .then(rows => {
        const unicas = Array.from(new Set((rows || []).map(r => r.semana_label))).sort().reverse();
        setSemanas(unicas);
        setSemanaSel(unicas[0] || null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingSemanas(false));
  }, []);

  const cargarCierres = useCallback((semana) => {
    if (!semana) { setCierres([]); setLoading(false); return; }
    setLoading(true); setError('');
    sb(`pagos_cierres?select=*&semana_label=eq.${semana}`)
      .then(rows => setCierres(rows || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { cargarCierres(semanaSel); }, [semanaSel, cargarCierres]);

  const tarifaByLD = useMemo(() => {
    const m = new Map();
    (tarifas || []).forEach(t => { if (t.nombre_lightdata) m.set(norm(t.nombre_lightdata), t); });
    return m;
  }, [tarifas]);

  const filas = useMemo(() => {
    return cierres.map(c => {
      const t = tarifaByLD.get(norm(c.cadete)) || {};
      const alias = t.alias || '', cbu = t.cbu || '';
      return {
        id: c.id,
        nombre: t.nombre || c.cadete,
        total: c.total,
        metodo: c.metodo,
        factura: c.metodo === 'transferencia',
        pagado: !!c.pagado,
        alias, cuil: t.cuil || '', cbu,
        sinDatos: c.metodo === 'transferencia' && !alias && !cbu, // no hay forma de transferir
      };
    }).sort((a, b) => {
      if (a.factura !== b.factura) return a.factura ? -1 : 1; // factura (cobran lunes) primero
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }, [cierres, tarifaByLD]);

  const filasFiltradas = useMemo(() => {
    let r = filas;
    if (filtro === 'pagados') r = r.filter(f => f.pagado);
    else if (filtro === 'pendientes') r = r.filter(f => !f.pagado);
    if (filtroMetodo === 'factura') r = r.filter(f => f.factura);
    else if (filtroMetodo === 'efectivo') r = r.filter(f => !f.factura);
    return r;
  }, [filas, filtro, filtroMetodo]);

  const counts = useMemo(() => ({
    pendientes: filas.filter(f => !f.pagado).length,
    pagados: filas.filter(f => f.pagado).length,
    todos: filas.length,
    factura: filas.filter(f => f.factura).length,
    efectivo: filas.filter(f => !f.factura).length,
  }), [filas]);

  const resumen = useMemo(() => {
    const pagados = filas.filter(f => f.pagado).length;
    const faltan = filas.filter(f => !f.pagado).reduce((s, f) => s + (f.total || 0), 0);
    const faltanFactura = filas.filter(f => !f.pagado && f.factura).reduce((s, f) => s + (f.total || 0), 0);
    const pct = filas.length ? Math.round(pagados / filas.length * 100) : 0;
    return { pagados, total: filas.length, faltan, faltanFactura, pct };
  }, [filas]);

  async function togglePagado(f) {
    setBusyId(f.id);
    setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: !f.pagado } : c));
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ pagado: !f.pagado }) });
    } catch (e) {
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: f.pagado } : c));
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const cardSt = { background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: '12px 14px' };
  const pill = (active, color = BRAND.teal) => ({ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: `1px solid ${active ? color : BRAND.border}`, background: active ? 'rgba(46,207,170,0.15)' : BRAND.faint, color: active ? color : BRAND.muted });

  return (
    <div style={{ maxWidth: 940 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: BRAND.muted }}>Semana:</span>
        {semanas.length > 0 && (
          <select value={semanaSel || ''} onChange={e => setSemanaSel(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: BRAND.white }}>
            {semanas.map(s => <option key={s} value={s}>{fmtSemanaLabel(s)}</option>)}
          </select>
        )}
      </div>

      {error && <div style={{ background: 'rgba(226,75,74,0.15)', color: BRAND.red, border: `1px solid ${BRAND.red}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {!loadingSemanas && semanas.length === 0 && (
        <div style={{ color: BRAND.muted, fontSize: 13 }}>Alejo todavía no cerró ninguna semana.</div>
      )}

      {semanaSel && (
        <>
          <div style={{ ...cardSt, marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Pagados {resumen.pagados} de {resumen.total} <span style={{ color: BRAND.muted, fontWeight: 600 }}>· {resumen.pct}%</span></span>
              <span style={{ fontSize: 13, color: BRAND.muted }}>Faltan <b style={{ color: resumen.faltan ? BRAND.amber : BRAND.teal }}>{money(resumen.faltan)}</b>{resumen.faltanFactura > 0 && <> · factura <b style={{ color: BRAND.white }}>{money(resumen.faltanFactura)}</b></>}</span>
            </div>
            <div style={{ height: 10, borderRadius: 20, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
              <div style={{ width: `${resumen.pct}%`, height: '100%', borderRadius: 20, background: resumen.pct === 100 ? BRAND.teal : 'linear-gradient(90deg,#FFB020,#2ECFAA)', transition: 'width 0.3s' }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 56 }}>Estado</span>
              {[['pendientes', 'Pendientes'], ['pagados', 'Pagados'], ['todos', 'Todos']].map(([k, l]) => (
                <button key={k} onClick={() => setFiltro(k)} style={pill(filtro === k)}>{l} {counts[k] > 0 && <span style={{ opacity: 0.7 }}>({counts[k]})</span>}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 56 }}>Método</span>
              {[['todos', 'Ambos'], ['factura', 'Factura'], ['efectivo', 'Efectivo']].map(([k, l]) => (
                <button key={k} onClick={() => setFiltroMetodo(k)} style={pill(filtroMetodo === k, k === 'efectivo' ? BRAND.amber : BRAND.teal)}>{l}{k !== 'todos' && <span style={{ opacity: 0.7 }}> ({counts[k]})</span>}</button>
              ))}
            </div>
          </div>

          {loading && <div style={{ color: BRAND.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>Cargando…</div>}

          {!loading && filasFiltradas.length === 0 && (
            <div style={{ color: BRAND.muted, fontSize: 13, padding: '2rem', textAlign: 'center' }}>Nada para mostrar con este filtro.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filasFiltradas.map(f => {
              const chipColor = f.factura ? BRAND.teal : BRAND.amber;
              const chipBg = f.factura ? 'rgba(46,207,170,0.10)' : 'rgba(255,176,32,0.10)';
              return (
                <div key={f.id} style={{ ...cardSt, padding: '15px 16px', opacity: f.pagado ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 11, borderColor: f.pagado ? 'rgba(46,207,170,0.3)' : BRAND.border }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, color: chipColor, background: chipBg, border: `1px solid ${chipColor}33`, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      {f.factura ? 'Factura' : 'Efectivo'}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: 15, minWidth: 130, textDecoration: f.pagado ? 'line-through' : 'none' }}>{f.nombre}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 17, fontWeight: 800, color: f.pagado ? BRAND.muted : BRAND.white }}>{money(f.total)}</span>
                    <button onClick={() => togglePagado(f)} disabled={busyId === f.id}
                      style={{
                        height: 36, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busyId === f.id ? 'wait' : 'pointer',
                        border: `1px solid ${f.pagado ? BRAND.teal : 'transparent'}`,
                        background: f.pagado ? 'transparent' : BRAND.teal,
                        color: f.pagado ? BRAND.teal : '#06231b',
                        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                      }}>
                      {f.pagado ? '✓ Pagado' : 'Marcar pagado'}
                    </button>
                  </div>
                  {f.factura && (f.alias || f.cuil || f.cbu || f.sinDatos) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <CopyField label="Alias" valor={f.alias} campoKey={`alias-${f.id}`} copiado={copiado} setCopiado={setCopiado} />
                      <CopyField label="CUIL" valor={f.cuil} campoKey={`cuil-${f.id}`} copiado={copiado} setCopiado={setCopiado} />
                      <CopyField label="CBU" valor={f.cbu} display={maskCbu(f.cbu)} campoKey={`cbu-${f.id}`} copiado={copiado} setCopiado={setCopiado} />
                      {f.sinDatos && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: BRAND.amber }}>⚠ falta alias o CBU para transferir</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
