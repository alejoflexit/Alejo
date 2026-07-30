// Piezas compartidas entre Colectas (Colectas.js), la vista Mapa (ColectasMapa.js) y la Pizarra (Pizarra.js).
// Viven acá para no duplicarlas en copias que después divergen.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { login, authedFetch, getToken, getSession } from './auth';

export const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
export const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

export async function sbFetch(path, options = {}) {
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

export function todayStr() {
  // fecha calendario en Argentina (UTC-3, sin DST) — evita saltar al día siguiente después de las 21hs
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Minutos transcurridos del día en hora AR (0..1439). Mismo criterio que todayStr().
export function minutosAR(ts = Date.now()) {
  const d = new Date(ts - 3 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export const BRAND = {
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

// Vehículo que necesita la colecta de ese cliente — atributo FIJO del cliente (como el horario).
// NULL = sin definir: no se muestra emoji en la tabla y el pin del mapa cae al genérico 📦.
export const VEHICULOS = {
  moto:   { emoji: '🏍️', label: 'Moto' },
  auto:   { emoji: '🚗', label: 'Auto' },
  kangoo: { emoji: '🚐', label: 'Kangoo' },
};

// Normaliza nombres de LightData para matchear (doble espacio, tildes, mayúsculas)
export function normNombre(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Estado efectivo de un cliente en un día: los fijos sin estado cuentan como amarillo.
export function estadoEfectivo(cliente, reg) {
  return (cliente.fija && (!reg?.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg?.estado || 'blanco');
}

// ── CHOFER PICKER ──
// abrirArriba: el desplegable se abre hacia ARRIBA. Necesario cuando el picker vive al pie de
// un panel flotante (el mapa): abriéndose hacia abajo queda fuera de la pantalla y parece que el
// botón no hace nada.
export function ChoferPicker({ chs, choferesList, onUpdate, hideChips, abrirArriba }) {
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
    }
    next = [...new Set(next)]; // nunca el mismo chofer dos veces (cobraría doble la colecta)
    if (!next.length) next = ['A coordinar'];
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
        <div style={{ position: 'absolute', ...(abrirArriba ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }), left: 0, zIndex: 300, width: 210, background: '#162d42', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.55)' }}>
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

// ── CHOFERES ──
// Lista completa para los selectores: LightData + manuales, deduplicada por nombre NORMALIZADO
// (minúsculas, sin tildes, sin dobles espacios) — evita la "doble Analia" cuando el manual y el
// de LightData difieren solo en mayúsculas/tildes. Si hay match, gana el nombre de LightData.
export function mergeChoferes(choferesList, choferesManuales) {
  const ldNorm = new Set((choferesList || []).map(normNombre));
  const manualesVisibles = (choferesManuales || []).filter(m => !ldNorm.has(normNombre(m)));
  return [...new Set([...(choferesList || []), ...manualesVisibles])].sort((a, b) => a.localeCompare(b, 'es'));
}

// Trae la lista de cadetes ya mergeada (para vistas que no manejan el ABM de choferes).
export async function cargarChoferesFull() {
  const [semanas, manuales] = await Promise.all([
    sbFetch('semanas?select=cadete&order=fecha.desc&limit=5000').catch(() => []),
    sbFetch('colectas_choferes_manuales?select=nombre&order=nombre.asc').catch(() => []),
  ]);
  const ld = [...new Set(semanas.map(r => r.cadete).filter(n => n && !n.includes('⚠️')))].sort();
  return mergeChoferes(ld, manuales.map(r => r.nombre).filter(Boolean));
}

// ── LOGIN ──
// Pantalla de ingreso compartida (Colectas, Arribos, Pizarra). onOk recibe el nombre del usuario.
export function LoginFlexit({ titulo, subtitulo, icono, onOk }) {
  const [em, setEm] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const inp = { width: '100%', padding: '12px 14px', borderRadius: 12, border: `1px solid ${err ? '#FF5C5C' : 'rgba(255,255,255,0.18)'}`, background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: 15, boxSizing: 'border-box', outline: 'none' };
  return (
    <div style={{ minHeight: '62vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 400, maxWidth: '94vw', padding: '36px 32px', borderRadius: 22, border: '1px solid rgba(46,207,170,0.22)', background: 'linear-gradient(165deg, rgba(46,207,170,0.09), rgba(58,143,212,0.06) 55%, rgba(255,255,255,0.02))', textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>{icono || '📦'}</div>
        <div style={{ fontSize: 20, fontWeight: 800 }}>{titulo}</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 4, marginBottom: 22 }}>{subtitulo || 'Ingresá con tu usuario del equipo'}</div>
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

// ── NOTAS OPERATIVAS (Pizarra) ──
// Notas ancladas a un día de operación. Se muestran solas donde importan: la Pizarra las lista
// todas y Colectas/Arribos levantan una franja con las del día (ver spec-pizarra-operativa).
export const NOTA_TIPOS = {
  ausencia: { emoji: '🚫', label: 'Ausencia' },
  colecta:  { emoji: '📦', label: 'Colecta'  },
  aviso:    { emoji: '📌', label: 'Aviso'    },
};

const DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

// Suma/resta días a una fecha 'YYYY-MM-DD' sin pasar por husos horarios.
export function sumarDias(fechaStr, n) {
  const d = new Date(fechaStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// "hoy" / "mañana" / "jueves" (dentro de la semana) / "12/08"
export function labelDia(fechaStr, hoy = todayStr()) {
  if (fechaStr === hoy) return 'hoy';
  if (fechaStr === sumarDias(hoy, 1)) return 'mañana';
  if (fechaStr === sumarDias(hoy, -1)) return 'ayer';
  const d = new Date(fechaStr + 'T12:00:00');
  const diff = Math.round((d - new Date(hoy + 'T12:00:00')) / 86400000);
  if (diff > 0 && diff < 7) return DIAS[d.getDay()];
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
}

// Dónde va a aparecer la nota, en una sola frase uniforme.
// sinDia=true omite el día: lo usa el tablero, donde la columna ya lo dice.
export function destinoLabel(nota, clientesById, hoy = todayStr(), sinDia = false) {
  const cola = sinDia ? '' : ` › ${labelDia(nota.fecha_objetivo, hoy)}`;
  if (nota.tipo === 'ausencia') return `Colectas${cola}`;
  if (nota.tipo === 'colecta') {
    const cli = nota.cliente_id && clientesById ? clientesById[nota.cliente_id] : null;
    return cli ? `Colectas › ${cli}${cola}` : `Colectas${cola}`;
  }
  return sinDia ? 'Pizarra' : `Pizarra${cola}`;
}

export const hhmmAMin = h => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

// Vencida = sin resolver y (su día ya pasó, o es de hoy con hora límite cumplida).
export function estaVencida(nota, hoy = todayStr(), minAhora = minutosAR()) {
  if (nota.resuelta_at) return false;
  if (nota.fecha_objetivo < hoy) return true;
  if (nota.fecha_objetivo === hoy && nota.hora_limite) {
    const m = hhmmAMin(nota.hora_limite);
    return m != null && m < minAhora;
  }
  return false;
}

// Orden dentro de un día: ⚡ Ahora primero → ⏰ por hora límite ascendente → normales.
// Empates por hora de creación. El orden nunca contradice la urgencia.
export function ordenarNotas(notas) {
  const rank = n => (n.prioridad === 'ahora' ? 0 : n.prioridad === 'hora' ? 1 : 2);
  return [...notas].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 1) {
      const ma = hhmmAMin(a.hora_limite) ?? 9999, mb = hhmmAMin(b.hora_limite) ?? 9999;
      if (ma !== mb) return ma - mb;
    }
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
}

// Notas que trae la vista: todas las pendientes (de cualquier día) + las resueltas de hoy.
export function cargarNotas(hoy = todayStr()) {
  return sbFetch(`notas_operativas?select=*&or=(resuelta_at.is.null,fecha_objetivo.eq.${hoy})&order=created_at.asc`);
}

export function patchNota(id, patch) {
  return sbFetch(`notas_operativas?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export const resolverNota = (id, quien, extra = {}) =>
  patchNota(id, { resuelta_por: quien, resuelta_at: new Date().toISOString(), ...extra });

// Volver atrás una nota marcada por error. Se conserva el reemplazo cargado (si lo había).
export const desmarcarNota = (id) =>
  patchNota(id, { resuelta_por: null, resuelta_at: null });

export const borrarNota = (id) =>
  sbFetch(`notas_operativas?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });

export const posponerNota = (nota) =>
  patchNota(nota.id, { fecha_objetivo: sumarDias(nota.fecha_objetivo, 1) });

// Editar el texto/tipo de una nota (solo el autor, desde la Pizarra). Al cambiar el tipo se
// limpian los campos que ya no aplican (un aviso no tiene cadete ni cliente ni reemplazo).
export function editarNota(id, { texto, tipo }) {
  const patch = { texto };
  if (tipo) {
    patch.tipo = tipo;
    if (tipo !== 'colecta') patch.cliente_id = null;
    if (tipo !== 'ausencia') { patch.cadete = null; patch.cubre = null; }
  }
  return patchNota(id, patch);
}

// ── COMENTARIOS de una nota (hilo corto del equipo) ──
export const cargarComentarios = () =>
  sbFetch('nota_comentarios?select=*&order=created_at.asc');
export const agregarComentario = (notaId, autor, texto) =>
  sbFetch('nota_comentarios', { method: 'POST', body: JSON.stringify({ nota_id: notaId, autor, texto }) });
export const borrarComentario = (id) =>
  sbFetch(`nota_comentarios?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });

// Suscripción a los comentarios (mismo patrón que las notas).
export function useComentariosRealtime(onRow, activo = true) {
  const cb = useRef(onRow);
  useEffect(() => { cb.current = onRow; });
  useEffect(() => {
    if (!activo || !window.supabase) return;
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
      channel = client.channel('comentarios-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'nota_comentarios' }, payload => {
          cb.current(payload.eventType === 'DELETE' ? payload.old : payload.new, payload.eventType);
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
  }, [activo]);
}

// Suscripción a los cambios de notas_operativas. Mismo patrón que colectas_registros/colectas_arribos:
// cliente propio con el JWT del usuario y reconexión ante corte de red o token vencido.
export function useNotasRealtime(onRow, activo = true) {
  const cb = useRef(onRow);
  useEffect(() => { cb.current = onRow; }, [onRow]);
  useEffect(() => {
    if (!activo || typeof window === 'undefined' || !window.supabase) return;
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
      channel = client.channel('notas-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notas_operativas' }, payload => {
          cb.current(payload.eventType === 'DELETE' ? payload.old : payload.new, payload.eventType);
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
  }, [activo]);
}

// ── OBJETIVOS DEL EQUIPO ──
// Lista para tachar, compartida y SIN dueño. A diferencia de las notas, un objetivo NO está
// anclado a un día: vive en el tablero hasta que alguien lo marca. Por eso vive en su propia
// tabla (objetivos_equipo) en vez de ser un tipo más de nota — el modelo de la nota gira
// alrededor de `fecha_objetivo` (columnas por día, "→ Mañana", vencidas) y acá eso no aplica.
export function cargarObjetivos() {
  return sbFetch('objetivos_equipo?select=*&order=orden.asc,created_at.asc');
}

export function crearObjetivo(texto, autor) {
  return sbFetch('objetivos_equipo', { method: 'POST', body: JSON.stringify({ texto, autor: autor || null }) });
}

export function patchObjetivo(id, patch) {
  return sbFetch(`objetivos_equipo?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export const marcarObjetivo = (id, quien) =>
  patchObjetivo(id, { hecho_at: new Date().toISOString(), hecho_por: quien || null });

export const desmarcarObjetivo = (id) =>
  patchObjetivo(id, { hecho_at: null, hecho_por: null });

export const borrarObjetivo = (id) =>
  sbFetch(`objetivos_equipo?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });

// Suscripción a objetivos_equipo — mismo patrón que las notas (cliente propio con el JWT y
// reintento ante corte). Sin esto, dos personas tachando a la vez se pisan.
export function useObjetivosRealtime(onRow, activo = true) {
  const cb = useRef(onRow);
  useEffect(() => { cb.current = onRow; }, [onRow]);
  useEffect(() => {
    if (!activo || typeof window === 'undefined' || !window.supabase) return;
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
      channel = client.channel('objetivos-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'objetivos_equipo' }, payload => {
          cb.current(payload.eventType === 'DELETE' ? payload.old : payload.new, payload.eventType);
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
  }, [activo]);
}

// Aplica un cambio de realtime sobre el array de notas en memoria.
export function aplicarCambioNota(prev, row, evento) {
  if (!row || !row.id) return prev;
  if (evento === 'DELETE') return prev.filter(n => n.id !== row.id);
  const i = prev.findIndex(n => n.id === row.id);
  if (i === -1) return [...prev, row];
  const next = [...prev];
  next[i] = { ...next[i], ...row };
  return next;
}

// El merge por id no tiene nada de específico de las notas: los objetivos usan el mismo.
export const aplicarCambioObjetivo = aplicarCambioNota;

// ── BACKUPS del equipo ──
// Lista persistente (no se borra sola) de refuerzos: zona a cubrir, quién la cubre y si está confirmado.
// Típico de los lunes (día pico): "sumamos una moto en La Lucila". Vive plegado en la Pizarra.
export function cargarBackups() {
  return sbFetch('backups_equipo?select=*&order=orden.asc,created_at.asc');
}
export function crearBackup(zona, autor) {
  return sbFetch('backups_equipo', { method: 'POST', body: JSON.stringify({ zona, autor: autor || null }) });
}
export function patchBackup(id, patch) {
  return sbFetch(`backups_equipo?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export const borrarBackup = (id) =>
  sbFetch(`backups_equipo?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });

// Presencia en vivo: quién tiene la Pizarra abierta ahora. Usa el canal de presence de Supabase
// Realtime (efímero, no toca la base). Devuelve la lista de nombres únicos conectados.
export function usePresencia(nombre, activo = true) {
  const [online, setOnline] = useState([]);
  useEffect(() => {
    if (!activo || typeof window === 'undefined' || !window.supabase || !nombre) return;
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
      channel = client.channel('pizarra-presencia', { config: { presence: { key: nombre } } });
      channel.on('presence', { event: 'sync' }, () => {
        const st = channel.presenceState();
        const nombres = [...new Set(Object.values(st).flat().map(p => p.nombre).filter(Boolean))];
        setOnline(nombres);
      }).subscribe(async status => {
        if (status === 'SUBSCRIBED') { try { await channel.track({ nombre, at: Date.now() }); } catch {} }
        else if (!cancelled && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { cleanup(); connect(); }, 5000);
        }
      });
    };
    connect();
    return () => { cancelled = true; clearTimeout(retryTimer); cleanup(); };
  }, [nombre, activo]);
  return online;
}

export function useBackupsRealtime(onRow, activo = true) {
  const cb = useRef(onRow);
  useEffect(() => { cb.current = onRow; }, [onRow]);
  useEffect(() => {
    if (!activo || typeof window === 'undefined' || !window.supabase) return;
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
      channel = client.channel('backups-rt')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'backups_equipo' }, payload => {
          cb.current(payload.eventType === 'DELETE' ? payload.old : payload.new, payload.eventType);
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
  }, [activo]);
}

// ── FRANJA "Notas para hoy" (Tarea 2 de la spec) ──
// La pizarra viene a buscar al que está trabajando: se muestra arriba de Colectas y Arribos con las
// notas cuyo día objetivo es la fecha vigente, y se resuelven ahí mismo (✓ Hecho / → Mañana) sin
// cambiar de pantalla. Reusa los helpers de la pizarra — misma tabla.
// Qué tipos entran en cada franja (decisión de Alejo 29/07): los 📌 AVISOS viven SOLO en la Pizarra.
//   Colectas → colecta + ausencia · Arribos → solo ausencia.
export function NotasHoy({ fecha, soloAusencias = false, irAPizarra }) {
  const [notas, setNotas] = useState([]);
  const usuario = (getSession() || {}).nombre || '';
  const aplica = n => soloAusencias ? n.tipo === 'ausencia' : (n.tipo === 'colecta' || n.tipo === 'ausencia');

  const recargar = useCallback(() => {
    // Pendientes cuyo día objetivo es la fecha vigente (las resueltas no se muestran acá).
    sbFetch(`notas_operativas?select=*&resuelta_at=is.null&fecha_objetivo=eq.${fecha}`)
      .then(rows => setNotas(Array.isArray(rows) ? rows : []))
      .catch(() => {});
  }, [fecha]);

  useEffect(() => { recargar(); }, [recargar]);
  // Realtime: cuando alguien crea/resuelve/mueve una nota, la franja se actualiza sola.
  useNotasRealtime(useCallback((row, ev) => {
    setNotas(prev => aplicarCambioNota(prev, row, ev).filter(n => n.fecha_objetivo === fecha && !n.resuelta_at));
  }, [fecha]));

  const visibles = ordenarNotas(notas.filter(n => !n.resuelta_at && aplica(n)));
  if (!visibles.length) return null;

  const quitar = id => setNotas(prev => prev.filter(n => n.id !== id));
  const hacer = n => { quitar(n.id); resolverNota(n.id, usuario).catch(recargar); };
  const mover = n => { quitar(n.id); posponerNota(n).catch(recargar); };

  return (
    <div style={{ marginBottom: 14, padding: '11px 14px', borderRadius: 12, border: '1px solid rgba(251,191,36,0.35)', background: 'rgba(251,191,36,0.07)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#FBBF24' }}>📋 {soloAusencias ? 'Ausencias de hoy' : 'Notas para hoy'} ({visibles.length})</span>
        {irAPizarra && <button onClick={irAPizarra} style={{ marginLeft: 'auto', border: 'none', background: 'none', color: BRAND.teal, cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Abrir pizarra →</button>}
      </div>
      {visibles.map(n => {
        const t = NOTA_TIPOS[n.tipo] || {};
        const urgente = n.prioridad === 'ahora';
        const conHora = n.prioridad === 'hora' && n.hora_limite;
        return (
          <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ fontSize: 14 }}>{t.emoji}</span>
            <div style={{ flex: 1, minWidth: 150, fontSize: 13, color: '#fff' }}>
              {urgente && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#fff', background: '#E24B4A', borderRadius: 5, padding: '1px 6px', marginRight: 6 }}>⚡ AHORA</span>}
              {conHora && <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1a1500', background: '#FBBF24', borderRadius: 5, padding: '1px 6px', marginRight: 6 }}>⏰ {n.hora_limite}</span>}
              {n.texto}
              {n.tipo === 'ausencia' && n.cubre && <span style={{ color: BRAND.teal, fontWeight: 600 }}> · cubre {n.cubre}</span>}
              <span style={{ display: 'block', fontSize: 11, color: BRAND.muted, marginTop: 1 }}>{n.autor}</span>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => hacer(n)} style={{ minHeight: 32, border: '1px solid rgba(46,207,170,0.45)', background: 'rgba(46,207,170,0.1)', color: BRAND.teal, borderRadius: 8, padding: '0 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>✓ Hecho</button>
              {n.tipo !== 'ausencia' && <button onClick={() => mover(n)} title="Posponer a mañana" style={{ minHeight: 32, border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: '#fff', borderRadius: 8, padding: '0 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>→ Mañana</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
