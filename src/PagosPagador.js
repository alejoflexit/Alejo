// src/PagosPagador.js — Vista simplificada para quien ejecuta las transferencias (Adrián).
// Solo LEE pagos_cierres + cadetes_tarifas. No recalcula nada, no edita montos, sin export, sin Config.
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
  muted:    "rgba(255,255,255,0.45)",
  faint:    "rgba(255,255,255,0.06)",
  border:   "rgba(255,255,255,0.09)",
};

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim();
}

function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return '$' + Math.round(n).toLocaleString('es-AR');
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

function CopyField({ label, valor, campoKey, copiado, setCopiado }) {
  if (!valor) return <div style={{ fontSize: 11.5, color: BRAND.amber, padding: '3px 0' }}>⚠ sin {label.toLowerCase()}</div>;
  const isCopiado = copiado === campoKey;
  return (
    <div onClick={() => copiar(valor, setCopiado, campoKey)}
      title="tocar para copiar"
      style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, padding: '3px 0' }}>
      <span style={{ color: BRAND.muted, minWidth: 42 }}>{label}</span>
      <span style={{ fontWeight: 600, color: BRAND.white, wordBreak: 'break-all' }}>{valor}</span>
      <span style={{ fontSize: 11, color: isCopiado ? BRAND.teal : BRAND.muted }}>{isCopiado ? '✓ copiado' : '📋'}</span>
    </div>
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
  const [filtro, setFiltro] = useState('pendientes'); // pendientes | pagados | todos
  const [copiado, setCopiado] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // semanas con cierre (únicas, orden por fecha real desc — semana_label es YYYY-MM-DD)
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
      return {
        id: c.id,
        nombre: t.nombre || c.cadete,
        total: c.total,
        metodo: c.metodo,
        pagado: !!c.pagado,
        alias: t.alias || '',
        cuil: t.cuil || '',
        cbu: t.cbu || '',
      };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [cierres, tarifaByLD]);

  const filasFiltradas = useMemo(() => {
    if (filtro === 'todos') return filas;
    if (filtro === 'pagados') return filas.filter(f => f.pagado);
    return filas.filter(f => !f.pagado);
  }, [filas, filtro]);

  const resumen = useMemo(() => {
    const pagados = filas.filter(f => f.pagado).length;
    const faltan = filas.filter(f => !f.pagado).reduce((s, f) => s + (f.total || 0), 0);
    return { pagados, total: filas.length, faltan };
  }, [filas]);

  async function togglePagado(f) {
    setBusyId(f.id);
    setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: !f.pagado } : c)); // optimista
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ pagado: !f.pagado }) });
    } catch (e) {
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: f.pagado } : c)); // revert
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  const cardSt = { background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: '12px 14px' };
  const pill = (active) => ({ padding: '5px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: `1px solid ${active ? BRAND.teal : BRAND.border}`, background: active ? 'rgba(46,207,170,0.15)' : BRAND.faint, color: active ? BRAND.teal : BRAND.muted });

  return (
    <div>
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
          <div style={{ ...cardSt, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              Pagados {resumen.pagados} de {resumen.total} — faltan {money(resumen.faltan)}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['pendientes', 'Pendientes'], ['pagados', 'Pagados'], ['todos', 'Todos']].map(([k, l]) => (
                <button key={k} onClick={() => setFiltro(k)} style={pill(filtro === k)}>{l}</button>
              ))}
            </div>
          </div>

          {loading && <div style={{ color: BRAND.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>Cargando…</div>}

          {!loading && filasFiltradas.length === 0 && (
            <div style={{ color: BRAND.muted, fontSize: 13 }}>Nada para mostrar con este filtro.</div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filasFiltradas.map(f => (
              <div key={f.id} style={{ ...cardSt, opacity: f.pagado ? 0.55 : 1, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', flex: '0 0 auto' }}>
                  <input type="checkbox" checked={f.pagado} disabled={busyId === f.id} onChange={() => togglePagado(f)} style={{ width: 18, height: 18 }} />
                </label>
                <div style={{ flex: '1 1 160px', minWidth: 140 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, textDecoration: f.pagado ? 'line-through' : 'none' }}>{f.nombre}</div>
                  <div style={{ fontSize: 11, color: BRAND.muted }}>{f.metodo === 'efectivo' ? 'Efectivo' : 'Transferencia'}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800, color: BRAND.teal, flex: '0 0 auto' }}>{money(f.total)}</div>
                <div style={{ flex: '1 1 220px', minWidth: 200 }}>
                  <CopyField label="Alias" valor={f.alias} campoKey={`alias-${f.id}`} copiado={copiado} setCopiado={setCopiado} />
                  <CopyField label="CUIL" valor={f.cuil} campoKey={`cuil-${f.id}`} copiado={copiado} setCopiado={setCopiado} />
                  <CopyField label="CBU" valor={f.cbu} campoKey={`cbu-${f.id}`} copiado={copiado} setCopiado={setCopiado} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
