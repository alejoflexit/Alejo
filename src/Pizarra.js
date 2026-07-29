// src/Pizarra.js — Pizarra operativa: tablero de notas ancladas a la operación (ver spec-pizarra-operativa).
// No es un chat: cada nota tiene un día en que IMPORTA y aparece sola donde corresponde
// (franja en Colectas / Arribos). El tablero agrupa POR DÍA, no por estado: las notas solo
// están pendientes o resueltas, y lo que hay que ver de un golpe es qué pasa hoy y qué mañana.
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getSession } from './auth';
import {
  BRAND, sbFetch, todayStr, minutosAR, sumarDias, labelDia, destinoLabel,
  NOTA_TIPOS, ordenarNotas, estaVencida, cargarNotas, resolverNota, desmarcarNota, borrarNota, patchNota,
  cargarChoferesFull, useNotasRealtime, aplicarCambioNota, LoginFlexit,
  editarNota, cargarComentarios, agregarComentario, borrarComentario, useComentariosRealtime,
  cargarObjetivos, crearObjetivo, marcarObjetivo, desmarcarObjetivo, borrarObjetivo,
  useObjetivosRealtime, aplicarCambioObjetivo,
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
// Fecha calendario argentina de un timestamp (los hecho_at vienen en UTC: sin esto, algo
// marcado después de las 21hs figuraría como del día siguiente).
const fechaAR = (iso) => new Date(new Date(iso).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);

// ── OBJETIVOS DEL EQUIPO ──
// Lista para tachar, del equipo, sin dueño: no está atada a un día (a diferencia de las notas),
// vive hasta que alguien la marca. Cualquiera tacha cualquier objetivo y queda quién lo hizo.
function BloqueObjetivos({ usuario, esMovil }) {
  const [objetivos, setObjetivos] = useState([]);
  const [texto, setTexto] = useState('');
  const [creando, setCreando] = useState(false);
  const [verHechos, setVerHechos] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  const recargar = useCallback(() => {
    cargarObjetivos().then(r => setObjetivos(Array.isArray(r) ? r : [])).catch(() => {});
  }, []);
  useEffect(() => { recargar(); }, [recargar]);
  useObjetivosRealtime(useCallback((row, ev) => setObjetivos(prev => aplicarCambioObjetivo(prev, row, ev)), []));
  useEffect(() => { if (creando && inputRef.current) inputRef.current.focus(); }, [creando]);

  const pendientes = objetivos.filter(o => !o.hecho_at);
  const hechos = objetivos.filter(o => o.hecho_at)
    .sort((a, b) => String(b.hecho_at).localeCompare(String(a.hecho_at)));
  const total = objetivos.length;
  const pct = total ? Math.round((hechos.length / total) * 100) : 0;

  // Optimista en los tres casos: el realtime confirma después. Si falla, se recarga de la base.
  const agregar = () => {
    const t = texto.trim();
    if (!t) { setCreando(false); return; }
    setTexto('');
    crearObjetivo(t, usuario)
      .then(r => { const fila = Array.isArray(r) ? r[0] : r; if (fila?.id) setObjetivos(prev => prev.some(o => o.id === fila.id) ? prev : [...prev, fila]); })
      .catch(e => { setError('No se pudo agregar: ' + e.message); recargar(); });
  };
  const alternar = (o) => {
    const hecho = !!o.hecho_at;
    setObjetivos(prev => prev.map(x => x.id === o.id
      ? { ...x, hecho_at: hecho ? null : new Date().toISOString(), hecho_por: hecho ? null : usuario }
      : x));
    (hecho ? desmarcarObjetivo(o.id) : marcarObjetivo(o.id, usuario))
      .catch(e => { setError('No se pudo guardar: ' + e.message); recargar(); });
  };
  const quitar = (o) => {
    setObjetivos(prev => prev.filter(x => x.id !== o.id));
    borrarObjetivo(o.id).catch(e => { setError('No se pudo borrar: ' + e.message); recargar(); });
  };

  const fila = (o) => {
    const hecho = !!o.hecho_at;
    return (
      <div key={o.id} className="fx-nota"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: `1px solid ${BRAND.border}` }}>
        <button type="button" onClick={() => alternar(o)}
          title={hecho ? 'Desmarcar' : 'Marcar como cumplido'}
          style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, cursor: 'pointer', touchAction: 'manipulation',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800,
            border: `2px solid ${hecho ? BRAND.teal : 'rgba(255,255,255,0.28)'}`,
            background: hecho ? BRAND.teal : 'transparent', color: '#0d1b2a' }}>
          {hecho ? '✓' : ''}
        </button>
        <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: hecho ? BRAND.muted : BRAND.white }}>
          {/* el tachado va SOLO en el texto: si se pone en el contenedor, la línea también
              atraviesa el "✓ quién · cuándo" de abajo (text-decoration no se puede quitar desde el hijo) */}
          <span style={{ textDecoration: hecho ? 'line-through' : 'none' }}>{o.texto}</span>
          <span style={{ display: 'block', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>
            {hecho
              ? `✓ ${o.hecho_por || 'alguien'} · ${labelDia(fechaAR(o.hecho_at), todayStr())}`
              : (o.autor ? `propuesto por ${o.autor}` : '')}
          </span>
        </div>
        <button type="button" onClick={() => quitar(o)} title="Borrar objetivo"
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)', cursor: 'pointer', fontSize: 14, padding: '4px 2px', touchAction: 'manipulation' }}>✕</button>
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 12, border: `1px solid ${BRAND.border}`, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: BRAND.white }}>🎯 Objetivos del equipo</span>
        {total > 0 && (
          <>
            <span style={{ fontSize: 11.5, color: BRAND.muted }}>{hechos.length} de {total}</span>
            <div style={{ width: esMovil ? 70 : 110, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: BRAND.teal, transition: 'width .25s' }} />
            </div>
          </>
        )}
        <button type="button" onClick={() => setCreando(true)}
          style={{ marginLeft: 'auto', minHeight: 28, padding: '0 10px', borderRadius: 8, cursor: 'pointer', touchAction: 'manipulation',
            border: `1px solid ${BRAND.teal}55`, background: 'rgba(46,207,170,0.08)', color: BRAND.teal, fontSize: 12, fontWeight: 700 }}>
          + Objetivo
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: ROJO, marginTop: 8 }}>{error}</div>}

      {creando && (
        <div className="fx-crear" style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <input ref={inputRef} value={texto} onChange={e => setTexto(e.target.value)}
            placeholder="Ej: cerrar el mes de colectas sin pendientes"
            onKeyDown={e => {
              if (e.key === 'Enter') agregar();
              if (e.key === 'Escape') { setTexto(''); setCreando(false); }
            }}
            style={{ ...inpSt, flex: 1 }} />
          <button type="button" onClick={agregar}
            style={{ minHeight: 34, padding: '0 14px', borderRadius: 8, border: 'none', background: BRAND.teal, color: '#0d1b2a', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Agregar</button>
          <button type="button" onClick={() => { setTexto(''); setCreando(false); }}
            style={{ minHeight: 34, padding: '0 10px', borderRadius: 8, border: `1px solid ${BRAND.border}`, background: 'none', color: BRAND.muted, fontSize: 12.5, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {pendientes.length > 0 && <div style={{ marginTop: 4 }}>{pendientes.map(fila)}</div>}

      {total === 0 && !creando && (
        <div style={{ fontSize: 12.5, color: BRAND.muted, marginTop: 8 }}>
          Todavía no hay objetivos. Sirven para lo que el equipo quiere lograr y no tiene día fijo — quedan a la vista hasta tacharlos.
        </div>
      )}

      {pendientes.length === 0 && total > 0 && (
        <div style={{ fontSize: 12.5, color: BRAND.teal, marginTop: 8 }}>✨ Todos los objetivos cumplidos.</div>
      )}

      {hechos.length > 0 && (
        <>
          <button type="button" onClick={() => setVerHechos(v => !v)}
            style={{ marginTop: 8, background: 'none', border: 'none', color: BRAND.muted, cursor: 'pointer', fontSize: 12, padding: 0, touchAction: 'manipulation' }}>
            {verHechos ? '▾' : '▸'} {hechos.length} cumplido{hechos.length > 1 ? 's' : ''}
          </button>
          {verHechos && <div>{hechos.map(fila)}</div>}
        </>
      )}
    </div>
  );
}

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

  // Botones de día rápido para la columna "Próximos": los próximos días hábiles (sin domingos),
  // para elegir "el viernes" de un toque en vez de pelear con el selector de fecha.
  const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const chipDia = (f) => { const d = new Date(f + 'T12:00:00'); return `${DIAS_CORTO[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}`; };
  const proximos = useMemo(() => {
    const out = [];
    for (let i = 2; out.length < 6 && i < 14; i++) {
      const f = sumarDias(todayStr(), i);
      if (new Date(f + 'T12:00:00').getDay() !== 0) out.push(f);
    }
    return out;
  }, []);

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
    <div className="fx-crear" style={{ padding: 10, borderRadius: 10, border: `1px solid ${BRAND.teal}55`, background: 'rgba(46,207,170,0.05)', display: 'flex', flexDirection: 'column', gap: 8 }}>
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

      {/* Cuándo: en Hoy/Mañana el día ya está fijo; en Próximos se elige con botones de día. */}
      {!fechaFija && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>¿Qué día?</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            {proximos.map(f => (
              <Chip key={f} activo={fecha === f && !hasta} color={LILA} onClick={() => { setFecha(f); setHasta(''); }}>{chipDia(f)}</Chip>
            ))}
            <input type="date" value={fecha} min={sumarDias(todayStr(), 2)} onChange={e => { setFecha(e.target.value); setHasta(''); }}
              title="Otra fecha" style={{ ...inpSt, fontSize: 12, maxWidth: 150 }} />
          </div>
          <div style={{ marginTop: 6 }}>
            <Chip activo={!!hasta} color={LILA}
              onClick={() => setHasta(h => (h ? '' : sumarDias(fecha, 1)))}>📅 Varios días seguidos</Chip>
            {!!hasta && (
              <input type="date" value={hasta} min={sumarDias(fecha, 1)} onChange={e => setHasta(e.target.value)}
                style={{ ...inpSt, fontSize: 12, marginLeft: 6, maxWidth: 150 }} />
            )}
          </div>
        </div>
      )}

      {dias.length > 1 && (
        <div style={{ fontSize: 11, color: LILA }}>
          Se van a crear {dias.length} notas, una por día ({labelDia(dias[0])} → {labelDia(dias[dias.length - 1])}).
          Cada día se cubre y se resuelve por separado.
        </div>
      )}

      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 2 }}>Prioridad</span>
        <Chip activo={prioridad === 'normal'} onClick={() => { setPrioridad('normal'); setHoraOpen(false); setHora(''); }}>Normal</Chip>
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
      </div>

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
function Tarjeta({ nota, clientesById, usuario, comentariosByNota = {}, onResolver, onDesmarcar, onBorrar, onCubrir, onMover, onEditar, onComentar, onBorrarComentario, hoy, mostrarDia, arrastrable }) {
  const comentarios = comentariosByNota[nota.id] || [];
  const [cubre, setCubre] = useState(nota.cubre || '');
  const [abierta, setAbierta] = useState(false);
  const [hover, setHover] = useState(false);
  const [armado, setArmado] = useState(false);   // borrar: primer toque arma, segundo confirma
  const [editando, setEditando] = useState(false);
  const [txtEdit, setTxtEdit] = useState(nota.texto);
  const [tipoEdit, setTipoEdit] = useState(nota.tipo);
  const [comOpen, setComOpen] = useState(false);
  const [comTxt, setComTxt] = useState('');
  const esAutor = usuario && nota.autor === usuario;
  const guardarEdit = () => { if (txtEdit.trim()) { onEditar(nota, { texto: txtEdit.trim(), tipo: tipoEdit }); setEditando(false); } };
  const enviarCom = () => { if (comTxt.trim()) { onComentar(nota, comTxt.trim()); setComTxt(''); } };
  const tBorrar = useRef(null);
  useEffect(() => () => { if (tBorrar.current) clearTimeout(tBorrar.current); }, []);
  const armarBorrar = () => {
    setArmado(true);
    if (tBorrar.current) clearTimeout(tBorrar.current);
    tBorrar.current = setTimeout(() => setArmado(false), 4000);
  };
  const resuelta = !!nota.resuelta_at;
  const t = NOTA_TIPOS[nota.tipo] || NOTA_TIPOS.aviso;
  const urgente = !resuelta && nota.prioridad === 'ahora';
  const conHora = !resuelta && nota.prioridad === 'hora' && nota.hora_limite;
  const acento = urgente ? ROJO : conHora ? AMBAR : null;
  const creada = nota.created_at
    ? new Date(new Date(nota.created_at).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16)
    : '';
  const meta = { fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.38)', whiteSpace: 'nowrap' };

  return (
    <div
      draggable={arrastrable && !resuelta}
      onDragStart={e => { e.dataTransfer.setData('text/plain', String(nota.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="fx-nota"
      style={{
        padding: '10px 11px', borderRadius: 9,
        background: hover && !resuelta ? '#1a3550' : BRAND.navyCard,
        border: `1px solid ${hover && !resuelta ? 'rgba(255,255,255,0.16)' : BRAND.border}`,
        borderLeft: acento ? `3px solid ${acento}` : `1px solid ${hover && !resuelta ? 'rgba(255,255,255,0.16)' : BRAND.border}`,
        boxShadow: hover && !resuelta ? '0 4px 14px rgba(0,0,0,0.35)' : 'none',
        transform: hover && !resuelta ? 'translateY(-1px)' : 'none',
        opacity: resuelta ? 0.45 : 1, cursor: arrastrable && !resuelta ? 'grab' : 'default',
        transition: 'background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .15s ease, opacity .2s ease',
      }}>

      <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
        <div onClick={() => (resuelta ? onDesmarcar(nota) : onResolver(nota))}
          title={resuelta ? 'Tocar para desmarcar (si se marcó por error)' : 'Marcar como resuelta'}
          style={{
            width: 32, height: 32, marginTop: -3, marginLeft: -4, flexShrink: 0, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', touchAction: 'manipulation', WebkitUserSelect: 'none', userSelect: 'none',
          }}>
          <span style={{
            width: 19, height: 19, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: `2px solid ${resuelta ? BRAND.teal : (hover ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.28)')}`,
            background: resuelta ? BRAND.teal : 'transparent', color: '#0d1b2a', fontWeight: 800, fontSize: 12,
            transition: 'background .18s ease, border-color .18s ease',
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

          {editando ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 4 }}>
              <textarea value={txtEdit} onChange={e => setTxtEdit(e.target.value)} rows={2} autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) guardarEdit(); if (e.key === 'Escape') setEditando(false); }}
                style={{ ...inpSt, fontSize: 14, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                {Object.entries(NOTA_TIPOS).map(([k, v]) => (
                  <button key={k} type="button" onClick={() => setTipoEdit(k)}
                    style={{ minHeight: 30, padding: '0 9px', borderRadius: 7, fontSize: 12, cursor: 'pointer', touchAction: 'manipulation',
                      border: `1px solid ${tipoEdit === k ? BRAND.teal : BRAND.border}`, background: tipoEdit === k ? 'rgba(46,207,170,0.14)' : 'transparent', color: tipoEdit === k ? BRAND.teal : BRAND.muted, fontWeight: tipoEdit === k ? 700 : 500 }}>
                    {v.emoji} {v.label}
                  </button>
                ))}
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 5 }}>
                  <button type="button" onClick={guardarEdit} disabled={!txtEdit.trim()}
                    style={{ minHeight: 30, padding: '0 12px', borderRadius: 7, fontSize: 12.5, fontWeight: 700, cursor: txtEdit.trim() ? 'pointer' : 'default', border: `1px solid ${BRAND.teal}`, background: 'rgba(46,207,170,0.14)', color: BRAND.teal }}>Guardar</button>
                  <button type="button" onClick={() => { setEditando(false); setTxtEdit(nota.texto); setTipoEdit(nota.tipo); }}
                    style={{ minHeight: 30, padding: '0 10px', borderRadius: 7, fontSize: 12.5, cursor: 'pointer', border: `1px solid ${BRAND.border}`, background: 'transparent', color: BRAND.muted }}>✕</button>
                </span>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 15, fontWeight: 600, color: BRAND.white, lineHeight: 1.35, textDecoration: resuelta ? 'line-through' : 'none', wordBreak: 'break-word' }}>
              {nota.texto}
            </div>
          )}

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

          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
            {!resuelta && esAutor && !editando && <Accion onClick={() => setEditando(true)} titulo="Editar tu nota">✏️ Editar</Accion>}
            <Accion onClick={() => setComOpen(o => !o)} color={comentarios.length ? BRAND.teal : undefined} titulo="Comentarios del equipo">💬 {comentarios.length || ''}</Accion>
            {!resuelta && nota.fecha_objetivo !== hoy && <Accion onClick={() => onMover(nota, hoy)} titulo="Traer para hoy">↓ Hoy</Accion>}
            {!resuelta && nota.tipo === 'ausencia' && (
              <Accion onClick={() => setAbierta(a => !a)} color={BRAND.teal} titulo="Definir el reemplazo">
                {nota.cubre ? `Cubre: ${nota.cubre}` : 'Cubrir'}
              </Accion>
            )}
            {resuelta && <Accion onClick={() => onDesmarcar(nota)} titulo="Se marcó por error">↩ Desmarcar</Accion>}

            <span style={{ marginLeft: 'auto' }}>
              {armado ? (
                <Accion onClick={() => onBorrar(nota)} color={ROJO} titulo="Borrar definitivamente">Borrar ✓</Accion>
              ) : (
                <Accion onClick={armarBorrar} titulo="Borrar la nota">✕</Accion>
              )}
            </span>
          </div>

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

          {/* Comentarios del equipo (cualquiera puede sumar uno) */}
          {comOpen && (
            <div style={{ marginTop: 9, paddingTop: 9, borderTop: `1px solid ${BRAND.border}`, display: 'flex', flexDirection: 'column', gap: 7 }}>
              {comentarios.length === 0 && <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.4)' }}>Sin comentarios todavía.</div>}
              {comentarios.map(c => {
                const h = c.created_at ? new Date(new Date(c.created_at).getTime() - 3 * 3600 * 1000).toISOString().slice(11, 16) : '';
                return (
                  <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 700, color: BRAND.teal, background: 'rgba(46,207,170,0.14)' }}>{(c.autor || '?')[0].toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: BRAND.white, lineHeight: 1.35, wordBreak: 'break-word' }}>{c.texto}</div>
                      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 1 }}>{c.autor}{h ? ` · ${h}` : ''}{c.autor === usuario ? <span onClick={() => onBorrarComentario(c.id)} style={{ color: ROJO, cursor: 'pointer', marginLeft: 6 }}>borrar</span> : null}</div>
                    </div>
                  </div>
                );
              })}
              <div style={{ display: 'flex', gap: 5 }}>
                <input type="text" value={comTxt} onChange={e => setComTxt(e.target.value)} placeholder="Escribir un comentario…"
                  onKeyDown={e => { if (e.key === 'Enter' && comTxt.trim()) enviarCom(); }}
                  style={{ ...inpSt, fontSize: 12.5, flex: 1, minWidth: 120 }} />
                <button type="button" onClick={enviarCom} disabled={!comTxt.trim()}
                  style={{ minHeight: 32, padding: '0 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, touchAction: 'manipulation', cursor: comTxt.trim() ? 'pointer' : 'default', border: `1px solid ${comTxt.trim() ? BRAND.teal : BRAND.border}`, background: comTxt.trim() ? 'rgba(46,207,170,0.14)' : 'rgba(255,255,255,0.04)', color: comTxt.trim() ? BRAND.teal : 'rgba(255,255,255,0.3)' }}>Enviar</button>
              </div>
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
        <span style={{ fontSize: 13, fontWeight: 600, color: col.color, letterSpacing: '0.01em' }}>{col.titulo}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.3)' }}>{notas.length}</span>
      </div>

      {notas.map(n => <Tarjeta key={n.id} nota={n} arrastrable={!esMovil} mostrarDia={col.mostrarDia} {...rest} />)}

      {!notas.length && !hechas.length && !creando && (
        <div style={{ padding: '14px 6px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.3)' }}>{col.vacio}</div>
          {col.creable && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>{col.pista}</div>
          )}
        </div>
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

  // Comentarios del equipo (hilo por nota)
  const [comentarios, setComentarios] = useState([]);
  useEffect(() => { cargarComentarios().then(setComentarios).catch(() => {}); }, []);
  useComentariosRealtime(useCallback((row, ev) => setComentarios(prev => aplicarCambioNota(prev, row, ev)), []));
  const comentariosByNota = useMemo(() => {
    const m = {};
    [...comentarios].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .forEach(c => { (m[c.nota_id] = m[c.nota_id] || []).push(c); });
    return m;
  }, [comentarios]);
  const comentar = (nota, texto) => {
    agregarComentario(nota.id, usuario, texto)
      .then(rows => { const c = Array.isArray(rows) ? rows[0] : null; if (c) setComentarios(prev => prev.some(x => x.id === c.id) ? prev : [...prev, c]); })
      .catch(e => setError('No se pudo comentar: ' + e.message));
  };
  const quitarComentario = (id) => { setComentarios(prev => prev.filter(c => c.id !== id)); borrarComentario(id).catch(() => {}); };
  const editar = (nota, campos) => {
    setNotas(prev => prev.map(n => n.id === nota.id ? { ...n, ...campos } : n));
    editarNota(nota.id, campos).catch(e => { setError('No se pudo editar: ' + e.message); recargar(); });
  };

  // ── Seguimiento: ausencias de días anteriores → sugerir si el cadete se reincorporó ──
  const nrm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const [ausPrevias, setAusPrevias] = useState([]);
  const [sugOcultas, setSugOcultas] = useState(() => { try { return new Set(JSON.parse(localStorage.getItem('flexit_pizarra_sug_ocultas') || '[]')); } catch { return new Set(); } });
  useEffect(() => {
    const desde = sumarDias(hoy, -4);
    sbFetch(`notas_operativas?select=*&tipo=eq.ausencia&fecha_objetivo=gte.${desde}&fecha_objetivo=lt.${hoy}&order=fecha_objetivo.desc`)
      .then(rows => setAusPrevias(Array.isArray(rows) ? rows : [])).catch(() => {});
  }, [hoy]);
  const ocultarSug = (id) => setSugOcultas(prev => { const n = new Set(prev); n.add(id); try { localStorage.setItem('flexit_pizarra_sug_ocultas', JSON.stringify([...n])); } catch {} return n; });
  const ausHoyTxt = useMemo(() => new Set(notas.filter(n => n.tipo === 'ausencia' && n.fecha_objetivo === hoy).map(n => nrm(n.texto))), [notas, hoy]);
  const sugerencias = useMemo(() => {
    const vistos = new Set();
    return ausPrevias.filter(a => {
      if (sugOcultas.has(a.id)) return false;
      const k = nrm(a.texto);
      if (ausHoyTxt.has(k) || vistos.has(k)) return false; // ya se cargó hoy, o repetido
      vistos.add(k); return true;
    });
  }, [ausPrevias, sugOcultas, ausHoyTxt]);
  const seguirFaltando = async (a) => {
    ocultarSug(a.id);
    try {
      await sbFetch('notas_operativas', { method: 'POST', body: JSON.stringify({ texto: a.texto, tipo: 'ausencia', prioridad: 'normal', fecha_objetivo: hoy, cadete: a.cadete || null, autor: usuario }) });
      recargar();
    } catch (e) { setError('No se pudo crear la nota: ' + e.message); }
  };

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

  const desmarcar = (nota) => {
    setNotas(prev => prev.map(n => n.id === nota.id ? { ...n, resuelta_por: null, resuelta_at: null } : n));
    return desmarcarNota(nota.id)
      .catch(e => { setError('No se pudo desmarcar: ' + e.message); recargar(); });
  };

  const borrar = (nota) => {
    setNotas(prev => prev.filter(n => n.id !== nota.id));
    return borrarNota(nota.id)
      .catch(e => { setError('No se pudo borrar: ' + e.message); recargar(); });
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
        { id: 'hoy', titulo: 'Hoy', color: BRAND.teal, fecha: hoy, creable: true, vacio: '✨ El día está limpio', pista: 'Agregá lo que haya que saber hoy', notas: ordenarNotas(resto.filter(n => n.fecha_objetivo === hoy)), hechas: comp },
        { id: 'manana', titulo: 'Mañana', color: '#8EC5FF', fecha: manana, creable: true, vacio: '✨ Nada para mañana', pista: 'O arrastrá algo desde Hoy', notas: ordenarNotas(resto.filter(n => n.fecha_objetivo === manana)), hechas: [] },
        { id: 'proximos', titulo: 'Próximos', color: LILA, creable: true, mostrarDia: true, vacio: '✨ Sin notas más adelante', pista: 'Ausencias avisadas, colectas especiales…', notas: prox, hechas: [] },
      ],
    };
  }, [notas, hoy, manana, ahora]);

  const visibles = cols.filter(c => !c.soloSiHay || c.notas.length || c.hechas.length);
  const props = {
    clientesById, hoy, usuario, comentariosByNota,
    onResolver: n => resolver(n),
    onDesmarcar: desmarcar,
    onBorrar: borrar,
    onCubrir: (n, c) => resolver(n, { cubre: c }),
    onMover: mover,
    onEditar: editar,
    onComentar: comentar,
    onBorrarComentario: quitarComentario,
  };

  return (
    <div>
      <style>{`
        @keyframes fxNotaIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
        .fx-nota { animation: fxNotaIn .2s ease both; }
        .fx-crear { animation: fxNotaIn .18s ease both; }
      `}</style>

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
          {/* Seguimiento: la pizarra recuerda las faltas de días anteriores y pregunta si volvió */}
          {sugerencias.length > 0 && (
            <div style={{ marginBottom: 12, padding: '11px 14px', borderRadius: 12, border: `1px solid ${BRAND.teal}40`, background: 'rgba(46,207,170,0.06)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: BRAND.teal, marginBottom: 8 }}>💡 Seguimiento</div>
              {sugerencias.map(a => (
                <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '7px 0', borderTop: `1px solid ${BRAND.border}` }}>
                  <span style={{ flex: 1, minWidth: 170, fontSize: 13, color: BRAND.white }}>
                    {labelDia(a.fecha_objetivo, hoy) === 'ayer' ? 'Ayer' : `El ${labelDia(a.fecha_objetivo, hoy)}`} faltó: <b>{a.texto}</b>. ¿Se reincorporó hoy?
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" onClick={() => ocultarSug(a.id)}
                      style={{ minHeight: 32, padding: '0 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', border: `1px solid ${BRAND.teal}`, background: 'rgba(46,207,170,0.12)', color: BRAND.teal }}>✓ Volvió</button>
                    <button type="button" onClick={() => seguirFaltando(a)}
                      style={{ minHeight: 32, padding: '0 11px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', border: `1px solid ${AMBAR}`, background: `${AMBAR}22`, color: AMBAR }}>Sigue faltando</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <BloqueObjetivos usuario={usuario} esMovil={esMovil} />

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
