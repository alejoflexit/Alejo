import React, { useState, useEffect, useRef, useCallback } from 'react';
import { login, logout, getSession, authedFetch, getToken } from './auth';

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

// Bridge LightData (VPS) — solo lectura, riesgo aceptado de exponer la key en el bundle (ver spec-lightdata-bridge)
const BRIDGE_URL = "https://srv1801226.hstgr.cloud/bridge/colecta";
const BRIDGE_KEY = "db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b"; // clave del bridge (/root/flexit/bridge.key en el VPS) — visible en el bundle, riesgo aceptado (ver spec-lightdata-bridge)

const BRAND = {
  navy:    "#0d1b2a",
  navyMid: "#112236",
  navyCard:"#162d42",
  navySide:"#0a1520",
  teal:    "#2ECFAA",
  white:   "#FFFFFF",
  muted:   "rgba(255,255,255,0.62)",
  faint:   "rgba(255,255,255,0.06)",
  border:  "rgba(255,255,255,0.09)",
};

const SECCIONES = ['CABA', 'SUR', 'NOROESTE', 'SABADOS'];
const DEFAULT_CHOFERES = ['Alric','Capra','Cepero','Vaccaro','Dani Vargas','Gonzalo','Maxi','Renzo','Cris','Pedro'];

async function sbFetch(path, options = {}) {
  const res = await authedFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "Prefer": "return=representation",
      ...options.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : [];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMonto(n) {
  return n ? '$' + Number(n).toLocaleString('es-AR') : '—';
}

// Normaliza nombres de LightData para matchear (doble espacio, tildes, mayúsculas)
function normNombre(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Devuelve una función canon(nombre) que resuelve alias (pagos_cadete_alias, regla=merge) a su nombre canónico
function buildCanonAlias(aliasList) {
  const map = new Map();
  (aliasList || []).forEach(a => {
    if (a.regla === 'merge' && a.nombre_lightdata && a.paga_como) {
      map.set(normNombre(a.nombre_lightdata), normNombre(a.paga_como));
    }
  });
  return nombre => { const n = normNombre(nombre); return map.get(n) || n; };
}

function getWeekRange(fechaStr) {
  const d = new Date(fechaStr + 'T12:00:00');
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sat = new Date(mon);
  sat.setDate(mon.getDate() + 5);
  const fmt = dt => dt.toISOString().slice(0, 10);
  const fmtD = dt => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`;
  return { start: fmt(mon), end: fmt(sat), label: `${fmtD(mon)} – ${fmtD(sat)}` };
}

const thSt = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em',
  borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap',
};

// ── CHOFER PICKER ──
function ChoferPicker({ chs, choferesList, onUpdate, hideChips }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editIdx, setEditIdx] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const all = ['A coordinar', ...choferesList];
  const filtered = query ? all.filter(c => c.toLowerCase().includes(query.toLowerCase())) : all;

  const assign = ch => {
    let next;
    if (editIdx !== null) {
      next = [...chs]; next[editIdx] = ch;
    } else {
      const base = chs.filter(x => x !== 'A coordinar');
      next = [...base, ch];
      if (!next.length) next = ['A coordinar'];
    }
    onUpdate({ choferes: next });
    setOpen(false); setQuery(''); setEditIdx(null);
  };

  const remove = (i, e) => {
    e.stopPropagation();
    const next = chs.filter((_, j) => j !== i);
    onUpdate({ choferes: next.length ? next : ['A coordinar'] });
  };

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 150 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {!hideChips && chs.map((ch, i) => {
          const warn = ch === 'A coordinar';
          return (
            <div key={i} onClick={() => { setEditIdx(i); setQuery(''); setOpen(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 20, border: `1px solid ${warn ? '#FBBF24' : '#2ECFAA'}`, background: warn ? '#FBBF24' : '#2ECFAA', fontSize: 11, fontWeight: 700, color: '#14171c', cursor: 'pointer', userSelect: 'none' }}>
              {ch}
              {chs.length > 1 && (
                <span onClick={e => remove(i, e)} style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, lineHeight: 1 }}>✕</span>
              )}
            </div>
          );
        })}
        <button onClick={() => { setEditIdx(null); setQuery(''); setOpen(true); }}
          style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)', background: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 300, width: 210, background: '#162d42', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.55)' }}>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>🔍</span>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Buscar chofer..."
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQuery(''); }
                if (e.key === 'Enter' && filtered.length > 0) assign(filtered[0]);
              }}
              style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: 12, outline: 'none', width: '100%' }} />
          </div>
          <div style={{ maxHeight: 185, overflowY: 'auto' }}>
            {!chs.every(x => x === 'A coordinar') && (
              <div onClick={() => { onUpdate({ choferes: ['A coordinar'], estado: 'blanco', confirmado_por: [] }); setOpen(false); setQuery(''); }}
                style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: '#E24B4A', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(226,75,74,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                × Desasignar
              </div>
            )}
            {filtered.slice(0, 12).map(ch => (
              <div key={ch} onClick={() => assign(ch)}
                style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: ch === 'A coordinar' ? '#FBBF24' : '#fff' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {ch}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Sin resultados</div>
            )}
            {filtered.length > 12 && (
              <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Seguí escribiendo para filtrar...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Hora de llegada: opcional y discreta. Por defecto es solo un ícono de reloj chico
// (sin ocupar lugar); al tocarlo se expande a un input HH:MM con máscara manual (solo
// dígitos, valida 00:00–23:59 al confirmar) — reemplaza el <input type="time"> nativo,
// que en Firefox y algunos móviles se veía mal o no abría el selector.
const ETA_DEFAULT = '15:00';

// Muestra la hora estimada en el slot central de la fila. La edición se abre desde acá (tocando la hora)
// o desde el botón reloj fijo de la derecha (editing controlado por el padre).
function EtaInput({ value, onChange, editing, onEditingChange }) {
  const [text, setText] = useState(value || '');
  const inputRef = useRef(null);

  useEffect(() => { if (!editing) setText(value || ''); }, [value, editing]);
  // al abrir la edición, arranca en la hora cargada o 15:00 (horario habitual) para no tipear las 4 cifras
  useEffect(() => { if (editing) setText(value || ETA_DEFAULT); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  const handleChange = e => {
    const digits = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
    setText(digits.length > 2 ? digits.slice(0, 2) + ':' + digits.slice(2) : digits);
  };

  const commit = () => {
    onEditingChange(false);
    if (text === '') { onChange(''); return; }
    // si solo cargó la hora (2 cifras, sin ':'), completa los minutos en 00
    const candidate = /^\d{2}$/.test(text) ? `${text}:00` : text;
    const m = candidate.match(/^(\d{2}):(\d{2})$/);
    if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) onChange(candidate);
    else setText(value || '');
  };

  if (editing) {
    return (
      <div style={{ display:'flex', alignItems:'center', gap:5, height:28, padding:'0 8px', borderRadius:14,
        border:'1px solid rgba(58,143,212,0.5)', background:'rgba(58,143,212,0.12)' }}>
        <span style={{ fontSize:12 }}>🕐</span>
        <input
          ref={inputRef}
          type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5}
          value={text} onChange={handleChange} onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') e.target.blur();
            if (e.key === 'Escape') { setText(value || ''); onEditingChange(false); }
          }}
          title="Hora estimada de llegada (HH:MM)"
          style={{ width:36, border:'none', outline:'none', background:'transparent', padding:0,
            fontSize:13, fontWeight:600, color:'#8EC5FF' }} />
      </div>
    );
  }

  if (!value) return null;

  return (
    <button type="button" onClick={() => onEditingChange(true)}
      title={`Hora estimada ${value} · tocar para editar`}
      style={{ display:'flex', alignItems:'center', gap:4, height:28, padding:'0 8px',
        justifyContent:'center', borderRadius:14, border:'none', cursor:'pointer',
        background: 'rgba(58,143,212,0.10)', color: '#8EC5FF' }}>
      <span style={{ fontSize:14 }}>🕐</span>
      <span style={{ fontSize:13, fontWeight:600 }}>{value}</span>
    </button>
  );
}

function LoginColectas({ onOk }) {
  const [em, setEm] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const inp = { width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${err ? '#FF5C5C' : 'rgba(255,255,255,0.18)'}`, background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: 15, boxSizing: 'border-box', outline: 'none' };
  return (
    <div style={{ minHeight: '62vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 400, maxWidth: '94vw', padding: '36px 32px', borderRadius: 22, border: '1px solid rgba(46,207,170,0.22)', background: 'linear-gradient(165deg, rgba(46,207,170,0.09), rgba(58,143,212,0.06) 55%, rgba(255,255,255,0.02))', textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>📦</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>Colectas Flexit</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 4, marginBottom: 22 }}>Ingresá con tu usuario del equipo</div>
        <form onSubmit={async e => {
          e.preventDefault(); if (busy) return; setBusy(true); setErr('');
          try { const ses = await login(em, pw); onOk(ses.nombre); }
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

function ColectasInner({ soloArribos = false }) {
  const [navView, setNavView] = useState(soloArribos ? 'arribos' : 'colectas'); // 'colectas' | 'arribos' | 'pagos' | 'clientes' | 'choferes'
  const [tab, setTab] = useState('CABA');
  const [fecha, setFecha] = useState(todayStr);
  const [montoEdit, setMontoEdit] = useState(null); // { id, valor } — edición del precio del día
  const [dirEdit, setDirEdit] = useState(null); // { id, valor } — dirección puntual del día
  const [zonaEdit, setZonaEdit] = useState(null); // { id, valor } — zona puntual del día
  const [filtroEstado, setFiltroEstado] = useState(null); // null = todos | verde/amarillo/blanco/rojo
  const [busqueda, setBusqueda] = useState(''); // buscador de cliente o chofer
  const [clientes, setClientes] = useState([]);
  const [registros, setRegistros] = useState({});
  const [saveStatus, setSaveStatus] = useState('saved');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copiedChofer, setCopiedChofer] = useState(null);
  const [hoverChofer, setHoverChofer] = useState(null); // resalta el grupo del cadete al pasar el mouse
  const [arribos, setArribos] = useState({}); // Arribos: cadete -> { id, llego_at }
  const [colectaLD, setColectaLD] = useState({ porChofer: {}, actualizado: null, ok: false }); // Fase 2 bridge: badge 📦
  const [aliasCadetes, setAliasCadetes] = useState([]); // pagos_cadete_alias, para matchear nombres LightData
  const [busquedaArribos, setBusquedaArribos] = useState(''); // filtro por nombre de cadete en Arribos
  const [etaEdit, setEtaEdit] = useState(null); // cadete cuya hora estimada se está editando

  // Pagos
  const [semanaFecha, setSemanaFecha] = useState(todayStr);
  const [pagosData, setPagosData] = useState([]);
  const [loadingPagos, setLoadingPagos] = useState(false);

  // Clientes ABM
  const emptyForm = { nombre:'', direccion:'', zona_barrio:'', seccion:'CABA', horario:'', monto:'', activo:true, chat_id:'', opera_sabados:false };
  const [gruposWA, setGruposWA] = useState([]); // grupos de WhatsApp que conoce el bot (agente_config)
  const [avisoBot, setAvisoBot] = useState('');
  const [clienteForm, setClienteForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [clienteFiltroSec, setClienteFiltroSec] = useState('todos');

  // Choferes list
  const [choferesList, setChoferesList] = useState(() => {
    try { const s = localStorage.getItem('flexit_choferes'); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });
  const [syncingChoferes, setSyncingChoferes] = useState(false);

  const syncChoferes = useCallback(async () => {
    setSyncingChoferes(true);
    try {
      const rows = await sbFetch('semanas?select=cadete&order=fecha.desc&limit=5000');
      const unique = [...new Set(rows.map(r => r.cadete).filter(n => n && !n.includes('⚠️')))].sort();
      if (unique.length > 0) setChoferesList(unique);
    } catch(e) { console.error('Error sincronizando choferes:', e); }
    finally { setSyncingChoferes(false); }
  }, []);

  const saveTimer = useRef(null);
  const registrosRef = useRef({});
  const pendingSavesRef = useRef(new Map());

  useEffect(() => { registrosRef.current = registros; }, [registros]);

  // Tiempo real: cambios de otros usuarios en el dia activo (Supabase Realtime)
  useEffect(() => {
    if (!fecha || !window.supabase) return;
    let client = null, channel = null, cancelled = false, retryTimer = null;
    const cleanup = () => {
      try { if (channel && client) client.removeChannel(channel); } catch {}
      try { if (client) client.realtime.disconnect(); } catch {}
      channel = null; client = null;
    };
    const connect = async () => {
      const token = await getToken().catch(() => null);
      if (!token || cancelled) return;
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      client.realtime.setAuth(token);
      channel = client.channel('colectas-rt-' + fecha)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'colectas_registros', filter: `fecha=eq.${fecha}` }, payload => {
          const row = payload.new;
          if (!row || !row.cliente_id) return;
          if (pendingSavesRef.current.has(row.cliente_id)) return; // no pisar una edicion local en curso
          setRegistros(prev => ({ ...prev, [row.cliente_id]: { ...prev[row.cliente_id], ...row } }));
        })
        .subscribe(status => {
          // token vencido o corte de red: reconectar con token fresco
          if (!cancelled && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
            clearTimeout(retryTimer);
            retryTimer = setTimeout(() => { cleanup(); connect(); }, 5000);
          }
        });
    };
    connect();
    return () => { cancelled = true; clearTimeout(retryTimer); cleanup(); };
  }, [fecha]);

  // Sincronizar choferes desde Supabase siempre al montar
  useEffect(() => {
    syncChoferes();
  }, [syncChoferes]);

  // Persistir cambios manuales en localStorage
  useEffect(() => {
    try { localStorage.setItem('flexit_choferes', JSON.stringify(choferesList)); } catch {}
  }, [choferesList]);

  // Grupos de WhatsApp del bot (para vincular clientes y mandar avisos)
  useEffect(() => {
    sbFetch('agente_config?tipo=eq.grupo&estado=eq.activo&select=chat_id,nombre_grupo,cliente&order=nombre_grupo.asc')
      .then(setGruposWA).catch(() => setGruposWA([]));
  }, []);

  // Load clients
  useEffect(() => {
    sbFetch('colectas_clientes?select=*&order=seccion.asc,nombre.asc')
      .then(setClientes)
      .catch(e => setError('Error cargando clientes: ' + e.message));
  }, []);

  // Load records for date
  useEffect(() => {
    if (!fecha) return;
    setLoading(true);
    setRegistros({});
    sbFetch(`colectas_registros?select=*&fecha=eq.${fecha}`)
      .then(async rows => {
        const map = {};
        rows.forEach(r => {
          map[r.cliente_id] = {
            id: r.id,
            choferes: r.choferes?.length ? r.choferes : ['A coordinar'],
            estado: r.estado || (r.confirmado ? 'verde' : null),
            confirmado_por: r.confirmado_por || [],
            direccion: r.direccion ?? null,
            zona_barrio: r.zona_barrio ?? null,
          };
        });
        // Carry-forward: pre-cargar choferes del último día anterior para clientes sin registro hoy
        try {
          const prev = await sbFetch(`colectas_registros?select=cliente_id,choferes,fecha&fecha=lt.${fecha}&order=fecha.desc&limit=3000`);
          const latest = {};
          prev.forEach(r => { if (!latest[r.cliente_id] && r.choferes?.length) latest[r.cliente_id] = r.choferes; });
          Object.entries(latest).forEach(([cid, chs]) => {
            if (!map[cid]) map[cid] = { id: null, choferes: chs, estado: null, confirmado_por: [] };
          });
        } catch(_) {}
        setRegistros(map);
      })
      .catch(e => setError('Error cargando registros: ' + e.message))
      .finally(() => setLoading(false));
  }, [fecha]);

  // Flush pending saves
  const flushSaves = useCallback(async () => {
    const saves = [...pendingSavesRef.current.entries()];
    if (!saves.length) return;
    pendingSavesRef.current.clear();
    try {
      for (const [clienteId, data] of saves) {
        const existing = registrosRef.current[clienteId];
        if (existing?.id) {
          await sbFetch(`colectas_registros?id=eq.${existing.id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ choferes: data.choferes, estado: data.estado, confirmado_por: data.confirmado_por, ...('monto' in data ? { monto: data.monto } : {}), ...('direccion' in data ? { direccion: data.direccion } : {}), ...('zona_barrio' in data ? { zona_barrio: data.zona_barrio } : {}) }),
          });
        } else {
          const result = await sbFetch('colectas_registros', {
            method: 'POST',
            body: JSON.stringify({ fecha, cliente_id: clienteId, choferes: data.choferes, estado: data.estado, confirmado_por: data.confirmado_por, ...('monto' in data ? { monto: data.monto } : {}), ...('direccion' in data ? { direccion: data.direccion } : {}), ...('zona_barrio' in data ? { zona_barrio: data.zona_barrio } : {}) }),
          });
          const row = Array.isArray(result) ? result[0] : result;
          if (row?.id) {
            setRegistros(prev => ({ ...prev, [clienteId]: { ...prev[clienteId], id: row.id } }));
          }
        }
      }
      setSaveStatus('saved');
    } catch(e) {
      setSaveStatus('error');
      console.error('Save error:', e);
    }
  }, [fecha]);

  // Preguntar por WhatsApp a los pendientes de hoy si tienen envios (via bot: casos estado 'enviando')
  const preguntarPendientes = async (pendientes) => {
    const conGrupo = pendientes.filter(c => c.chat_id);
    const sinGrupo = pendientes.length - conGrupo.length;
    if (!conGrupo.length) { setAvisoBot('Ningún pendiente tiene grupo de WhatsApp vinculado (se vincula en Clientes).'); setTimeout(() => setAvisoBot(''), 8000); return; }
    const MSG = 'Hola, buen día! 👋 ¿Cómo va? ¿Tienen envíos para hoy?';
    if (!window.confirm(`Mandar "${MSG}" a ${conGrupo.length} grupo(s)` + (sinGrupo ? ` — ojo: ${sinGrupo} pendiente(s) sin grupo vinculado no reciben` : '') + '?')) return;
    const quien = (getSession() || {}).nombre || 'Colectas';
    let ok = 0, fail = 0;
    for (const c of conGrupo) {
      const g = gruposWA.find(x => x.chat_id === c.chat_id);
      try {
        await sbFetch('casos', { method: 'POST', body: JSON.stringify({
          chat_id: c.chat_id, grupo: g?.nombre_grupo || c.nombre, autor: 'Colectas Flexit',
          mensaje: `(aviso automático) Consulta de colecta a ${c.nombre}`,
          tipo: 'colecta', estado: 'enviando', respuesta_enviada: MSG,
          enviado_via: 'colectas', enviado_por: quien, enviado_at: new Date().toISOString(),
        }) });
        ok++;
      } catch (e) { fail++; }
    }
    setAvisoBot(`🤖 ${ok} mensaje(s) encolado(s) — el bot los manda en el próximo minuto (solo a grupos habilitados).` + (fail ? ` ${fail} fallaron.` : ''));
    setTimeout(() => setAvisoBot(''), 12000);
  };

  const updateRegistro = useCallback((clienteId, updates) => {
    setRegistros(prev => {
      const current = prev[clienteId] || { choferes: ['A coordinar'], estado: 'blanco', confirmado_por: [] };
      const next = { ...current, ...updates };
      pendingSavesRef.current.set(clienteId, next);
      setSaveStatus('saving');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushSaves, 700);
      return { ...prev, [clienteId]: next };
    });
  }, [flushSaves]);

  // Pagos — se carga cuando navView === 'pagos'
  useEffect(() => {
    if (navView !== 'pagos') return;
    setLoadingPagos(true);
    const { start, end } = getWeekRange(semanaFecha);
    sbFetch(`colectas_registros?select=*,colectas_clientes(nombre,monto)&fecha=gte.${start}&fecha=lte.${end}`)
      .then(regs => {
        const map = {};
        regs.forEach(r => {
          const monto = Number(r.monto ?? r.colectas_clientes?.monto ?? 0);
          (r.choferes || []).forEach(ch => {
            if (!ch || ch === 'A coordinar') return;
            if (!map[ch]) map[ch] = { cadete: ch, total: 0, confirmadas: 0, monto: 0 };
            map[ch].total++;
            if (r.confirmado_por?.length > 0 || r.estado === 'verde') { map[ch].confirmadas++; map[ch].monto += monto; }
          });
        });
        setPagosData(Object.values(map).sort((a, b) => b.monto - a.monto));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingPagos(false));
  }, [navView, semanaFecha]);

  // Arribos — cargar cuando navView === 'arribos'
  useEffect(() => {
    if (navView !== 'arribos' || !fecha) return;
    sbFetch(`colectas_arribos?select=*&fecha=eq.${fecha}`)
      .then(rows => {
        const m = {};
        rows.forEach(r => { m[r.cadete] = { id: r.id, llego_at: r.llego_at, eta: r.eta }; });
        setArribos(m);
      })
      .catch(e => setError('Error cargando arribos: ' + e.message));
  }, [navView, fecha]);

  // Arribos — colecta LightData en vivo (bridge VPS). Fallback silencioso: nunca rompe la vista.
  useEffect(() => {
    if (navView !== 'arribos' || !fecha) return;
    if (aliasCadetes.length === 0) {
      sbFetch('pagos_cadete_alias?select=*').then(setAliasCadetes).catch(() => {});
    }
    const d = new Date(fecha + 'T12:00:00');
    const fechaLD = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    fetch(`${BRIDGE_URL}?fecha=${encodeURIComponent(fechaLD)}`, { headers: { 'x-bridge-key': BRIDGE_KEY }, signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error('bridge ' + r.status); return r.json(); })
      .then(json => {
        const porChofer = {};
        (json.choferes || []).forEach(row => {
          const key = normNombre(row.chofer);
          porChofer[key] = (porChofer[key] || 0) + Number(row.cantidad || 0);
        });
        setColectaLD({ porChofer, actualizado: json.actualizado || new Date().toISOString(), ok: true });
      })
      .catch(() => setColectaLD(prev => ({ ...prev, ok: false })))
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [navView, fecha, aliasCadetes.length]);

  // Arribos — tiempo real
  useEffect(() => {
    if (navView !== 'arribos' || !fecha || !window.supabase) return;
    let client = null, channel = null, cancelled = false, retryTimer = null;
    const cleanup = () => {
      try { if (channel && client) client.removeChannel(channel); } catch {}
      try { if (client) client.realtime.disconnect(); } catch {}
      channel = null; client = null;
    };
    const connect = async () => {
      const token = await getToken().catch(() => null);
      if (!token || cancelled) return;
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
      client.realtime.setAuth(token);
      channel = client.channel('arribos-rt-' + fecha)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'colectas_arribos', filter: `fecha=eq.${fecha}` }, payload => {
          if (payload.eventType === 'DELETE') {
            const oldId = payload.old?.id;
            setArribos(prev => {
              const n = {}; let removed = false;
              for (const [cad, v] of Object.entries(prev)) { if (oldId && v.id === oldId) { removed = true; continue; } n[cad] = v; }
              return removed ? n : prev;
            });
          } else {
            const r = payload.new;
            if (r?.cadete) setArribos(prev => ({ ...prev, [r.cadete]: { id: r.id, llego_at: r.llego_at, eta: r.eta } }));
          }
        })
        .subscribe(status => {
          if (!cancelled && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
            clearTimeout(retryTimer);
            retryTimer = setTimeout(() => { cleanup(); connect(); }, 5000);
          }
        });
    };
    connect();
    return () => { cancelled = true; clearTimeout(retryTimer); cleanup(); };
  }, [navView, fecha]);

  // Save cliente
  const saveCliente = async () => {
    const payload = {
      ...clienteForm,
      horario: clienteForm.horario || null,
      monto: clienteForm.monto !== '' ? Number(clienteForm.monto) : null,
      chat_id: clienteForm.chat_id || null,
      opera_sabados: !!clienteForm.opera_sabados,
    };
    try {
      if (editId) {
        await sbFetch(`colectas_clientes?id=eq.${editId}`, {
          method: 'PATCH', headers: { 'Prefer':'return=minimal' }, body: JSON.stringify(payload),
        });
      } else {
        await sbFetch('colectas_clientes', { method: 'POST', body: JSON.stringify(payload) });
      }
      const updated = await sbFetch('colectas_clientes?select=*&order=seccion.asc,nombre.asc');
      setClientes(updated);
      setShowForm(false);
      setEditId(null);
      setClienteForm(emptyForm);
    } catch(e) { setError('Error: ' + e.message); }
  };

  const editCliente = c => {
    setEditId(c.id);
    setClienteForm({ nombre:c.nombre, direccion:c.direccion, zona_barrio:c.zona_barrio||'', seccion:c.seccion, horario:c.horario??'', monto:c.monto??'', activo:c.activo, chat_id:c.chat_id||'', opera_sabados:!!c.opera_sabados });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleFija = async c => {
    await sbFetch(`colectas_clientes?id=eq.${c.id}`, {
      method:'PATCH', headers:{'Prefer':'return=minimal'}, body: JSON.stringify({ fija: !c.fija }),
    });
    setClientes(prev => prev.map(x => x.id === c.id ? { ...x, fija: !x.fija } : x));
  };

  const toggleActivo = async c => {
    await sbFetch(`colectas_clientes?id=eq.${c.id}`, {
      method:'PATCH', headers:{'Prefer':'return=minimal'}, body: JSON.stringify({ activo: !c.activo }),
    });
    setClientes(prev => prev.map(x => x.id === c.id ? { ...x, activo: !x.activo } : x));
  };

  // Helpers
  const seccionClientes = clientes.filter(c => c.activo && (tab === 'SABADOS' ? (c.opera_sabados || c.seccion === 'SABADOS') : c.seccion === tab));

  function getGroups(list) {
    const groups = {}, order = [];
    list.forEach(c => {
      const reg = registros[c.id];
      const chs = reg?.choferes?.length ? reg.choferes : ['A coordinar'];
      chs.forEach(ch => {
        if (!groups[ch]) { groups[ch] = []; order.push(ch); }
        if (!groups[ch].find(x => x.id === c.id)) groups[ch].push(c);
      });
    });
    const uniq = [...new Set(order)].filter(c => c !== 'A coordinar').sort((a,b) => a.localeCompare(b, 'es'));
    return { groups, order: ['A coordinar', ...uniq].filter(c => groups[c]) };
  }

  function buildMsg(chofer) {
    // Solo clientes con colecta real: amarillo (Con envíos) o verde (Confirmado).
    // Quedan afuera blanco (Pendiente) y rojo (Sin envíos). Los fijos sin estado cuentan como amarillo.
    const rows = seccionClientes.filter(c => {
      const reg = registros[c.id];
      if (!reg?.choferes?.includes(chofer)) return false;
      const estEf = (c.fija && (!reg.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg.estado || 'blanco');
      return estEf === 'amarillo' || estEf === 'verde';
    });
    const d = new Date(fecha + 'T12:00:00');
    const fechaFmt = d.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'numeric' });
    let msg = `🚚 *Colectas ${tab} – ${fechaFmt}*\n\n`;
    rows.forEach(c => {
      msg += `• *${c.nombre}*`;
      const zona = registros[c.id]?.zona_barrio || c.zona_barrio;
      if (zona) msg += ` (${zona})`;
      const dir = registros[c.id]?.direccion || c.direccion;
      msg += `\n  📍 ${dir}`;
      const horaCli = c.horario || (c.hora_habitual ? `${c.hora_habitual}:00` : '');
      if (horaCli) msg += ` · ${horaCli}`;
      const montoDia = registros[c.id]?.monto ?? c.monto;
      if (montoDia) msg += ` · $${Number(montoDia).toLocaleString('es-AR')}`;
      msg += '\n';
    });
    msg += '\n✅ Confirmá cuando llegues a cada local.';
    return msg;
  }

  function copyMsg(chofer) {
    const msg = buildMsg(chofer);
    navigator.clipboard.writeText(msg).then(() => {
      setCopiedChofer(chofer);
      setTimeout(() => setCopiedChofer(null), 2000);
    });
  }

  // Confirma (pasa a verde) todas las colectas CON ENVÍOS (amarillo) de un cadete.
  // Respeta divididas: suma este chofer a confirmado_por y solo pone verde si ya confirmaron todos.
  function confirmarTodos(chofer) {
    seccionClientes.forEach(c => {
      const reg = registros[c.id];
      const chs = reg?.choferes?.length ? reg.choferes : ['A coordinar'];
      if (!chs.includes(chofer)) return;
      const estEf = (c.fija && (!reg?.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg?.estado || 'blanco');
      if (estEf === 'rojo' || estEf === 'verde') return; // sin envíos o ya confirmado
      const confirmadoPor = reg?.confirmado_por || [];
      const isDividida = chs.length > 1 && !chs.every(x => x === 'A coordinar');
      if (isDividida) {
        if (confirmadoPor.includes(chofer)) return;
        const nuevos = [...confirmadoPor, chofer];
        const activos = chs.filter(x => x !== 'A coordinar');
        const todosOk = activos.length > 0 && activos.every(x => nuevos.includes(x));
        updateRegistro(c.id, { confirmado_por: nuevos, estado: todosOk ? 'verde' : 'amarillo' });
      } else {
        updateRegistro(c.id, { estado: 'verde' });
      }
    });
  }

  const inpSt = {
    padding:'7px 10px', fontSize:12, border:`1px solid ${BRAND.border}`,
    borderRadius:8, background:BRAND.faint, color:BRAND.white, outline:'none',
  };

  // ── ZONA RENDER ──
  function renderZona() {
    if (loading) return <div style={{ color:BRAND.muted, padding:'3rem', textAlign:'center' }}>Cargando...</div>;

    if (!seccionClientes.length) return (
      <div style={{ color:BRAND.muted, padding:'3rem', textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:8 }}>📦</div>
        <div>No hay clientes activos en {tab}.</div>
        <button onClick={() => setNavView('clientes')}
          style={{ marginTop:12, padding:'6px 16px', borderRadius:8, border:`1px solid ${BRAND.teal}`, background:'transparent', color:BRAND.teal, cursor:'pointer', fontSize:13 }}>
          Ir a Clientes →
        </button>
      </div>
    );

    const norm = t => String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const clientesFiltrados = seccionClientes.filter(c => {
      const reg = registros[c.id];
      const estEf = (c.fija && (!reg?.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg?.estado || 'blanco');
      if (filtroEstado && estEf !== filtroEstado) return false;
      if (busqueda.trim()) {
        const q = norm(busqueda);
        if (!norm(c.nombre).includes(q) && !(reg?.choferes||[]).some(ch => norm(ch).includes(q))) return false;
      }
      return true;
    });
    const { groups, order } = getGroups(clientesFiltrados);
    const sinAsignar = (getGroups(seccionClientes).groups['A coordinar'] || []).filter(c => {
      const reg = registros[c.id];
      const estEf = (c.fija && (!reg?.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg?.estado || 'blanco');
      return estEf !== 'rojo'; // los cancelados / sin envíos no cuentan como "sin asignar"
    }).length;

    // Conteo de estados
    const conteoEstados = seccionClientes.reduce((acc, c) => {
      const _e = registros[c.id]?.estado;
      const est = (c.fija && (!_e || _e === 'blanco')) ? 'amarillo' : (_e || 'blanco');
      acc[est] = (acc[est] || 0) + 1;
      return acc;
    }, {});

    return (
      <>
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:BRAND.muted }}>
            <span>📅</span>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              style={{ ...inpSt, padding:'5px 10px' }} />
          </div>
          <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
            onKeyDown={e => { if (e.key==='Escape') setBusqueda(''); }}
            placeholder="🔍 Cliente o chofer..."
            style={{ ...inpSt, padding:'5px 10px', width:180 }} />
          {busqueda && (
            <button onClick={() => setBusqueda('')} title="Limpiar búsqueda"
              style={{ border:'none', background:'none', color:BRAND.muted, cursor:'pointer', fontSize:14, padding:2 }}>✕</button>
          )}
          {sinAsignar > 0 && (
            <div style={{ padding:'3px 12px', borderRadius:20, background:'rgba(251,191,36,0.12)', border:'1px solid rgba(251,191,36,0.3)', color:'#FBBF24', fontSize:12, fontWeight:600 }}>
              ⚠️ {sinAsignar} sin asignar
            </div>
          )}
          {(() => { const pend = seccionClientes.filter(c => (registros[c.id]?.estado || 'blanco') === 'blanco'); return pend.length > 0 && (
            <button onClick={() => preguntarPendientes(pend)} title="Preguntarles por WhatsApp si tienen envíos hoy (bot)"
              style={{ padding:'4px 12px', borderRadius:20, border:'1px solid rgba(74,158,255,0.4)', background:'rgba(74,158,255,0.08)', color:'#4A9EFF', fontSize:12, fontWeight:600, cursor:'pointer' }}>
              🤖 Preguntar a pendientes ({pend.filter(c=>c.chat_id).length}/{pend.length})
            </button>
          ); })()}
          {avisoBot && <div style={{ fontSize:12, color:'#4A9EFF' }}>{avisoBot}</div>}
          <div style={{ marginLeft:'auto', fontSize:12, color: saveStatus==='error'?'#E24B4A':saveStatus==='saving'?BRAND.muted:'#2ECFAA' }}>
            {saveStatus==='saving' && '💾 Guardando...'}
            {saveStatus==='saved'  && '✓ Guardado'}
            {saveStatus==='error'  && '✗ Error al guardar'}
          </div>
        </div>

        {/* Conteo de estados */}
        {seccionClientes.length > 0 && (
          <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
            {[
              { key:'verde',   label:'Confirmado', color:'#2ECFAA', bg:'rgba(46,207,170,0.1)',  border:'rgba(46,207,170,0.3)'  },
              { key:'amarillo',label:'Con envíos',  color:'#FBBF24', bg:'rgba(251,191,36,0.1)', border:'rgba(251,191,36,0.3)'  },
              { key:'blanco',  label:'Pendiente',   color:BRAND.muted, bg:'rgba(255,255,255,0.04)', border:'rgba(255,255,255,0.12)' },
              { key:'rojo',    label:'Sin envíos',  color:'#E24B4A', bg:'rgba(226,75,74,0.08)', border:'rgba(226,75,74,0.25)'  },
            ].map(({ key, label, color, bg, border }) => conteoEstados[key] ? (
              <div key={key} onClick={() => setFiltroEstado(filtroEstado === key ? null : key)}
                title={filtroEstado === key ? 'Quitar filtro' : `Ver solo ${label.toLowerCase()}`}
                style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 10px', borderRadius:20, background:bg, border:`1px solid ${filtroEstado === key ? color : border}`, cursor:'pointer', userSelect:'none', opacity: filtroEstado && filtroEstado !== key ? 0.4 : 1, boxShadow: filtroEstado === key ? `0 0 0 1px ${color}` : 'none' }}>
                <span style={{ fontSize:11, fontWeight:700, color }}>{conteoEstados[key]}</span>
                <span style={{ fontSize:11, color }}>{label}</span>
                {filtroEstado === key && <span style={{ fontSize:10, color }}>✕</span>}
              </div>
            ) : null)}
          </div>
        )}

        {/* Table */}
        {order.length === 0 && (filtroEstado || busqueda) ? (
          <div style={{ color:BRAND.muted, padding:'2.5rem', textAlign:'center', fontSize:13 }}>
            Sin resultados con el filtro actual.
            <button onClick={() => { setFiltroEstado(null); setBusqueda(''); }}
              style={{ marginLeft:8, padding:'3px 10px', borderRadius:8, border:`1px solid ${BRAND.teal}`, background:'transparent', color:BRAND.teal, cursor:'pointer', fontSize:12 }}>
              Limpiar filtros
            </button>
          </div>
        ) : (
        <div style={{ overflowX:'auto', borderRadius:10, border:`1px solid ${BRAND.border}`, background:'#1b1e24' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:580 }}>
            <thead>
              <tr style={{ background:'#252932' }}>
                {['','Cliente','Chofer(es)','Dirección','Zona','Hora','$$$'].map((h,i) => (
                  <th key={i} style={{ ...thSt, width:i===0?36:undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map(chofer => {
                const isWarn = chofer === 'A coordinar';
                const rows = groups[chofer];
                const amarillosConf = isWarn ? 0 : seccionClientes.filter(c => {
                  const reg = registros[c.id];
                  const chs = reg?.choferes?.length ? reg.choferes : ['A coordinar'];
                  if (!chs.includes(chofer)) return false;
                  const estEf = (c.fija && (!reg?.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg?.estado || 'blanco');
                  if (estEf === 'rojo' || estEf === 'verde') return false;
                  const isDiv = chs.length > 1 && !chs.every(x => x === 'A coordinar');
                  return !(isDiv && (reg?.confirmado_por || []).includes(chofer));
                }).length;
                const isActive = hoverChofer === chofer || copiedChofer === chofer;
                return (
                  <React.Fragment key={chofer}>
                    {/* Group header */}
                    <tr onMouseEnter={() => setHoverChofer(chofer)} onMouseLeave={() => setHoverChofer(null)}
                      style={{ background: isActive ? 'rgba(46,207,170,0.12)' : (isWarn ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.02)'), transition:'background 0.15s' }}>
                      <td colSpan={7} style={{ padding:'6px 14px', borderBottom:`1px solid ${BRAND.border}`, borderLeft: isWarn ? '3px solid #FBBF24' : `3px solid ${BRAND.teal}` }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                          <span>
                            <span style={{ fontSize:13, fontWeight:500, color:isWarn?'#FBBF24':'rgba(255,255,255,0.85)' }}>
                              {isWarn ? '⚠️ ' : ''}{chofer}
                            </span>
                            <span style={{ fontSize:12, color:isWarn?'rgba(251,191,36,0.7)':BRAND.teal, marginLeft:6 }}>
                              {rows.length}
                            </span>
                          </span>
                          {!isWarn && (
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              {amarillosConf > 0 && (
                                <button onClick={() => confirmarTodos(chofer)} title={`Confirmar las ${amarillosConf} colectas de ${chofer} (pasan a verde; no toca las 'sin envíos')`}
                                  style={{ display:'flex', alignItems:'center', gap:4, height:28, padding:'0 10px', borderRadius:8, border:'1px solid rgba(46,207,170,0.5)', color:'#2ECFAA', background:'rgba(46,207,170,0.1)', fontSize:12, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>
                                  ✓ Todos
                                </button>
                              )}
                            <div style={{ position:'relative', display:'inline-block' }}>
                              <button
                                onClick={() => copyMsg(chofer)}
                                onMouseEnter={e => { const t = e.currentTarget.nextSibling; if(t) t.style.opacity='1'; }}
                                onMouseLeave={e => { const t = e.currentTarget.nextSibling; if(t) t.style.opacity='0'; }}
                                style={{ display:'flex', alignItems:'center', justifyContent:'center', width:28, height:28, borderRadius:8, border:`1px solid ${copiedChofer===chofer?'#2ECFAA':'rgba(46,207,170,0.5)'}`, color:'#2ECFAA', background:copiedChofer===chofer?'rgba(46,207,170,0.2)':'rgba(46,207,170,0.1)', fontSize:14, cursor:'pointer', transition:'all 0.2s' }}>
                                {copiedChofer===chofer ? '✓' : '📱'}
                              </button>
                              <div style={{ opacity:0, transition:'opacity 0.15s', position:'absolute', bottom:'calc(100% + 6px)', right:0, whiteSpace:'nowrap', background:'#1a2e3a', color:'#2ECFAA', fontSize:11, fontWeight:600, padding:'4px 8px', borderRadius:6, border:'1px solid rgba(46,207,170,0.3)', pointerEvents:'none', zIndex:400 }}>
                                Copiar {chofer}
                              </div>
                            </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Data rows */}
                    {rows.map(c => {
                      const reg = registros[c.id] || { choferes:['A coordinar'], estado:'blanco', confirmado_por:[] };
                      const chs = reg.choferes?.length ? reg.choferes : ['A coordinar'];
                      const estado = (c.fija && (!reg.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg.estado || 'blanco');
                      const confirmadoPor = reg.confirmado_por || [];
                      const unassigned = chs.every(x => x === 'A coordinar');
                      const isDividida = chs.length > 1 && !chs.every(x => x === 'A coordinar');

                      const ECOLOR  = { blanco:'transparent', amarillo:'#FBBF24', rojo:'#E24B4A', verde:'#2ECFAA' };
                      const EBORDER = { blanco:'rgba(255,255,255,0.2)', amarillo:'#FBBF24', rojo:'#E24B4A', verde:'#2ECFAA' };
                      const EICON   = { blanco:'', amarillo:'', rojo:'✕', verde:'✓' };

                      // Para divididas: el círculo muestra el estado del chofer de ESTA sección
                      const esteChoferActivo = isDividida && chofer !== 'A coordinar';
                      const esteChoferConfirmado = esteChoferActivo && confirmadoPor.includes(chofer);
                      const circleEstado = esteChoferActivo
                        ? (esteChoferConfirmado ? 'verde' : estado === 'rojo' ? 'rojo' : estado === 'blanco' ? 'blanco' : 'amarillo')
                        : estado;

                      const rowBg = estado==='rojo'?'rgba(226,75,74,0.05)':estado==='verde'?'rgba(46,207,170,0.05)':estado==='amarillo'?'rgba(251,191,36,0.04)':unassigned?'rgba(251,191,36,0.03)':'transparent';

                      const handleCircleClick = () => {
                        if (esteChoferActivo) {
                          // Dividida: click confirma/desconfirma solo este chofer
                          const nuevos = esteChoferConfirmado
                            ? confirmadoPor.filter(x => x !== chofer)
                            : [...confirmadoPor, chofer];
                          const activos = chs.filter(x => x !== 'A coordinar');
                          const todosOk = activos.length > 0 && activos.every(c2 => nuevos.includes(c2));
                          let nuevoEstado = estado;
                          if (todosOk) nuevoEstado = 'verde';
                          else if (estado === 'verde') nuevoEstado = 'amarillo';
                          else if (estado === 'blanco') nuevoEstado = 'amarillo';
                          updateRegistro(c.id, { confirmado_por: nuevos, estado: nuevoEstado });
                        } else {
                          // Normal / unassigned: ciclo de estado
                          const ciclo = unassigned
                            ? { blanco:'amarillo', amarillo:'rojo', rojo:'blanco', verde:'blanco' }
                            : { blanco:'amarillo', amarillo:'verde', verde:'rojo', rojo:'blanco' };
                          const nextEstado = ciclo[estado] || 'blanco';
                          updateRegistro(c.id, { estado: nextEstado, ...(nextEstado === 'blanco' ? { confirmado_por: [] } : {}) });
                        }
                      };

                      return (
                        <tr key={c.id}
                          onMouseEnter={() => setHoverChofer(chofer)} onMouseLeave={() => setHoverChofer(null)}
                          style={{ background: isActive ? 'rgba(46,207,170,0.09)' : rowBg, borderBottom:`1px solid ${BRAND.border}`, opacity:estado==='rojo'?0.6:1, transition:'background 0.15s' }}>
                          {/* Estado */}
                          <td style={{ padding:'8px 8px 8px 10px', width:36 }}>
                            <button
                              onClick={handleCircleClick}
                              title={esteChoferActivo ? `Confirmar ${chofer} (independiente)` : unassigned ? 'blanco → amarillo → cancelado' : 'blanco → amarillo → verde → cancelado'}
                              style={{ width:24, height:24, borderRadius:'50%', border:`2px solid ${EBORDER[circleEstado]}`, background:ECOLOR[circleEstado], cursor:'pointer', color:circleEstado==='verde'?'#0d1b2a':'#fff', fontWeight:700, fontSize:12, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                              {EICON[circleEstado]}
                            </button>
                          </td>
                          {/* Nombre */}
                          <td style={{ padding:'8px 8px', fontWeight:500, fontSize:13, textDecoration:estado==='rojo'?'line-through':'none' }}>
                            {c.nombre}
                            {tab === 'SABADOS' && (
                              <span title={c.seccion==='SABADOS' ? 'Sin zona de semana asignada — editá el cliente para ponerle CABA/SUR/NOROESTE' : `Zona: ${c.seccion}`}
                                style={{ marginLeft:6, fontSize:10, padding:'1px 7px', borderRadius:10, background: c.seccion==='SABADOS' ? 'rgba(251,191,36,0.15)' : 'rgba(58,143,212,0.15)', color: c.seccion==='SABADOS' ? '#FBBF24' : '#3A8FD4' }}>
                                {c.seccion==='SABADOS' ? 'sin zona' : c.seccion}
                              </span>
                            )}
                            {isDividida && (
                              <span style={{ marginLeft:6, fontSize:10, padding:'1px 6px', borderRadius:10, background:'rgba(251,191,36,0.15)', color:'#FBBF24' }}>dividida</span>
                            )}
                          </td>
                          {/* Choferes */}
                          <td style={{ padding:'8px 8px', minWidth:160 }}>
                            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                              {estado === 'rojo' ? (
                                <span style={{ fontSize:11, color:BRAND.muted, fontStyle:'italic' }}>Cancelada</span>
                              ) : (
                              <ChoferPicker
                                chs={chs}
                                choferesList={choferesList}
                                onUpdate={updates => updateRegistro(c.id, updates)}
                                hideChips={!isDividida && chofer !== 'A coordinar'}
                              />
                              )}
                            </div>
                          </td>
                          {/* Dirección — click para poner una dirección puntual de hoy (la fija no se toca) */}
                          <td style={{ padding:'8px 8px', fontSize:12, color:BRAND.muted, maxWidth:210 }}>
                            {dirEdit?.id === c.id ? (
                              <input autoFocus value={dirEdit.valor}
                                onChange={ev => setDirEdit({ id:c.id, valor:ev.target.value })}
                                onKeyDown={ev => { if (ev.key==='Enter') ev.currentTarget.blur(); if (ev.key==='Escape') setDirEdit(null); }}
                                onBlur={() => { const v = dirEdit.valor.trim(); updateRegistro(c.id, { direccion: (v==='' || v===c.direccion) ? null : v }); setDirEdit(null); }}
                                style={{ width:200, background:'#14171c', border:'1px solid #2ECFAA', borderRadius:6, color:'#fff', fontSize:12, padding:'3px 6px' }} />
                            ) : (
                              <span onClick={() => setDirEdit({ id:c.id, valor: reg.direccion || c.direccion || '' })}
                                title={reg.direccion ? `Dirección de hoy · la fija es: ${c.direccion}` : 'Click para una dirección puntual de hoy'}
                                style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5, maxWidth:210, color: reg.direccion ? '#FBBF24' : undefined }}>
                                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{reg.direccion ? '📍 ' : ''}{reg.direccion || c.direccion}</span>
                                {reg.direccion
                                  ? <button onClick={ev => { ev.stopPropagation(); updateRegistro(c.id, { direccion: null }); }} title="Volver a la dirección fija" style={{ border:'none', background:'none', color:BRAND.muted, cursor:'pointer', fontSize:13, padding:0, flexShrink:0 }}>↩</button>
                                  : <i className="ti ti-pencil" style={{ fontSize:12, color:"rgba(255,255,255,0.35)", flexShrink:0 }} />}
                              </span>
                            )}
                          </td>
                          {/* Zona — editable por día (override) */}
                          <td style={{ padding:'8px 8px', maxWidth:150 }}>
                            {zonaEdit?.id === c.id ? (
                              <input autoFocus value={zonaEdit.valor}
                                onChange={ev => setZonaEdit({ id:c.id, valor:ev.target.value })}
                                onKeyDown={ev => { if (ev.key==='Enter') ev.currentTarget.blur(); if (ev.key==='Escape') setZonaEdit(null); }}
                                onBlur={() => { const v = zonaEdit.valor.trim(); updateRegistro(c.id, { zona_barrio: (v==='' || v===(c.zona_barrio||'')) ? null : v }); setZonaEdit(null); }}
                                style={{ width:120, background:'#14171c', border:'1px solid #2ECFAA', borderRadius:6, color:'#fff', fontSize:12, padding:'3px 6px' }} />
                            ) : (
                              <span onClick={() => setZonaEdit({ id:c.id, valor: reg.zona_barrio || c.zona_barrio || '' })}
                                title={reg.zona_barrio ? `Zona de hoy · la fija es: ${c.zona_barrio||'—'}` : 'Click para una zona puntual de hoy'}
                                style={{ cursor:'pointer', display:'inline-flex', alignItems:'center', gap:5 }}>
                                {(reg.zona_barrio || c.zona_barrio)
                                  ? <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, textTransform:'capitalize', background: reg.zona_barrio ? 'rgba(251,191,36,0.15)' : 'rgba(58,143,212,0.15)', color: reg.zona_barrio ? '#FBBF24' : '#3A8FD4' }}>{String(reg.zona_barrio || c.zona_barrio).toLowerCase()}</span>
                                  : <span style={{ fontSize:11, color:BRAND.muted }}>+ zona</span>}
                                {reg.zona_barrio
                                  ? <button onClick={ev => { ev.stopPropagation(); updateRegistro(c.id, { zona_barrio: null }); }} title="Volver a la zona fija" style={{ border:'none', background:'none', color:BRAND.muted, cursor:'pointer', fontSize:13, padding:0 }}>↩</button>
                                  : <i className="ti ti-pencil" style={{ fontSize:11, color:"rgba(255,255,255,0.3)" }} />}
                              </span>
                            )}
                          </td>
                          {/* Hora — horario configurado del cliente (se edita en Clientes) */}
                          <td style={{ padding:'8px 8px', whiteSpace:'nowrap', fontSize:12, color:(c.horario || c.hora_habitual) ? 'rgba(255,255,255,0.75)' : BRAND.muted }}>
                            {c.horario || (c.hora_habitual ? `${c.hora_habitual}:00` : '—')}
                          </td>
                          {/* Monto — click para editar el precio del día (default: monto del cliente) */}
                          <td style={{ padding:'8px 10px 8px 8px', fontWeight:500, fontSize:13, whiteSpace:'nowrap' }}>
                            {montoEdit?.id === c.id ? (
                              <input autoFocus type="number" className="monto-edit" value={montoEdit.valor}
                                onChange={e => setMontoEdit({ id:c.id, valor:e.target.value })}
                                onKeyDown={e => { if (e.key==='Enter') e.currentTarget.blur(); if (e.key==='Escape') setMontoEdit(null); }}
                                onBlur={() => { const v = montoEdit.valor==='' ? null : Number(montoEdit.valor); updateRegistro(c.id, { monto: (v===null || v===Number(c.monto||0)) ? null : v }); setMontoEdit(null); }}
                                style={{ width:80, background:'#14171c', border:'1px solid #2ECFAA', borderRadius:6, color:'#fff', fontSize:13, padding:'3px 6px' }} />
                            ) : (
                              <span onClick={() => setMontoEdit({ id:c.id, valor: (reg.monto ?? c.monto) ?? '' })}
                                title="Click para cambiar el precio de hoy (el predeterminado no se toca)"
                                style={{ cursor:'pointer', color: reg.monto!=null ? '#FBBF24' : undefined, display:'inline-flex', alignItems:'center', gap:5 }}>
                                {fmtMonto(reg.monto ?? c.monto)}
                                <i className="ti ti-pencil" style={{ fontSize:12, color:"rgba(255,255,255,0.35)" }} />
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
      </>
    );
  }

  // ── PAGOS RENDER ──
  function renderPagos() {
    const { label } = getWeekRange(semanaFecha);
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20, flexWrap:'wrap' }}>
          <span style={{ fontSize:13, color:BRAND.muted }}>Semana:</span>
          <input type="date" value={semanaFecha} onChange={e => setSemanaFecha(e.target.value)}
            style={{ ...inpSt, padding:'5px 10px' }} />
          <span style={{ fontSize:13, color:BRAND.teal, fontWeight:600 }}>{label}</span>
        </div>

        {loadingPagos && <div style={{ color:BRAND.muted, padding:'2rem', textAlign:'center' }}>Calculando...</div>}
        {!loadingPagos && pagosData.length === 0 && (
          <div style={{ color:BRAND.muted, padding:'3rem', textAlign:'center' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>💰</div>
            Sin colectas confirmadas para esta semana.
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {pagosData.map(p => (
            <div key={p.cadete} style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:12, padding:'1rem 1.25rem' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:700 }}>{p.cadete}</div>
                  <div style={{ fontSize:12, color:BRAND.muted, marginTop:2 }}>{label}</div>
                </div>
                <div style={{ fontSize:22, fontWeight:700, color:BRAND.teal }}>{fmtMonto(p.monto)}</div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                {[
                  ['Asignadas', p.total, BRAND.white],
                  ['Confirmadas', p.confirmadas, '#2ECFAA'],
                  ['Promedio', p.confirmadas ? fmtMonto(Math.round(p.monto/p.confirmadas)) : '—', BRAND.white],
                ].map(([lbl, val, color]) => (
                  <div key={lbl} style={{ background:BRAND.navyMid, borderRadius:8, padding:'10px', textAlign:'center' }}>
                    <div style={{ fontSize:11, color:BRAND.muted, marginBottom:4 }}>{lbl}</div>
                    <div style={{ fontSize:18, fontWeight:700, color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── CLIENTES RENDER ──
  function renderClientes() {
    const filtrados = clienteFiltroSec === 'todos' ? clientes : clienteFiltroSec === 'SABADOS' ? clientes.filter(c => c.opera_sabados || c.seccion === 'SABADOS') : clientes.filter(c => c.seccion === clienteFiltroSec);

    const tabBtn = active => ({
      padding:'4px 12px', fontSize:12, fontWeight:600, borderRadius:20, cursor:'pointer',
      border:`1px solid ${active?BRAND.teal:BRAND.border}`,
      background:active?'rgba(46,207,170,0.12)':BRAND.faint,
      color:active?BRAND.teal:BRAND.muted,
    });

    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {['todos', ...SECCIONES].map(s => (
              <button key={s} onClick={() => setClienteFiltroSec(s)} style={tabBtn(clienteFiltroSec===s)}>
                {s === 'todos' ? 'Todos' : s}
              </button>
            ))}
          </div>
          <button onClick={() => { setShowForm(true); setEditId(null); setClienteForm(emptyForm); }}
            style={{ marginLeft:'auto', padding:'6px 14px', borderRadius:8, border:`1px solid ${BRAND.teal}`, background:'rgba(46,207,170,0.1)', color:BRAND.teal, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            + Agregar cliente
          </button>
        </div>

        {showForm && (
          <div style={{ background:BRAND.navyCard, border:'1px solid rgba(46,207,170,0.3)', borderRadius:12, padding:'1.25rem', marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>{editId ? 'Editar cliente' : 'Nuevo cliente'}</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:10 }}>
              {[['nombre','Nombre','text'],['direccion','Dirección','text'],['zona_barrio','Zona/Barrio','text'],['horario','Horario (opcional)','time'],['monto','Monto ($)','number']].map(([key,lbl,type]) => (
                <div key={key}>
                  <div style={{ fontSize:11, color:BRAND.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>{lbl}</div>
                  <input type={type} value={clienteForm[key]} onChange={e => setClienteForm(p => ({...p,[key]:e.target.value}))}
                    style={{ ...inpSt, width:'100%' }} placeholder={lbl} />
                </div>
              ))}
              <div>
                <div style={{ fontSize:11, color:BRAND.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Sección</div>
                <select value={clienteForm.seccion} onChange={e => setClienteForm(p => ({...p,seccion:e.target.value}))}
                  style={{ ...inpSt, width:'100%' }}>
                  {SECCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:11, color:BRAND.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Sábados</div>
                <label style={{ ...inpSt, width:'100%', display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={!!clienteForm.opera_sabados}
                    onChange={e => setClienteForm(p => ({...p, opera_sabados: e.target.checked}))}
                    style={{ width:16, height:16, accentColor:'#2ECFAA', cursor:'pointer' }} />
                  <span style={{ fontSize:13, color: clienteForm.opera_sabados ? BRAND.white : BRAND.muted }}>Opera sábados</span>
                </label>
              </div>
              <div>
                <div style={{ fontSize:11, color:BRAND.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Grupo WhatsApp (avisos del bot)</div>
                <select value={clienteForm.chat_id} onChange={e => setClienteForm(p => ({...p,chat_id:e.target.value}))}
                  style={{ ...inpSt, width:'100%' }}>
                  <option value="">— Sin grupo —</option>
                  {gruposWA.map(g => <option key={g.chat_id} value={g.chat_id}>{g.nombre_grupo}{g.cliente ? ` (${g.cliente})` : ''}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={saveCliente}
                style={{ padding:'7px 18px', borderRadius:8, border:'none', background:BRAND.teal, color:'#0d1b2a', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                {editId ? 'Guardar cambios' : 'Agregar'}
              </button>
              <button onClick={() => { setShowForm(false); setEditId(null); }}
                style={{ padding:'7px 14px', borderRadius:8, border:`1px solid ${BRAND.border}`, background:'none', color:BRAND.muted, fontSize:13, cursor:'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div style={{ overflowX:'auto', borderRadius:10, border:`1px solid ${BRAND.border}`, background:'#1b1e24' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:480 }}>
            <thead>
              <tr style={{ background:'#252932' }}>
                {['Cliente / Dirección','Sección','Zona','Monto','Estado',''].map((h,i) => (
                  <th key={i} style={thSt}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(c => (
                <tr key={c.id} style={{ background:BRAND.navy, borderBottom:`1px solid ${BRAND.border}` }}>
                  <td style={{ padding:'8px 12px' }}>
                    <div style={{ fontWeight:500, fontSize:13 }}>{c.nombre}</div>
                    <div style={{ fontSize:11, color:BRAND.muted, marginTop:2 }}>{c.direccion}{c.horario ? ` · 🕐 ${c.horario}` : ''}</div>
                  </td>
                  <td style={{ padding:'8px 12px' }}>
                    <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:'rgba(58,143,212,0.15)', color:'#3A8FD4' }}>{c.seccion}</span>
                    {c.opera_sabados && <span style={{ marginLeft:4, fontSize:10, padding:'2px 6px', borderRadius:20, background:'rgba(251,191,36,0.15)', color:'#FBBF24' }}>🗓️ Sáb</span>}
                  </td>
                  <td style={{ padding:'8px 12px', fontSize:12, color:BRAND.muted }}>{c.zona_barrio||'—'}</td>
                  <td style={{ padding:'8px 12px', fontWeight:500, fontSize:13, whiteSpace:'nowrap' }}>{fmtMonto(c.monto)}</td>
                  <td style={{ padding:'8px 12px' }}>
                    <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:c.activo?'rgba(46,207,170,0.12)':'rgba(255,255,255,0.05)', color:c.activo?'#2ECFAA':BRAND.muted }}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding:'8px 12px' }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={() => toggleFija(c)} title="Colecta fija: arranca todos los días en naranja (Con envíos)"
                        style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${c.fija?'#FBBF24':'rgba(255,255,255,0.15)'}`, background:c.fija?'rgba(251,191,36,0.12)':'none', color:c.fija?'#FBBF24':BRAND.muted, fontSize:11, cursor:'pointer', fontWeight:c.fija?700:400 }}>
                        {c.fija ? '📌 Fija' : '📌 Fijar'}
                      </button>
                      <button onClick={() => editCliente(c)}
                        style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${BRAND.border}`, background:'none', color:BRAND.muted, fontSize:11, cursor:'pointer' }}>
                        Editar
                      </button>
                      <button onClick={() => toggleActivo(c)}
                        style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${c.activo?'rgba(226,75,74,0.3)':'rgba(46,207,170,0.3)'}`, background:'none', color:c.activo?'#E24B4A':'#2ECFAA', fontSize:11, cursor:'pointer' }}>
                        {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} style={{ padding:'2rem', textAlign:'center', color:BRAND.muted }}>Sin clientes para este filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── CHOFERES RENDER ──
  function renderChoferes() {
    return (
      <div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>👤 Choferes disponibles</div>
          <div style={{ fontSize:13, color:BRAND.muted }}>
            Lista que aparece en el selector al asignar colectas.
          </div>
        </div>

        <div style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:12, padding:'1.25rem', marginBottom:16 }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14 }}>
            {choferesList.map(ch => (
              <div key={ch} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:20, background:BRAND.navyMid, border:`1px solid ${BRAND.border}`, fontSize:13 }}>
                <span>👤</span>
                <span>{ch}</span>
                <button onClick={() => setChoferesList(prev => prev.filter(x => x !== ch))}
                  style={{ background:'none', border:'none', color:BRAND.muted, cursor:'pointer', fontSize:14, padding:'0 0 0 4px', lineHeight:1, display:'flex', alignItems:'center' }}>✕</button>
              </div>
            ))}
            {choferesList.length === 0 && (
              <div style={{ color:BRAND.muted, fontSize:13 }}>No hay choferes cargados.</div>
            )}
          </div>

          <form onSubmit={e => {
            e.preventDefault();
            const name = e.target.chofer.value.trim();
            if (name && !choferesList.includes(name)) setChoferesList(prev => [...prev, name]);
            e.target.chofer.value = '';
          }} style={{ display:'flex', gap:8 }}>
            <input name="chofer" placeholder="Nombre del chofer..." style={{ ...inpSt, padding:'7px 12px', flex:1, maxWidth:240 }} />
            <button type="submit"
              style={{ padding:'7px 16px', borderRadius:8, border:`1px solid ${BRAND.teal}`, background:'rgba(46,207,170,0.1)', color:BRAND.teal, cursor:'pointer', fontSize:13, fontWeight:600 }}>
              + Agregar
            </button>
          </form>
        </div>

        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', background:'rgba(255,255,255,0.03)', borderRadius:8, border:`1px solid ${BRAND.border}` }}>
          <span style={{ fontSize:12, color:BRAND.muted }}>💡 Lista sincronizada desde métricas. Podés agregar o quitar choferes manualmente.</span>
          <button onClick={syncChoferes} disabled={syncingChoferes}
            style={{ padding:'5px 12px', borderRadius:8, border:`1px solid ${BRAND.border}`, background:'transparent', color:syncingChoferes ? BRAND.muted : BRAND.teal, cursor:syncingChoferes ? 'default' : 'pointer', fontSize:12, fontWeight:600, whiteSpace:'nowrap', marginLeft:12 }}>
            {syncingChoferes ? 'Sincronizando...' : '↺ Sincronizar desde métricas'}
          </button>
        </div>
      </div>
    );
  }

  // ── ARRIBOS ──
  // Upsert de un campo del arribo (llego_at o eta). PATCH si ya hay fila, POST si no.
  const upsertArribo = async (cadete, patch) => {
    setSaveStatus('saving');
    const existing = arribos[cadete];
    setArribos(prev => ({ ...prev, [cadete]: { ...(prev[cadete] || {}), ...patch } }));
    try {
      if (existing?.id) {
        await sbFetch(`colectas_arribos?id=eq.${existing.id}`, { method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify(patch) });
      } else {
        const res = await sbFetch('colectas_arribos', { method: 'POST', body: JSON.stringify({ fecha, cadete, ...patch }) });
        const row = Array.isArray(res) ? res[0] : res;
        if (row?.id) setArribos(prev => ({ ...prev, [cadete]: { ...(prev[cadete] || {}), id: row.id } }));
      }
      setSaveStatus('saved');
    } catch (e) { setSaveStatus('error'); }
  };

  const toggleLlego = (cadete) => {
    const llego = arribos[cadete]?.llego_at;
    // al confirmar la llegada se borra la hora estimada (ya no hace falta)
    upsertArribo(cadete, llego ? { llego_at: null } : { llego_at: new Date().toISOString(), eta: null });
  };

  const setEta = (cadete, valor) => {
    upsertArribo(cadete, { eta: valor || null });
  };

  function renderArribos() {
    if (loading) return <div style={{ color:BRAND.muted, padding:'3rem', textAlign:'center' }}>Cargando...</div>;
    // Cadetes con al menos una colecta CONFIRMADA hoy
    const map = {};
    Object.values(registros).forEach(r => {
      (r.choferes || []).forEach(ch => {
        if (!ch || ch === 'A coordinar') return;
        const confirmedForCh = r.estado === 'verde' || (r.confirmado_por || []).includes(ch);
        if (!confirmedForCh) return;
        if (!map[ch]) map[ch] = { cadete: ch, confirmadas: 0 };
        map[ch].confirmadas++;
      });
    });
    let lista = Object.values(map);
    const total = lista.length;
    const canon = buildCanonAlias(aliasCadetes);
    const llegados = lista.filter(c => arribos[c.cadete]?.llego_at).length;
    const pct = total ? Math.round(llegados / total * 100) : 0;
    lista.sort((a, b) => {
      const la = !!arribos[a.cadete]?.llego_at, lb = !!arribos[b.cadete]?.llego_at;
      if (la !== lb) return la ? 1 : -1;
      return a.cadete.localeCompare(b.cadete, 'es');
    });
    const q = normNombre(busquedaArribos);
    const listaFiltrada = q ? lista.filter(c => normNombre(c.cadete).includes(q)) : lista;
    const d = new Date(fecha + 'T12:00:00');
    const fechaFmt = d.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
    const faltan = lista.filter(c => !arribos[c.cadete]?.llego_at);

    return (
      <div style={{ maxWidth:560 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:BRAND.muted }}>
            <span>📅</span>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={{ ...inpSt, padding:'5px 10px' }} />
          </div>
          <input type="text" value={busquedaArribos} onChange={e => setBusquedaArribos(e.target.value)}
            placeholder="🔍 Buscar cadete..." style={{ ...inpSt, padding:'5px 10px', width:180 }} />
          {saveStatus === 'error' && (
            <div style={{ fontSize:12, marginTop:2, color:'#E24B4A' }}>✗ Error al guardar</div>
          )}
        </div>

        {total === 0 ? (
          <div style={{ color:BRAND.muted, padding:'3rem', textAlign:'center' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🚚</div>
            <div>No hay cadetes con colectas confirmadas para {fechaFmt}.</div>
            <div style={{ fontSize:12, marginTop:6 }}>Confirmá colectas (círculo verde) en Colectas y aparecen acá para marcar su llegada.</div>
          </div>
        ) : (
          <>
            <div style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:12, padding:'16px 18px', marginBottom:16 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10 }}>
                <span style={{ fontSize:14, fontWeight:600, color:BRAND.white }}>{llegados} de {total} cadetes llegaron</span>
                <span style={{ fontSize:24, fontWeight:800, color: pct===100 ? '#2ECFAA' : '#FBBF24' }}>{pct}%</span>
              </div>
              <div style={{ height:12, borderRadius:20, background:'rgba(255,255,255,0.08)', overflow:'hidden' }}>
                <div style={{ width:`${pct}%`, height:'100%', borderRadius:20, background: pct===100 ? '#2ECFAA' : 'linear-gradient(90deg,#FBBF24,#2ECFAA)', transition:'width 0.3s' }} />
              </div>
              {faltan.length > 0 && (
                <div style={{ fontSize:12, color:BRAND.muted, marginTop:10 }}>
                  <b style={{ color:'#FBBF24' }}>Faltan {faltan.length}:</b> {faltan.map(c => c.cadete).join(', ')}
                </div>
              )}
              {faltan.length === 0 && (
                <div style={{ fontSize:12, color:'#2ECFAA', marginTop:10, fontWeight:600 }}>✓ Llegaron todos 🎉</div>
              )}
            </div>

            {listaFiltrada.length === 0 && (
              <div style={{ color:BRAND.muted, padding:'2rem', textAlign:'center', fontSize:13 }}>
                Ningún cadete coincide con "{busquedaArribos}".
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {listaFiltrada.map(c => {
                const ar = arribos[c.cadete] || {};
                const llego = !!ar.llego_at;
                const hora = ar.llego_at ? new Date(ar.llego_at).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' }) : null;
                const eta = ar.eta ? String(ar.eta).slice(0,5) : '';
                return (
                  <div key={c.cadete}
                    style={{ display:'flex', alignItems:'center', gap:10, padding:'12px 14px', borderRadius:12, width:'100%',
                      border:`1px solid ${llego ? 'rgba(46,207,170,0.4)' : BRAND.border}`, background: llego ? 'rgba(46,207,170,0.08)' : BRAND.faint, transition:'all 0.15s' }}>
                    <div onClick={() => toggleLlego(c.cadete)} style={{ display:'flex', alignItems:'center', gap:12, flex:1, minWidth:0, cursor:'pointer' }}>
                      <div style={{ width:32, height:32, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center',
                        border:`2px solid ${llego ? '#2ECFAA' : 'rgba(255,255,255,0.3)'}`, background: llego ? '#2ECFAA' : 'transparent', color:'#0d1b2a', fontWeight:800, fontSize:17 }}>
                        {llego ? '✓' : ''}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:15, fontWeight:600, color: llego ? BRAND.white : 'rgba(255,255,255,0.9)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.cadete}</div>
                        <div style={{ fontSize:12, color: llego ? '#2ECFAA' : BRAND.muted }}>
                          {llego ? `llegó ${hora}` : `${c.confirmadas} colecta${c.confirmadas>1?'s':''}`}
                        </div>
                      </div>
                    </div>

                    <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:6, flexShrink:0 }}>
                      {/* Slot central de ancho fijo para la hora estimada: nada se desplaza al cargarla */}
                      <div style={{ width:118, display:'flex', alignItems:'center', justifyContent:'center', gap:5, flexShrink:0 }}>
                        <EtaInput value={eta} onChange={v => setEta(c.cadete, v)}
                          editing={etaEdit === c.cadete} onEditingChange={v => setEtaEdit(v ? c.cadete : null)} />
                        {eta && etaEdit !== c.cadete && (
                          <button onClick={() => setEta(c.cadete, '')} title="Restablecer hora"
                            style={{ width:26, height:26, borderRadius:8, border:`1px solid ${BRAND.border}`, background:BRAND.faint, color:BRAND.muted, fontSize:12, cursor:'pointer', lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
                        )}
                      </div>
                      {(() => {
                        const key = canon(c.cadete);
                        const cantidad = colectaLD.porChofer[key];
                        if (cantidad === undefined) return null;
                        return (
                          <div title="Envíos de colecta hoy (Informes → Colecta de LightData)"
                            style={{ display:'flex', alignItems:'center', gap:3, height:26, padding:'0 8px', borderRadius:14, border:'1px solid rgba(46,207,170,0.4)', background:'rgba(46,207,170,0.1)', color:'#2ECFAA', fontSize:12, fontWeight:700 }}>
                            📦 {cantidad}
                          </div>
                        );
                      })()}
                      {/* Botón reloj fijo a la derecha del paquete: abre la edición de hora estimada */}
                      <button onClick={() => setEtaEdit(c.cadete)}
                        title={eta ? `Hora estimada ${eta} · tocar para editar` : 'Poner hora estimada'}
                        style={{ width:28, height:28, borderRadius:8, border:`1px solid ${BRAND.border}`, background:BRAND.faint, color:BRAND.muted, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>🕐</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── SIDEBAR CONFIG ──
  const sidebarItems = [
    { section: 'OPERACIÓN', items: [
      { id: 'colectas', icon: '📦', label: 'Colectas' },
      { id: 'pagos',    icon: '💰', label: 'Pagos' },
    ]},
    { section: 'CONFIG', items: [
      { id: 'clientes', icon: '📋', label: 'Clientes' },
      { id: 'choferes', icon: '👤', label: 'Choferes' },
    ]},
  ];

  // Zone tabs (solo cuando navView === 'colectas')
  const zoneTabs = (
    <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:`1px solid ${BRAND.border}` }}>
      {SECCIONES.map(s => {
        const active = tab === s;
        const sinConfirmar = clientes.filter(c => c.activo && (s === 'SABADOS' ? (c.opera_sabados || c.seccion === 'SABADOS') : c.seccion === s)).filter(c => {
          const reg = registros[c.id];
          const estEf = (c.fija && (!reg?.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg?.estado || 'blanco');
          return estEf === 'amarillo';
        }).length;
        return (
          <button key={s} onClick={() => setTab(s)} style={{
            padding:'8px 18px', fontSize:13, fontWeight:600, cursor:'pointer', border:'none',
            background:'transparent', color: active ? BRAND.teal : BRAND.muted,
            borderBottom: active ? `2px solid ${BRAND.teal}` : '2px solid transparent',
            marginBottom:-1, transition:'color 0.15s', display:'inline-flex', alignItems:'center', gap:6,
          }}>
            {s}
            {sinConfirmar > 0 && (
              <span title={`${sinConfirmar} con envíos sin confirmar`}
                style={{ fontSize:10, fontWeight:700, minWidth:16, height:16, padding:'0 5px', borderRadius:10, background:'rgba(251,191,36,0.18)', color:'#FBBF24', border:'1px solid rgba(251,191,36,0.4)', display:'inline-flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>
                {sinConfirmar}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  const viewTitles = {
    colectas: 'Colectas',
    arribos: 'Arribos de cadetes',
    pagos: 'Pagos a cadetes',
    clientes: 'Clientes',
    choferes: 'Choferes',
  };

  // ── MAIN RENDER ──
  if (soloArribos) {
    return (
      <div>
        {error && (
          <div style={{ background:'rgba(226,75,74,0.15)', color:'#E24B4A', border:'1px solid rgba(226,75,74,0.3)', padding:'10px 14px', borderRadius:8, fontSize:13, marginBottom:'1rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            {error}
            <button onClick={() => setError('')} style={{ background:'none', border:'none', color:'#E24B4A', cursor:'pointer', fontSize:16 }}>✕</button>
          </div>
        )}
        {renderArribos()}
      </div>
    );
  }
  return (
    <div style={{ display:'flex', gap:0, minHeight:'60vh', borderRadius:14, overflow:'hidden', border:`1px solid ${BRAND.border}` }}>

      {/* SIDEBAR */}
      <div style={{
        width:152, flexShrink:0, background:BRAND.navySide,
        borderRight:`1px solid ${BRAND.border}`,
        padding:'18px 0',
        display:'flex', flexDirection:'column', gap:0,
      }}>
        {sidebarItems.map(group => (
          <div key={group.section} style={{ marginBottom:8 }}>
            <div style={{
              fontSize:10, fontWeight:700, letterSpacing:'0.1em',
              color:'rgba(255,255,255,0.22)', padding:'0 14px 6px',
              textTransform:'uppercase',
            }}>
              {group.section}
            </div>
            {group.items.map(item => {
              const active = navView === item.id;
              return (
                <button key={item.id} onClick={() => setNavView(item.id)} style={{
                  display:'flex', alignItems:'center', gap:8,
                  width:'100%', padding:'8px 14px', border:'none', cursor:'pointer',
                  background: active ? 'rgba(46,207,170,0.1)' : 'transparent',
                  color: active ? BRAND.teal : BRAND.muted,
                  fontSize:13, fontWeight: active ? 600 : 400,
                  borderLeft: active ? `2px solid ${BRAND.teal}` : '2px solid transparent',
                  textAlign:'left', transition:'all 0.15s',
                }}>
                  <span style={{ fontSize:14 }}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex:1, padding:'20px 24px', background:BRAND.navy, minWidth:0 }}>
        <div style={{ fontSize:16, fontWeight:700, letterSpacing:'-0.01em', marginBottom:16, color:BRAND.white }}>
          {viewTitles[navView]}
        </div>

        {error && (
          <div style={{ background:'rgba(226,75,74,0.15)', color:'#E24B4A', border:'1px solid rgba(226,75,74,0.3)', padding:'10px 14px', borderRadius:8, fontSize:13, marginBottom:'1rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            {error}
            <button onClick={() => setError('')} style={{ background:'none', border:'none', color:'#E24B4A', cursor:'pointer', fontSize:16 }}>✕</button>
          </div>
        )}

        {navView === 'colectas' && <>{zoneTabs}{renderZona()}</>}
        {navView === 'arribos'  && renderArribos()}
        {navView === 'pagos'    && renderPagos()}
        {navView === 'clientes' && renderClientes()}
        {navView === 'choferes' && renderChoferes()}
      </div>
    </div>
  );
}

export default function Colectas({ soloArribos = false }) {
  const [usuario, setUsuario] = useState(() => (getSession() || {}).nombre || '');
  if (!usuario) return <LoginColectas onOk={setUsuario} />;
  return <ColectasInner soloArribos={soloArribos} />;
}
