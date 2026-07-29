// src/Pizarra.js — Pizarra operativa: cola de notas ancladas a la operación (ver spec-pizarra-operativa).
// No es un chat: cada nota tiene un día en que IMPORTA y aparece sola donde corresponde
// (franja en Colectas / Arribos). Acá se crean, se ordenan por urgencia y se resuelven.
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getSession } from './auth';
import {
  BRAND, sbFetch, todayStr, minutosAR, sumarDias, labelDia, destinoLabel,
  NOTA_TIPOS, ordenarNotas, estaVencida, cargarNotas, resolverNota,
  cargarChoferesFull, useNotasRealtime, aplicarCambioNota, LoginFlexit,
} from './colectasShared';

const ROJO = '#E24B4A';
const AMBAR = '#FBBF24';

const inpSt = {
  padding: '10px 12px', borderRadius: 10, border: `1px solid ${BRAND.border}`,
  background: 'rgba(0,0,0,0.25)', color: BRAND.white, fontSize: 14, outline: 'none',
  boxSizing: 'border-box',
};

// Chip de opción. Targets ≥32px: es un tap, nunca un long-press (iPhone es dispositivo de campo).
function Chip({ activo, onClick, children, color }) {
  const c = color || BRAND.teal;
  return (
    <button type="button" onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, minHeight: 34, padding: '0 12px',
        borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 600, touchAction: 'manipulation',
        border: `1px solid ${activo ? c : BRAND.border}`,
        background: activo ? `${c}1f` : BRAND.faint,
        color: activo ? c : BRAND.muted, whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}

function FilaChips({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', width: 72, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}

// Selector de hora con máscara manual (mismo criterio que la ETA de Arribos: el <input type="time">
// nativo se ve mal o no abre en Firefox y en varios móviles).
function SelectorHora({ valor, onElegir, onCerrar }) {
  const [text, setText] = useState(valor || '');
  const ref = useRef(null);
  useEffect(() => { if (ref.current) { ref.current.focus(); ref.current.select(); } }, []);

  const commit = (t) => {
    const cand = /^\d{1,2}$/.test(t) ? `${t.padStart(2, '0')}:00` : t;
    const m = /^(\d{2}):(\d{2})$/.exec(cand);
    if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) { onElegir(cand); return true; }
    return false;
  };

  return (
    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, padding: 12, borderRadius: 12, border: `1px solid ${AMBAR}55`, background: BRAND.navyCard, boxShadow: '0 12px 34px rgba(0,0,0,0.55)', width: 232 }}>
      <div style={{ fontSize: 11.5, color: BRAND.muted, marginBottom: 8 }}>Antes de las…</div>
      <input ref={ref} type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={text}
        onChange={e => {
          const d = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
          setText(d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(text); }
          if (e.key === 'Escape') onCerrar();
        }}
        style={{ ...inpSt, width: '100%', fontSize: 18, fontWeight: 700, textAlign: 'center', letterSpacing: '0.06em' }} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {['12:00', '15:00', '18:00', '21:00'].map(h => (
          <button key={h} type="button" onClick={() => onElegir(h)}
            style={{ minHeight: 32, padding: '0 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, touchAction: 'manipulation', border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: BRAND.muted }}>
            {h}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <button type="button" onClick={() => { if (!commit(text)) onCerrar(); }}
          style={{ flex: 1, minHeight: 34, borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700, touchAction: 'manipulation', border: `1px solid ${AMBAR}`, background: `${AMBAR}22`, color: AMBAR }}>Listo</button>
        <button type="button" onClick={onCerrar}
          style={{ minHeight: 34, padding: '0 12px', borderRadius: 9, cursor: 'pointer', fontSize: 13, touchAction: 'manipulation', border: `1px solid ${BRAND.border}`, background: 'transparent', color: BRAND.muted }}>✕</button>
      </div>
    </div>
  );
}

// ── CREADOR ──
function Creador({ autor, choferes, clientes, onPublicar }) {
  const hoy = todayStr();
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState('aviso');
  const [cuando, setCuando] = useState('hoy');       // 'hoy' | 'manana' | 'fecha'
  const [fechaLibre, setFechaLibre] = useState('');
  const [prioridad, setPrioridad] = useState('normal');
  const [hora, setHora] = useState('');
  const [horaOpen, setHoraOpen] = useState(false);
  const [cadete, setCadete] = useState('');
  const [cubre, setCubre] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState('');

  const fechaObjetivo = cuando === 'hoy' ? hoy : cuando === 'manana' ? sumarDias(hoy, 1) : fechaLibre;
  // Qué falta para poder publicar. Se muestra siempre (no dejar el botón muerto y mudo).
  const falta = !texto.trim() ? 'Escribí de qué se trata la nota.'
    : !fechaObjetivo ? 'Elegí una fecha: la nota tiene que saber qué día importa.'
    : prioridad === 'hora' && !hora ? 'Falta la hora límite.'
    : '';
  const puede = !falta;

  const publicar = async () => {
    if (busy) return;
    if (falta) { setAviso(falta); return; }
    setBusy(true); setAviso('');
    try {
      await sbFetch('notas_operativas', {
        method: 'POST',
        body: JSON.stringify({
          texto: texto.trim(),
          tipo,
          prioridad,
          hora_limite: prioridad === 'hora' ? hora : null,
          fecha_objetivo: fechaObjetivo,
          cliente_id: tipo === 'colecta' && clienteId ? clienteId : null,
          cadete: tipo === 'ausencia' && cadete ? cadete : null,
          cubre: tipo === 'ausencia' && cubre.trim() ? cubre.trim() : null,
          autor,
        }),
      });
      setTexto(''); setPrioridad('normal'); setHora(''); setCadete(''); setCubre(''); setClienteId('');
      setCuando('hoy'); setFechaLibre('');
      onPublicar();
    } catch (e) {
      setAviso('No se pudo publicar: ' + e.message);
    } finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 16, borderRadius: 14, border: `1px solid ${BRAND.border}`, background: BRAND.navyCard, marginBottom: 20 }}>
      <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={2}
        placeholder="Qué hay que saber… (ej: avisar al cerrajero antes de las 15)"
        style={{ ...inpSt, width: '100%', resize: 'vertical', fontFamily: 'inherit', marginBottom: 14 }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <FilaChips label="Tipo">
          {Object.entries(NOTA_TIPOS).map(([k, t]) => (
            <Chip key={k} activo={tipo === k} onClick={() => setTipo(k)}>{t.emoji} {t.label}</Chip>
          ))}
        </FilaChips>

        <FilaChips label="Cuándo">
          <Chip activo={cuando === 'hoy'} onClick={() => setCuando('hoy')}>Hoy</Chip>
          <Chip activo={cuando === 'manana'} onClick={() => setCuando('manana')}>Mañana</Chip>
          <Chip activo={cuando === 'fecha'} onClick={() => setCuando('fecha')}>📅 Elegir fecha</Chip>
          {cuando === 'fecha' && (
            <input type="date" value={fechaLibre} min={hoy} onChange={e => setFechaLibre(e.target.value)}
              style={{ ...inpSt, padding: '7px 10px', fontSize: 13 }} />
          )}
        </FilaChips>

        <FilaChips label="Prioridad">
          <Chip activo={prioridad === 'ahora'} color={ROJO} onClick={() => { setPrioridad('ahora'); setHoraOpen(false); }}>⚡ Ahora</Chip>
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Chip activo={prioridad === 'hora'} color={AMBAR}
              onClick={() => { setPrioridad('hora'); setHoraOpen(true); }}>
              ⏰ {prioridad === 'hora' && hora ? `Antes de las ${hora}` : 'Hora límite'}
            </Chip>
            {horaOpen && (
              <SelectorHora valor={hora}
                onElegir={h => { setHora(h); setHoraOpen(false); }}
                onCerrar={() => { setHoraOpen(false); if (!hora) setPrioridad('normal'); }} />
            )}
          </span>
          <Chip activo={prioridad === 'normal'} onClick={() => { setPrioridad('normal'); setHora(''); setHoraOpen(false); }}>Normal</Chip>
        </FilaChips>

        {tipo === 'ausencia' && (
          <FilaChips label="Cadete">
            <select value={cadete} onChange={e => setCadete(e.target.value)} style={{ ...inpSt, padding: '8px 10px', fontSize: 13 }}>
              <option value="">¿Quién falta?</option>
              {choferes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <span style={{ fontSize: 12.5, color: BRAND.muted }}>lo cubre</span>
            <input type="text" list="fx-choferes" value={cubre} onChange={e => setCubre(e.target.value)}
              placeholder="A mano o de la lista"
              style={{ ...inpSt, padding: '8px 10px', fontSize: 13, width: 180 }} />
          </FilaChips>
        )}

        {tipo === 'colecta' && (
          <FilaChips label="Cliente">
            <select value={clienteId} onChange={e => setClienteId(e.target.value)} style={{ ...inpSt, padding: '8px 10px', fontSize: 13, maxWidth: 260 }}>
              <option value="">Sin cliente</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </FilaChips>
        )}
      </div>

      {aviso && <div style={{ color: ROJO, fontSize: 12.5, marginTop: 10 }}>{aviso}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <button type="button" onClick={publicar} disabled={busy}
          style={{
            minHeight: 38, padding: '0 20px', borderRadius: 10, fontSize: 14, fontWeight: 700, touchAction: 'manipulation',
            cursor: busy ? 'default' : 'pointer',
            border: `1px solid ${puede ? BRAND.teal : BRAND.border}`,
            background: puede ? 'rgba(46,207,170,0.14)' : BRAND.faint,
            color: puede ? BRAND.teal : 'rgba(255,255,255,0.45)',
          }}>
          {busy ? 'Publicando…' : 'Publicar'}
        </button>
        {falta ? (
          <span style={{ fontSize: 12.5, color: AMBAR }}>{falta}</span>
        ) : (
          <span style={{ fontSize: 12.5, color: BRAND.muted }}>
            {destinoLabel({ tipo, fecha_objetivo: fechaObjetivo, cliente_id: clienteId }, Object.fromEntries(clientes.map(c => [c.id, c.nombre])), hoy)}
          </span>
        )}
      </div>
    </div>
  );
}

// ── TARJETA DE NOTA ──
function Nota({ nota, clientesById, onResolver, onCubrir, hoy }) {
  const [cubre, setCubre] = useState(nota.cubre || '');
  const resuelta = !!nota.resuelta_at;
  const t = NOTA_TIPOS[nota.tipo] || NOTA_TIPOS.aviso;
  const urgente = !resuelta && nota.prioridad === 'ahora';
  const conHora = !resuelta && nota.prioridad === 'hora' && nota.hora_limite;
  const acento = urgente ? ROJO : conHora ? AMBAR : null;
  const creada = nota.created_at
    ? new Date(new Date(nota.created_at).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16)
    : '';

  const meta = { fontSize: 11.5, color: 'rgba(255,255,255,0.42)', whiteSpace: 'nowrap' };
  const badge = (bg, txt) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 6, background: bg, color: '#14171c', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.03em' }}>{txt}</span>
  );

  return (
    <div style={{
      display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 12,
      border: `1px solid ${BRAND.border}`, borderLeft: acento ? `3px solid ${acento}` : `1px solid ${BRAND.border}`,
      background: BRAND.navyCard, opacity: resuelta ? 0.55 : 1,
    }}>
      <div onClick={() => !resuelta && onResolver(nota)}
        title={resuelta ? 'Resuelta' : 'Marcar como resuelta'}
        style={{
          width: 32, height: 32, flexShrink: 0, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: resuelta ? 'default' : 'pointer', touchAction: 'manipulation', WebkitUserSelect: 'none', userSelect: 'none',
          border: `2px solid ${resuelta ? BRAND.teal : 'rgba(255,255,255,0.3)'}`,
          background: resuelta ? BRAND.teal : 'transparent', color: '#0d1b2a', fontWeight: 800, fontSize: 17,
        }}>
        {resuelta ? '✓' : ''}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: BRAND.white, lineHeight: 1.35, textDecoration: resuelta ? 'line-through' : 'none' }}>
          {nota.texto}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 7 }}>
          {urgente && badge(ROJO, '⚡ AHORA')}
          {conHora && badge(AMBAR, `⏰ ANTES DE LAS ${nota.hora_limite}`)}
          <span style={{ ...meta, color: 'rgba(255,255,255,0.6)' }}>{t.emoji} {t.label}{nota.cadete ? ` · ${nota.cadete}` : ''}</span>
          <span style={meta}>{destinoLabel(nota, clientesById, hoy)}</span>
          <span style={meta}>{nota.autor}{creada ? ` · ${creada}` : ''}</span>
          {resuelta && (
            <span style={{ ...meta, color: BRAND.teal }}>
              ✓ {nota.tipo === 'ausencia' && nota.cubre ? `Cubierto por ${nota.cubre}` : `Resuelta por ${nota.resuelta_por || '—'}`}
            </span>
          )}
        </div>

        {!resuelta && nota.tipo === 'ausencia' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: BRAND.muted }}>Lo cubre:</span>
            <input type="text" list="fx-choferes" value={cubre} onChange={e => setCubre(e.target.value)}
              placeholder="A mano o de la lista"
              style={{ ...inpSt, padding: '7px 10px', fontSize: 13, width: 170 }} />
            <button type="button" onClick={() => onCubrir(nota, cubre.trim())} disabled={!cubre.trim()}
              style={{
                minHeight: 34, padding: '0 14px', borderRadius: 9, fontSize: 13, fontWeight: 700, touchAction: 'manipulation',
                cursor: cubre.trim() ? 'pointer' : 'default',
                border: `1px solid ${cubre.trim() ? BRAND.teal : BRAND.border}`,
                background: cubre.trim() ? 'rgba(46,207,170,0.14)' : BRAND.faint,
                color: cubre.trim() ? BRAND.teal : 'rgba(255,255,255,0.3)',
              }}>
              Cubrir ausencia
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Grupo({ titulo, notas, acento, ...rest }) {
  if (!notas.length) return null;
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: acento || 'rgba(255,255,255,0.45)' }}>{titulo}</span>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>({notas.length})</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notas.map(n => <Nota key={n.id} nota={n} {...rest} />)}
      </div>
    </div>
  );
}

function PizarraInner({ usuario }) {
  const [notas, setNotas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [choferes, setChoferes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [verCompletadas, setVerCompletadas] = useState(false);
  // Reloj interno: una nota con hora límite tiene que subir sola a Vencidas sin recargar.
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const hoy = todayStr();

  const recargar = useCallback(() => {
    return cargarNotas(hoy).then(setNotas).catch(e => setError('Error cargando notas: ' + e.message));
  }, [hoy]);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      cargarNotas(hoy),
      sbFetch('colectas_clientes?select=id,nombre&activo=eq.true&order=nombre.asc').catch(() => []),
      cargarChoferesFull(),
    ]).then(([ns, cs, chs]) => {
      if (!vivo) return;
      setNotas(ns); setClientes(cs); setChoferes(chs);
    }).catch(e => vivo && setError('Error cargando la pizarra: ' + e.message))
      .finally(() => vivo && setLoading(false));
    return () => { vivo = false; };
  }, [hoy]);

  const onRow = useCallback((row, evento) => setNotas(prev => aplicarCambioNota(prev, row, evento)), []);
  useNotasRealtime(onRow);

  const clientesById = useMemo(() => Object.fromEntries(clientes.map(c => [c.id, c.nombre])), [clientes]);

  const resolver = async (nota, extra = {}) => {
    setNotas(prev => prev.map(n => n.id === nota.id ? { ...n, resuelta_por: usuario, resuelta_at: new Date().toISOString(), ...extra } : n));
    try { await resolverNota(nota.id, usuario, extra); }
    catch (e) { setError('No se pudo resolver: ' + e.message); recargar(); }
  };

  const { vencidas, dias, completadas } = useMemo(() => {
    const min = minutosAR(ahora);
    const pend = notas.filter(n => !n.resuelta_at);
    const venc = ordenarNotas(pend.filter(n => estaVencida(n, hoy, min)));
    const restantes = pend.filter(n => !estaVencida(n, hoy, min));
    const porDia = {};
    restantes.forEach(n => { (porDia[n.fecha_objetivo] = porDia[n.fecha_objetivo] || []).push(n); });
    const ds = Object.keys(porDia).sort().map(f => ({ fecha: f, notas: ordenarNotas(porDia[f]) }));
    const comp = notas.filter(n => n.resuelta_at && n.fecha_objetivo === hoy)
      .sort((a, b) => String(b.resuelta_at).localeCompare(String(a.resuelta_at)));
    return { vencidas: venc, dias: ds, completadas: comp };
  }, [notas, hoy, ahora]);

  const props = { clientesById, choferes, usuario, hoy, onResolver: n => resolver(n), onCubrir: (n, c) => resolver(n, { cubre: c }) };

  return (
    <div style={{ maxWidth: 760 }}>
      {/* Sugerencias para los campos "lo cubre": se puede elegir de la lista o escribir a mano
          (el reemplazo puede ser alguien que no esté en el padrón de cadetes). */}
      <datalist id="fx-choferes">
        {choferes.map(c => <option key={c} value={c} />)}
      </datalist>

      {error && (
        <div style={{ background: 'rgba(226,75,74,0.15)', color: ROJO, border: `1px solid rgba(226,75,74,0.3)`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: ROJO, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      <Creador autor={usuario} choferes={choferes} clientes={clientes} onPublicar={recargar} />

      {loading ? (
        <div style={{ color: BRAND.muted, padding: '3rem', textAlign: 'center' }}>Cargando…</div>
      ) : (
        <>
          {vencidas.length > 0 && (
            <div style={{ padding: '12px 14px 2px', borderRadius: 14, border: `1px solid ${ROJO}44`, background: 'rgba(226,75,74,0.06)', marginBottom: 22 }}>
              <Grupo titulo="⚠ Vencidas" notas={vencidas} acento={ROJO} {...props} />
            </div>
          )}

          {dias.map(d => (
            <Grupo key={d.fecha} titulo={labelDia(d.fecha, hoy)} notas={d.notas} {...props} />
          ))}

          {!vencidas.length && !dias.length && (
            <div style={{ color: BRAND.muted, padding: '3rem', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>🗒️</div>
              <div>No hay notas pendientes.</div>
            </div>
          )}

          {completadas.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setVerCompletadas(v => !v)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34, padding: '0 12px', borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, touchAction: 'manipulation', border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: BRAND.muted }}>
                {verCompletadas ? '▾' : '▸'} Completadas hoy ({completadas.length})
              </button>
              {verCompletadas && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  {completadas.map(n => <Nota key={n.id} nota={n} {...props} />)}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function Pizarra() {
  const [usuario, setUsuario] = useState(() => (getSession() || {}).nombre || '');
  if (!usuario) return <LoginFlexit icono="🗒️" titulo="Pizarra operativa" onOk={setUsuario} />;
  return <PizarraInner usuario={usuario} />;
}
