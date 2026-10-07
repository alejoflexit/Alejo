// Panel "Bot de confirmación" de Colectas (piloto CABA, 2026-10).
// El equipo prende el bot por cliente y le asigna su grupo de WhatsApp. Con eso:
//  - el cliente tiene un link fijo (colectas_clientes.bot_token) → public/colecta.html
//  - a las 9:00 (lun-vie) pg_cron encola el mensaje con el link (colecta_bot_encolar)
//  - el bot (n8n "Enviar aprobados") lo manda escalonado, un mensaje cada ~20 s
// Prender/apagar va por la función colecta_bot_configurar: es la que pasa el grupo a 'solo_envio'
// (el bot manda ahí pero no lee ni contesta). El equipo no puede escribir agente_config directo.
import React, { useEffect, useMemo, useState } from 'react';
import { sbFetch, BRAND, normNombre } from './colectasShared';

const linkDe = (c) => `${window.location.origin}/colecta.html?t=${c.bot_token}`;

// ── Parecido cliente ↔ grupo ──
// Los grupos se llaman tipo "Soporte Sabor Pampeano - Flexit" y el cliente "Sabor Pameano" (¡con typo!):
// se comparan palabra por palabra, sin las de relleno, tolerando 1-2 letras de diferencia.
const RELLENO = new Set(['soporte', 'flexit', 'grupo', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'sa', 'srl', 'sas', 'envios', 'colectas']);
const palabras = s => normNombre(s).replace(/[^a-z0-9 ]/g, ' ').split(' ').filter(t => t.length >= 2 && !RELLENO.has(t));
function distancia(a, b) {
  const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const parecidas = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && distancia(a, b) <= (Math.max(a.length, b.length) >= 8 ? 2 : 1))
  || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
// 0..1: qué parte de las palabras del cliente aparecen en el nombre del grupo
function parecido(cliente, grupo) {
  const pc = palabras(cliente), pg = palabras(grupo);
  if (!pc.length || !pg.length) return 0;
  return pc.filter(t => pg.some(u => parecidas(t, u))).length / pc.length;
}
// Grupos ordenados por parecido con el cliente (los más parecidos arriba)
function ordenarGrupos(grupos, nombre) {
  return grupos.map(g => ({ g, p: parecido(nombre, g.nombre_grupo) }))
    .sort((a, b) => (b.p - a.p) || String(a.g.nombre_grupo).localeCompare(String(b.g.nombre_grupo)))
    .map(x => ({ ...x.g, parecido: x.p }));
}

export default function ColectasBot({ clientes, onClienteActualizado, onClose }) {
  const [grupos, setGrupos] = useState(null);
  const [errorGrupos, setErrorGrupos] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos'); // todos | faltan | prendidos
  const [guardando, setGuardando] = useState({}); // id → true
  const [avisos, setAvisos] = useState({}); // id → texto
  const [copiado, setCopiado] = useState(null);
  const [abierto, setAbierto] = useState(null); // cliente con el buscador de grupo abierto
  const [qGrupo, setQGrupo] = useState('');
  const [vinculando, setVinculando] = useState(false);

  useEffect(() => {
    sbFetch('agente_config?tipo=eq.grupo&select=chat_id,nombre_grupo,estado,envio_habilitado&order=nombre_grupo.asc')
      .then(setGrupos)
      .catch(e => { setGrupos([]); setErrorGrupos('No se pudieron cargar los grupos del bot: ' + e.message); });
  }, []);

  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const preguntables = clientes.filter(c => !c.fija);
  const prendidos = preguntables.filter(c => c.bot_habilitado).length;
  const grupoDe = chat => (grupos || []).find(g => g.chat_id === chat);

  // Sugerencia automática: el grupo que coincide con TODAS las palabras del cliente, si es uno solo
  // y no está asignado a otro cliente. Si hay dudas (dos candidatos parecidos) no sugiere nada.
  const sugerencias = useMemo(() => {
    const out = {};
    if (!grupos) return out;
    const usados = new Set(clientes.map(c => c.chat_id).filter(Boolean));
    clientes.forEach(c => {
      if (c.fija || c.chat_id) return;
      const cands = grupos.filter(g => !usados.has(g.chat_id) && parecido(c.nombre, g.nombre_grupo) >= 0.999);
      if (cands.length === 1) out[c.id] = cands[0];
    });
    return out;
  }, [grupos, clientes]);
  const nSugeridos = Object.keys(sugerencias).length;

  const lista = useMemo(() => {
    const q = normNombre(busqueda);
    return [...clientes]
      .filter(c => !q || normNombre(c.nombre).includes(q))
      .filter(c => filtro === 'todos' ? true : filtro === 'prendidos' ? c.bot_habilitado : (!c.fija && !c.bot_habilitado))
      .sort((a, b) => (!!a.fija - !!b.fija) || String(a.nombre).localeCompare(String(b.nombre)));
  }, [clientes, busqueda, filtro]);

  const configurar = async (c, habilitado, chatId) => {
    setAbierto(null);
    setGuardando(p => ({ ...p, [c.id]: true }));
    setAvisos(p => ({ ...p, [c.id]: '' }));
    try {
      const r = await sbFetch('rpc/colecta_bot_configurar', {
        method: 'POST',
        body: JSON.stringify({ p_cliente: c.id, p_habilitado: habilitado, p_chat_id: chatId || null }),
      });
      if (r && r.ok === false) {
        setAvisos(p => ({ ...p, [c.id]: r.aviso || 'No se pudo guardar' }));
      } else {
        onClienteActualizado({ ...c, bot_habilitado: habilitado, chat_id: chatId || null });
        if (r && r.aviso) setAvisos(p => ({ ...p, [c.id]: r.aviso }));
        // refrescar estados de grupo (pendiente ↔ solo_envio)
        sbFetch('agente_config?tipo=eq.grupo&select=chat_id,nombre_grupo,estado,envio_habilitado&order=nombre_grupo.asc').then(setGrupos).catch(() => {});
      }
    } catch (e) {
      setAvisos(p => ({ ...p, [c.id]: 'Error: ' + e.message }));
    } finally {
      setGuardando(p => ({ ...p, [c.id]: false }));
    }
  };

  const vincularSugeridos = async () => {
    if (!nSugeridos || vinculando) return;
    if (!window.confirm(`Vincular ${nSugeridos} cliente(s) con el grupo sugerido? (El bot queda apagado: lo prendés después en cada uno.)`)) return;
    setVinculando(true);
    for (const c of clientes) { const g = sugerencias[c.id]; if (g) await configurar(c, false, g.chat_id); }
    setVinculando(false);
  };

  const copiar = async c => {
    try { await navigator.clipboard.writeText(linkDe(c)); }
    catch { window.prompt('Copiá el link:', linkDe(c)); }
    setCopiado(c.id); setTimeout(() => setCopiado(x => (x === c.id ? null : x)), 1800);
  };

  const sel = { padding: '6px 8px', fontSize: 12, border: `1px solid ${BRAND.border}`, borderRadius: 8, background: '#0E1E38', color: BRAND.white, outline: 'none', width: '100%' };
  const chip = activo => ({ padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: `1px solid ${activo ? BRAND.teal : BRAND.border}`, background: activo ? 'rgba(46,207,170,0.12)' : 'transparent', color: activo ? BRAND.teal : BRAND.muted });

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1300 }} />
      <div role="dialog" aria-modal="true" aria-label="Bot de confirmación de colectas"
        style={{ position: 'fixed', top: '5vh', left: '50%', transform: 'translateX(-50%)', width: 'min(860px, calc(100vw - 24px))', maxHeight: '90vh', display: 'flex', flexDirection: 'column', zIndex: 1301, background: BRAND.navyMid, border: `1px solid ${BRAND.border}`, borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.5)', color: BRAND.white }}>

        {/* Encabezado */}
        <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${BRAND.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <i className="ti ti-robot" aria-hidden="true" style={{ fontSize: 20, color: BRAND.teal }} />
            <div style={{ fontWeight: 700, fontSize: 16 }}>Bot de confirmación · CABA</div>
            <div style={{ marginLeft: 8, padding: '2px 10px', borderRadius: 20, background: 'rgba(46,207,170,0.12)', color: BRAND.teal, fontSize: 12, fontWeight: 700 }}>
              {prendidos} de {preguntables.length} configurados
            </div>
            <button onClick={onClose} aria-label="Cerrar" style={{ marginLeft: 'auto', border: 'none', background: 'none', color: BRAND.muted, fontSize: 18, cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 8, lineHeight: 1.5 }}>
            Prendé el bot y elegí el grupo de cada cliente. De lunes a viernes a las 9:00 el bot le manda su link al grupo; lo que responda aparece solo en Colectas (amarillo = sí, rojo = hoy no). Los fijos no se preguntan.
            {' '}¿No aparece el grupo? Agregá el número del bot al grupo de WhatsApp y esperá unos 15 minutos.
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar cliente..."
              style={{ ...sel, width: 200, background: BRAND.faint }} />
            <button style={chip(filtro === 'todos')} onClick={() => setFiltro('todos')}>Todos</button>
            <button style={chip(filtro === 'faltan')} onClick={() => setFiltro('faltan')}>Sin configurar ({preguntables.length - prendidos})</button>
            <button style={chip(filtro === 'prendidos')} onClick={() => setFiltro('prendidos')}>Prendidos ({prendidos})</button>
            {nSugeridos > 0 && (
              <button onClick={vincularSugeridos} disabled={vinculando}
                title="Vincula cada cliente con el grupo que coincide con su nombre. El bot queda apagado."
                style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(251,191,36,0.45)', background: 'rgba(251,191,36,0.10)', color: '#FBBF24', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <i className="ti ti-sparkles" aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {vinculando ? 'Vinculando…' : `Vincular ${nSugeridos} sugerido${nSugeridos === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
          {errorGrupos && <div style={{ marginTop: 8, fontSize: 12, color: '#E24B4A' }}>{errorGrupos}</div>}
        </div>

        {/* Lista */}
        <div style={{ overflowY: 'auto', padding: '6px 8px 12px' }}>
          {grupos === null && <div style={{ padding: 24, textAlign: 'center', color: BRAND.muted, fontSize: 13 }}>Cargando grupos…</div>}
          {grupos !== null && lista.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: BRAND.muted, fontSize: 13 }}>No hay clientes con ese filtro.</div>}
          {grupos !== null && lista.map(c => {
            const g = grupoDe(c.chat_id);
            const ocupado = !!guardando[c.id];
            const grupoOk = g && ['activo', 'solo_envio'].includes(g.estado) && g.envio_habilitado;
            return (
              <div key={c.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px,1.1fr) minmax(180px,1.6fr) auto auto', gap: 10, alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${BRAND.border}`, opacity: c.fija ? 0.55 : 1 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nombre}</div>
                  <div style={{ fontSize: 11, color: c.fija ? '#FBBF24' : c.bot_habilitado ? (grupoOk ? BRAND.teal : '#FBBF24') : BRAND.muted, marginTop: 2 }}>
                    {c.fija ? 'Fijo — no se pregunta'
                      : c.bot_habilitado ? (grupoOk ? 'Prendido · recibe el link a las 9' : 'Prendido, pero el grupo no puede recibir')
                      : 'Apagado'}
                  </div>
                  {avisos[c.id] && <div style={{ fontSize: 11, color: '#FBBF24', marginTop: 2 }}>{avisos[c.id]}</div>}
                </div>

                <button type="button" disabled={c.fija || ocupado}
                  onClick={() => { setAbierto(abierto === c.id ? null : c.id); setQGrupo(''); }}
                  aria-expanded={abierto === c.id} aria-label={`Grupo de WhatsApp de ${c.nombre}`}
                  style={{ ...sel, textAlign: 'left', cursor: c.fija ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: g ? BRAND.white : BRAND.muted }}>
                    {g ? g.nombre_grupo : c.chat_id ? 'Grupo no encontrado' : '— Elegí el grupo —'}
                  </span>
                  <i className={abierto === c.id ? 'ti ti-chevron-up' : 'ti ti-chevron-down'} aria-hidden="true" style={{ color: BRAND.muted }} />
                </button>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: c.fija ? 'default' : 'pointer', fontSize: 12, color: BRAND.muted, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={!!c.bot_habilitado} disabled={c.fija || ocupado || (!c.bot_habilitado && !c.chat_id)}
                    onChange={e => configurar(c, e.target.checked, c.chat_id)}
                    style={{ width: 16, height: 16, accentColor: BRAND.teal, cursor: 'inherit' }} />
                  Bot
                </label>

                <button onClick={() => copiar(c)} disabled={c.fija}
                  title="Copiar el link de este cliente (para mandarlo a mano o fijarlo en el grupo)"
                  style={{ padding: '5px 10px', borderRadius: 8, border: `1px solid ${BRAND.border}`, background: 'transparent', color: copiado === c.id ? BRAND.teal : BRAND.white, fontSize: 12, cursor: c.fija ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                  <i className={copiado === c.id ? 'ti ti-check' : 'ti ti-link'} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {copiado === c.id ? 'Copiado' : 'Copiar link'}
                </button>

                {sugerencias[c.id] && abierto !== c.id && (
                  <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#FBBF24', marginTop: -2 }}>
                    <i className="ti ti-sparkles" aria-hidden="true" />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Sugerido: <b>{sugerencias[c.id].nombre_grupo}</b></span>
                    <button onClick={() => configurar(c, false, sugerencias[c.id].chat_id)} disabled={ocupado}
                      style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid rgba(251,191,36,0.45)', background: 'rgba(251,191,36,0.10)', color: '#FBBF24', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                      Vincular
                    </button>
                  </div>
                )}

                {abierto === c.id && (() => {
                  const usadosPor = {};
                  clientes.forEach(x => { if (x.chat_id && x.id !== c.id) usadosPor[x.chat_id] = x.nombre; });
                  const q = normNombre(qGrupo);
                  const lista = ordenarGrupos(grupos, c.nombre).filter(o => !q || normNombre(o.nombre_grupo).includes(q));
                  return (
                    <div style={{ gridColumn: '1 / -1', background: '#0E1E38', border: `1px solid ${BRAND.border}`, borderRadius: 10, padding: 8 }}>
                      <input autoFocus value={qGrupo} onChange={e => setQGrupo(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setAbierto(null); } if (e.key === 'Enter' && lista[0]) configurar(c, c.bot_habilitado, lista[0].chat_id); }}
                        placeholder="Buscar grupo…" aria-label="Buscar grupo"
                        style={{ ...sel, background: BRAND.faint, marginBottom: 6 }} />
                      <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                        {lista.length === 0 && <div style={{ fontSize: 12, color: BRAND.muted, padding: 8 }}>Ningún grupo con ese nombre. ¿Ya agregaron el bot al grupo?</div>}
                        {lista.map(o => {
                          const elegido = o.chat_id === c.chat_id;
                          return (
                            <button key={o.chat_id} onClick={() => configurar(c, c.bot_habilitado, o.chat_id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '7px 8px', borderRadius: 6, border: 'none', background: elegido ? 'rgba(46,207,170,0.12)' : 'transparent', color: BRAND.white, fontSize: 12, cursor: 'pointer' }}>
                              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.nombre_grupo}</span>
                              {o.parecido >= 0.999 && !usadosPor[o.chat_id] && <span style={{ fontSize: 11, color: '#FBBF24' }}>coincide</span>}
                              {usadosPor[o.chat_id] && <span style={{ fontSize: 11, color: BRAND.muted }}>ya es de {usadosPor[o.chat_id]}</span>}
                              {o.estado === 'activo' && <span style={{ fontSize: 11, color: BRAND.muted }}>agente</span>}
                              {o.estado === 'inactivo' && <span style={{ fontSize: 11, color: '#E24B4A' }}>pausado</span>}
                              {elegido && <i className="ti ti-check" aria-hidden="true" style={{ color: BRAND.teal }} />}
                            </button>
                          );
                        })}
                      </div>
                      {c.chat_id && (
                        <button onClick={() => configurar(c, false, '')}
                          style={{ marginTop: 6, padding: '4px 8px', border: 'none', background: 'none', color: BRAND.muted, fontSize: 12, cursor: 'pointer' }}>
                          Quitar grupo
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
