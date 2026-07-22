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
                            style={{ height: 36, padding: '0 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: busyId === f.id ? 'wait' : 'pointer', border: 'none', color: '#fff', background: m.color, display: 'inline-flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
                            <img src={m.logo} alt="" width="20" height="20" style={{ display: 'block', borderRadius: 4, background: '#fff' }} /> {m.nombre}
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
