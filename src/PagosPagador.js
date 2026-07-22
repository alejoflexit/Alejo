// src/PagosPagador.js — Vista de pago semanal de cadetes (para quien ejecuta los pagos).
// Solo LEE pagos_cierres + cadetes_tarifas. No recalcula, no edita montos, sin export, sin Config.
// Ver wiki/analisis/spec-pagos-vista-pagador.md
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { authedFetch } from './auth';

// Medios de pago (para distinguir cómo se pagó cada cadete). Logos incrustados como data URL.
const LOGO_GALICIA = "data:image/png;base64,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";
const LOGO_MP = "data:image/png;base64,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";


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

const MEDIOS = {
  galicia:     { nombre: 'Galicia',      logo: LOGO_GALICIA, color: '#FF6A13' },
  mercadopago: { nombre: 'Mercado Pago', logo: LOGO_MP,      color: '#009EE3' },
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
  const [pickId, setPickId] = useState(null); // fila cuyo selector de medio (Galicia/MP) está abierto

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
        pagadoVia: c.pagado_via || null,
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

  // marcar pagado eligiendo el medio (galicia | mercadopago); queda guardado en pagos_cierres.pagado_via
  async function marcarPagado(f, via) {
    setBusyId(f.id); setPickId(null);
    setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: true, pagado_via: via } : c));
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ pagado: true, pagado_via: via }) });
    } catch (e) {
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: false, pagado_via: null } : c));
      setError(e.message);
    } finally { setBusyId(null); }
  }

  // deshacer el pago (vuelve a pendiente y borra el medio)
  async function desmarcar(f) {
    setBusyId(f.id); setPickId(null);
    setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: false, pagado_via: null } : c));
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ pagado: false, pagado_via: null }) });
    } catch (e) {
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: true, pagado_via: f.pagadoVia } : c));
      setError(e.message);
    } finally { setBusyId(null); }
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
              {[['pendientes', 'Pendientes'], ['pagados', 'Pagados']].map(([k, l]) => (
                <button key={k} onClick={() => setFiltro(filtro === k ? 'todos' : k)} style={pill(filtro === k)}>{l} {counts[k] > 0 && <span style={{ opacity: 0.7 }}>({counts[k]})</span>}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 56 }}>Método</span>
              {[['factura', 'Factura'], ['efectivo', 'Efectivo']].map(([k, l]) => (
                <button key={k} onClick={() => setFiltroMetodo(filtroMetodo === k ? 'todos' : k)} style={pill(filtroMetodo === k, k === 'efectivo' ? BRAND.amber : BRAND.teal)}>{l} <span style={{ opacity: 0.7 }}>({counts[k]})</span></button>
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
                    {f.pagado ? (() => {
                      const m = MEDIOS[f.pagadoVia];
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap',
                          color: m ? m.color : BRAND.teal, background: m ? `${m.color}1f` : 'rgba(46,207,170,0.12)', border: `1px solid ${m ? m.color : BRAND.teal}66` }}>
                          {m ? <img src={m.logo} alt="" width="20" height="20" style={{ display: 'block', borderRadius: 4 }} /> : '✓'}
                          {m ? m.nombre : 'Pagado'}
                          <button onClick={() => desmarcar(f)} disabled={busyId === f.id} title="deshacer pago"
                            style={{ background: 'none', border: 'none', color: BRAND.muted, cursor: busyId === f.id ? 'wait' : 'pointer', fontSize: 14, marginLeft: 2, lineHeight: 1 }}>✕</button>
                        </span>
                      );
                    })() : pickId === f.id ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {Object.entries(MEDIOS).map(([k, m]) => (
                          <button key={k} onClick={() => marcarPagado(f, k)} disabled={busyId === f.id} title={`Marcar pagado por ${m.nombre}`}
                            style={{ height: 36, padding: '0 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: busyId === f.id ? 'wait' : 'pointer', color: m.color, background: `${m.color}1f`, border: `1px solid ${m.color}`, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                            <img src={m.logo} alt="" width="22" height="22" style={{ display: 'block' }} /> {m.nombre}
                          </button>
                        ))}
                        <button onClick={() => setPickId(null)} style={{ background: 'none', border: 'none', color: BRAND.muted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>cancelar</button>
                      </span>
                    ) : (
                      <button onClick={() => setPickId(f.id)}
                        style={{ height: 36, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: BRAND.teal, color: '#06231b', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        Marcar pagado
                      </button>
                    )}
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
