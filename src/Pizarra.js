// src/Pizarra.js — Pizarra operativa: tablero de notas ancladas a la operación (ver spec-pizarra-operativa).
// No es un chat: cada nota tiene un día en que IMPORTA y aparece sola donde corresponde
// (franja en Colectas / Arribos). El tablero agrupa POR DÍA, no por estado: las notas solo
// están pendientes o resueltas, y lo que hay que ver de un golpe es qué pasa hoy y qué mañana.
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getSession } from './auth';
import {
  BRAND, sbFetch, todayStr, minutosAR, sumarDias, labelDia, destinoLabel,
  NOTA_TIPOS, ordenarNotas, estaVencida, cargarNotas, resolverNota, patchNota,
  cargarChoferesFull, useNotasRealtime, aplicarCambioNota, LoginFlexit,
} from './colectasShared';

const ROJO = '#E24B4A';
const AMBAR = '#FBBF24';
const LILA = '#818CF8';

const inpSt = {
  padding: '8px 10px', borderRadius: 8, border: `1px solid ${BRAND.border}`,
  background: 'rgba(0,0,0,0.28)', color: BRAND.white, fontSize: 13, outline: 'none',
  boxSizing: 'border-box', fontFamily: 'inherit',
};

// Botón chico de acción sobre una tarjeta (mover de día, resolver). Tap, nunca long-press.
function Accion({ onClick, children, color, titulo }) {
  const c = color || 'rgba(255,255,255,0.5)';
  return (
    <button type="button" onClick={onClick} title={titulo}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 26, padding: '0 8px',
        borderRadius: 7, cursor: 'pointer', fontSize: 11.5, fontWeight: 600, touchAction: 'manipulation',
        border: '1px solid transparent', background: 'rgba(255,255,255,0.05)', color: c, whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
  );
}

// Chip de opción del creador inline.
function Chip({ activo, onClick, children, color }) {
  const c = color || BRAND.teal;
  return (
    <button type="button" onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32, padding: '0 10px',
        borderRadius: 999, cursor: 'pointer', fontSize: 12, fontWeight: 600, touchAction: 'manipulation',
        border: `1px solid ${activo ? c : BRAND.border}`,
        background: activo ? `${c}1f` : 'rgba(255,255,255,0.04)',
        color: activo ? c : BRAND.muted, whiteSpace: 'nowrap',
      }}>
      {children}
    </button>
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
    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200, padding: 11, borderRadius: 12, border: `1px solid ${AMBAR}55`, background: BRAND.navyCard, boxShadow: '0 12px 34px rgba(0,0,0,0.6)', width: 208 }}>
      <div style={{ fontSize: 11, color: BRAND.muted, marginBottom: 7 }}>Antes de las…</div>
      <input ref={ref} type="text" inputMode="numeric" placeholder="HH:MM" maxLength={5} value={text}
        onChange={e => {
          const d = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
          setText(d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d);
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(text); }
          if (e.key === 'Escape') onCerrar();
        }}
        style={{ ...inpSt, width: '100%', fontSize: 17, fontWeight: 700, textAlign: 'center', letterSpacing: '0.06em' }} />
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 9 }}>
        {['12:00', '15:00', '18:00', '21:00'].map(h => (
          <button key={h} type="button" onClick={() => onElegir(h)}
            style={{ minHeight: 30, padding: '0 9px', borderRadius: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, touchAction: 'manipulation', border: `1px solid ${BRAND.border}`, background: 'rgba(255,255,255,0.04)', color: BRAND.muted }}>
            {h}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
        <button type="button" onClick={() => { if (!commit(text)) onCerrar(); }}
          style={{ flex: 1, minHeight: 32, borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 700, touchAction: 'manipulation', border: `1px solid ${AMBAR}`, background: `${AMBAR}22`, color: AMBAR }}>Listo</button>
        <button type="button" onClick={onCerrar}
          style={{ minHeight: 32, padding: '0 11px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, touchAction: 'manipulation', border: `1px solid ${BRAND.border}`, background: 'transparent', color: BRAND.muted }}>✕</button>
      </div>
    </div>
  );
}

// ── CREADOR INLINE (al pie de cada columna) ──
// La columna ya define el día: en Hoy y Mañana no hay nada que elegir; solo Próximos pide fecha.
function CreadorInline({ autor, fechaFija, choferes, clientes, onListo, onCancelar }) {
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState('aviso');
  const [prioridad, setPrioridad] = useState('normal');
  const [hora, setHora] = useState('');
  const [horaOpen, setHoraOpen] = useState(false);
  const [fecha, setFecha] = useState(fechaFija || sumarDias(todayStr(), 2));
  const [hasta, setHasta] = useState('');   // vacío = un solo día
  const [cadete, setCadete] = useState('');
  const [cubre, setCubre] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.focus(); }, []);

  // Días que cubre la nota. Un rango genera una nota POR DÍA: si falta un cadete toda la semana,
  // cada día se cubre y se resuelve por separado. Se saltean los domingos (no se opera).
  const dias = useMemo(() => {
    if (!fecha) return [];
    const fin = hasta && hasta > fecha ? hasta : fecha;
    const out = [];
    for (let f = fecha; f <= fin && out.length < 31; f = sumarDias(f, 1)) {
      if (new Date(f + 'T12:00:00').getDay() !== 0) out.push(f);
    }
    return out;
  }, [fecha, hasta]);

  const falta = !texto.trim() ? 'Escribí de qué se trata la nota.'
    : !dias.length ? 'Elegí la fecha.'
    : prioridad === 'hora' && !hora ? 'Falta la hora límite.'
    : '';

  const publicar = async () => {
    if (busy) return;
    if (falta) { setAviso(falta); return; }
    setBusy(true); setAviso('');
    try {
      const base = {
        texto: texto.trim(),
        tipo,
        prioridad,
        hora_limite: prioridad === 'hora' ? hora : null,
        cliente_id: tipo === 'colecta' && clienteId ? clienteId : null,
        cadete: tipo === 'ausencia' && cadete ? cadete : null,
        cubre: tipo === 'ausencia' && cubre.trim() ? cubre.trim() : null,
        autor,
      };
      await sbFetch('notas_operativas', {
        method: 'POST',
        body: JSON.stringify(dias.map(d => ({ ...base, fecha_objetivo: d }))),
      });
      onListo();
    } catch (e) {
      setAviso('No se pudo publicar: ' + e.message);
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 10, borderRadius: 10, border: `1px solid ${BRAND.teal}55`, background: 'rgba(46,207,170,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <textarea ref={ref} value={texto} onChange={e => setTexto(e.target.value)} rows={2}
        placeholder="Qué hay que saber…"
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); publicar(); }
          if (e.key === 'Escape') onCancelar();
        }}
        style={{ ...inpSt, width: '100%', resize: 'vertical', fontSize: 13.5 }} />

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {Object.entries(NOTA_TIPOS).map(([k, t]) => (
          <Chip key={k} activo={tipo === k} onClick={() => setTipo(k)}>{t.emoji} {t.label}</Chip>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <Chip activo={prioridad === 'ahora'} color={ROJO}
          onClick={() => { setPrioridad(prioridad === 'ahora' ? 'normal' : 'ahora'); setHoraOpen(false); setHora(''); }}>⚡ Ahora</Chip>
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
        {!fechaFija && (
          <input type="date" value={fecha} min={sumarDias(todayStr(), 2)} onChange={e => setFecha(e.target.value)}
            style={{ ...inpSt, fontSize: 12 }} />
        )}
        <Chip activo={!!hasta} color={LILA}
          onClick={() => setHasta(h => (h ? '' : sumarDias(fecha, 1)))}>📅 Varios días</Chip>
        {!!hasta && (
          <input type="date" value={hasta} min={sumarDias(fecha, 1)} onChange={e => setHasta(e.target.value)}
            style={{ ...inpSt, fontSize: 12 }} />
        )}
      </div>

      {dias.length > 1 && (
        <div style={{ fontSize: 11, color: LILA }}>
          Se van a crear {dias.length} notas, una por día ({labelDia(dias[0])} → {labelDia(dias[dias.length - 1])}).
          Cada día se cubre y se resuelve por separado.
        </div>
      )}

      {tipo === 'ausencia' && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={cadete} onChange={e => setCadete(e.target.value)} style={{ ...inpSt, fontSize: 12.5, maxWidth: '100%' }}>
            <option value="">¿Quién falta?</option>
            {choferes.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input type="text" list="fx-choferes" value={cubre} onChange={e => setCubre(e.target.value)}
            placeholder="Lo cubre (a mano)" style={{ ...inpSt, fontSize: 12.5, flex: 1, minWidth: 130 }} />
        </div>
      )}

      {tipo === 'colecta' && (
        <select value={clienteId} onChange={e => setClienteId(e.target.value)} style={{ ...inpSt, fontSize: 12.5, maxWidth: '100%' }}>
          <option value="">Sin cliente</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      )}

      {aviso && <div style={{ color: AMBAR, fontSize: 11.5 }}>{aviso}</div>}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button type="button" onClick={publicar} disabled={busy}
          style={{
            minHeight: 32, padding: '0 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, touchAction: 'manipulation',
            cursor: busy ? 'default' : 'pointer',
            border: `1px solid ${falta ? BRAND.border : BRAND.teal}`,
            background: falta ? 'rgba(255,255,255,0.04)' : 'rgba(46,207,170,0.14)',
            color: falta ? 'rgba(255,255,255,0.45)' : BRAND.teal,
          }}>
          {busy ? 'Publicando…' : 'Publicar'}
        </button>
        <button type="button" onClick={onCancelar}
          style={{ minHeight: 32, padding: '0 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, touchAction: 'manipulation', border: `1px solid ${BRAND.border}`, background: 'transparent', color: BRAND.muted }}>✕</button>
      </div>
    </div>
  );
}

// ── TARJETA ──
function Tarjeta({ nota, clientesById, onResolver, onCubrir, onMover, hoy, mostrarDia, arrastrable }) {
  const [cubre, setCubre] = useState(nota.cubre || '');
  const [abierta, setAbierta] = useState(false);
  const resuelta = !!nota.resuelta_at;
  const t = NOTA_TIPOS[nota.tipo] || NOTA_TIPOS.aviso;
  const urgente = !resuelta && nota.prioridad === 'ahora';
  const conHora = !resuelta && nota.prioridad === 'hora' && nota.hora_limite;
  const acento = urgente ? ROJO : conHora ? AMBAR : null;
  const creada = nota.created_at
    ? new Date(new Date(nota.created_at).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16)
    : '';
  const meta = { fontSize: 10.5, color: 'rgba(255,255,255,0.38)', whiteSpace: 'nowrap' };

  return (
    <div
      draggable={arrastrable && !resuelta}
      onDragStart={e => { e.dataTransfer.setData('text/plain', String(nota.id)); e.dataTransfer.effectAllowed = 'move'; }}
      style={{
        padding: '10px 11px', borderRadius: 9, background: BRAND.navyCard,
        border: `1px solid ${BRAND.border}`,
        borderLeft: acento ? `3px solid ${acento}` : `1px solid ${BRAND.border}`,
        opacity: resuelta ? 0.5 : 1, cursor: arrastrable && !resuelta ? 'grab' : 'default',
      }}>

      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <div onClick={() => !resuelta && onResolver(nota)}
          title={resuelta ? 'Resuelta' : 'Marcar como resuelta'}
          style={{
            width: 32, height: 32, marginTop: -3, marginLeft: -4, flexShrink: 0, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: resuelta ? 'default' : 'pointer', touchAction: 'manipulation', WebkitUserSelect: 'none', userSelect: 'none',
          }}>
          <span style={{
            width: 19, height: 19, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `2px solid ${resuelta ? BRAND.teal : 'rgba(255,255,255,0.28)'}`,
            background: resuelta ? BRAND.teal : 'transparent', color: '#0d1b2a', fontWeight: 800, fontSize: 12,
          }}>{resuelta ? '✓' : ''}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {(urgente || conHora) && (
            <div style={{ marginBottom: 5 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 7px', borderRadius: 5, background: acento, color: '#14171c', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.03em' }}>
                {urgente ? '⚡ AHORA' : `⏰ ANTES DE LAS ${nota.hora_limite}`}
              </span>
            </div>
          )}

          <div style={{ fontSize: 13.5, color: BRAND.white, lineHeight: 1.4, textDecoration: resuelta ? 'line-through' : 'none', wordBreak: 'break-word' }}>
            {nota.texto}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 7 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 7px', borderRadius: 5, background: 'rgba(255,255,255,0.06)', fontSize: 10.5, color: 'rgba(255,255,255,0.62)' }}>
              {t.emoji} {t.label}{nota.cadete ? ` · ${nota.cadete}` : ''}
            </span>
            {mostrarDia && (
              <span style={{ display: 'inline-flex', padding: '1px 7px', borderRadius: 5, background: `${LILA}1f`, color: LILA, fontSize: 10.5, fontWeight: 600 }}>
                {labelDia(nota.fecha_objetivo, hoy)}
              </span>
            )}
            {nota.tipo !== 'aviso' && <span style={meta}>{destinoLabel(nota, clientesById, hoy, true)}</span>}
            <span style={meta}>{nota.autor}{creada ? ` · ${creada}` : ''}</span>
          </div>

          {resuelta && (
            <div style={{ fontSize: 10.5, color: BRAND.teal, marginTop: 5 }}>
              ✓ {nota.tipo === 'ausencia' && nota.cubre ? `Cubierto por ${nota.cubre}` : `Resuelta por ${nota.resuelta_por || '—'}`}
            </div>
          )}

          {!resuelta && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
              {nota.fecha_objetivo !== hoy && <Accion onClick={() => onMover(nota, hoy)} titulo="Traer para hoy">↓ Hoy</Accion>}
              {nota.tipo === 'ausencia' && (
                <Accion onClick={() => setAbierta(a => !a)} color={BRAND.teal} titulo="Definir el reemplazo">
                  {nota.cubre ? `Cubre: ${nota.cubre}` : 'Cubrir'}
                </Accion>
              )}
            </div>
          )}

          {!resuelta && nota.tipo === 'ausencia' && abierta && (
            <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
              <input type="text" list="fx-choferes" value={cubre} onChange={e => setCubre(e.target.value)}
                placeholder="Lo cubre (a mano o de la lista)" autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && cubre.trim()) onCubrir(nota, cubre.trim()); }}
                style={{ ...inpSt, fontSize: 12.5, flex: 1, minWidth: 130 }} />
              <button type="button" onClick={() => onCubrir(nota, cubre.trim())} disabled={!cubre.trim()}
                style={{
                  minHeight: 32, padding: '0 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, touchAction: 'manipulation',
                  cursor: cubre.trim() ? 'pointer' : 'default',
                  border: `1px solid ${cubre.trim() ? BRAND.teal : BRAND.border}`,
                  background: cubre.trim() ? 'rgba(46,207,170,0.14)' : 'rgba(255,255,255,0.04)',
                  color: cubre.trim() ? BRAND.teal : 'rgba(255,255,255,0.3)',
                }}>
                Cubrir ausencia
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── COLUMNA ──
function Columna({ col, notas, hechas = [], esMovil, creando, onCrear, onSoltar, children, ...rest }) {
  const [encima, setEncima] = useState(false);
  const puedeSoltar = !!col.fecha;

  return (
    <div
      onDragOver={e => { if (puedeSoltar) { e.preventDefault(); setEncima(true); } }}
      onDragLeave={() => setEncima(false)}
      onDrop={e => {
        setEncima(false);
        if (!puedeSoltar) return;
        e.preventDefault();
        const id = Number(e.dataTransfer.getData('text/plain'));
        if (id) onSoltar(id, col.fecha);
      }}
      style={{
        flex: esMovil ? '1 1 100%' : '1 1 0', minWidth: esMovil ? 0 : 232,
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: 8, borderRadius: 12,
        background: encima ? 'rgba(46,207,170,0.07)' : 'transparent',
        border: `1px dashed ${encima ? BRAND.teal : 'transparent'}`,
        transition: 'background .12s, border-color .12s',
      }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '2px 3px 6px' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color, flexShrink: 0 }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: col.color, letterSpacing: '0.01em' }}>{col.titulo}</span>
        <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.3)' }}>{notas.length}</span>
      </div>

      {notas.map(n => <Tarjeta key={n.id} nota={n} arrastrable={!esMovil} mostrarDia={col.mostrarDia} {...rest} />)}

      {!notas.length && !hechas.length && !creando && (
        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.22)', padding: '10px 4px' }}>{col.vacio}</div>
      )}

      {/* Lo hecho no desaparece: queda a la vista, tachado, para saber que se resolvió. */}
      {hechas.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 3px 2px' }}>
            <span style={{ flex: 1, height: 1, background: BRAND.border }} />
            <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.3)' }}>Hechas {hechas.length}</span>
            <span style={{ flex: 1, height: 1, background: BRAND.border }} />
          </div>
          {hechas.map(n => <Tarjeta key={n.id} nota={n} mostrarDia={col.mostrarDia} {...rest} />)}
        </>
      )}

      {creando ? children : col.creable && (
        <button type="button" onClick={onCrear}
          style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '0 8px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, touchAction: 'manipulation', border: '1px solid transparent', background: 'transparent', color: 'rgba(255,255,255,0.3)', textAlign: 'left' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = BRAND.muted; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.3)'; }}>
          + Nueva nota
        </button>
      )}
    </div>
  );
}

function PizarraInner({ usuario }) {
  const [notas, setNotas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [choferes, setChoferes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creandoEn, setCreandoEn] = useState(null); // id de la columna con el creador abierto
  const [esMovil, setEsMovil] = useState(typeof window !== 'undefined' && window.innerWidth < 900);
  useEffect(() => {
    const h = () => setEsMovil(window.innerWidth < 900);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // Reloj interno: una nota con hora límite tiene que pasar sola a Vencidas sin recargar.
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const hoy = todayStr();
  const manana = sumarDias(hoy, 1);

  const recargar = useCallback(() => cargarNotas(hoy).then(setNotas).catch(e => setError('Error cargando notas: ' + e.message)), [hoy]);

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

  const parchar = async (id, patch) => {
    setNotas(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
    try { await patchNota(id, patch); }
    catch (e) { setError('No se pudo guardar: ' + e.message); recargar(); }
  };

  const resolver = (nota, extra = {}) => {
    const patch = { resuelta_por: usuario, resuelta_at: new Date().toISOString(), ...extra };
    setNotas(prev => prev.map(n => n.id === nota.id ? { ...n, ...patch } : n));
    return resolverNota(nota.id, usuario, extra)
      .catch(e => { setError('No se pudo resolver: ' + e.message); recargar(); });
  };

  const mover = (nota, fecha) => parchar(nota.id, { fecha_objetivo: fecha });
  const soltar = (id, fecha) => parchar(id, { fecha_objetivo: fecha });

  const { cols } = useMemo(() => {
    const min = minutosAR(ahora);
    const pend = notas.filter(n => !n.resuelta_at);
    const venc = ordenarNotas(pend.filter(n => estaVencida(n, hoy, min)));
    const resto = pend.filter(n => !estaVencida(n, hoy, min));
    // Próximos junta varios días: primero por fecha, y dentro de cada fecha el mismo orden por urgencia.
    const porDia = {};
    resto.filter(n => n.fecha_objetivo > manana)
      .forEach(n => { (porDia[n.fecha_objetivo] = porDia[n.fecha_objetivo] || []).push(n); });
    const prox = Object.keys(porDia).sort().flatMap(f => ordenarNotas(porDia[f]));
    const comp = notas.filter(n => n.resuelta_at && n.fecha_objetivo === hoy)
      .sort((a, b) => String(a.resuelta_at).localeCompare(String(b.resuelta_at)));
    return {
      cols: [
        { id: 'vencidas', titulo: '⚠ Vencidas', color: ROJO, notas: venc, hechas: [], vacio: '', soloSiHay: true },
        { id: 'hoy', titulo: 'Hoy', color: BRAND.teal, fecha: hoy, creable: true, vacio: 'Nada pendiente para hoy.', notas: ordenarNotas(resto.filter(n => n.fecha_objetivo === hoy)), hechas: comp },
        { id: 'manana', titulo: 'Mañana', color: '#8EC5FF', fecha: manana, creable: true, vacio: 'Nada para mañana.', notas: ordenarNotas(resto.filter(n => n.fecha_objetivo === manana)), hechas: [] },
        { id: 'proximos', titulo: 'Próximos', color: LILA, creable: true, mostrarDia: true, vacio: 'Sin notas más adelante.', notas: prox, hechas: [] },
      ],
    };
  }, [notas, hoy, manana, ahora]);

  const visibles = cols.filter(c => !c.soloSiHay || c.notas.length || c.hechas.length);
  const props = { clientesById, hoy, onResolver: n => resolver(n), onCubrir: (n, c) => resolver(n, { cubre: c }), onMover: mover };

  return (
    <div>
      {/* Sugerencias para "lo cubre": se elige de la lista o se escribe a mano (el reemplazo
          puede ser alguien que no esté en el padrón de cadetes). */}
      <datalist id="fx-choferes">
        {choferes.map(c => <option key={c} value={c} />)}
      </datalist>

      {error && (
        <div style={{ background: 'rgba(226,75,74,0.15)', color: ROJO, border: `1px solid rgba(226,75,74,0.3)`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {error}
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: ROJO, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>
      )}

      {loading ? (
        <div style={{ color: BRAND.muted, padding: '3rem', textAlign: 'center' }}>Cargando…</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: esMovil ? 'wrap' : 'nowrap' }}>
            {visibles.map(col => (
              <Columna key={col.id} col={col} notas={col.notas} hechas={col.hechas} esMovil={esMovil}
                creando={creandoEn === col.id}
                onCrear={() => setCreandoEn(col.id)}
                onSoltar={soltar} {...props}>
                <CreadorInline
                  autor={usuario}
                  fechaFija={col.fecha}
                  choferes={choferes}
                  clientes={clientes}
                  onListo={() => { setCreandoEn(null); recargar(); }}
                  onCancelar={() => setCreandoEn(null)} />
              </Columna>
            ))}
          </div>

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
