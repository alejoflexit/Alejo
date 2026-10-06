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

// Grupos ordenados por parecido con el nombre del cliente (para no buscar entre 100)
function ordenarGrupos(grupos, nombre) {
  const toks = normNombre(nombre).split(' ').filter(t => t.length >= 3);
  const score = g => { const n = normNombre(g.nombre_grupo); return toks.filter(t => n.includes(t)).length; };
  return [...grupos].sort((a, b) => (score(b) - score(a)) || String(a.nombre_grupo).localeCompare(String(b.nombre_grupo)));
}

export default function ColectasBot({ clientes, onClienteActualizado, onClose }) {
  const [grupos, setGrupos] = useState(null);
  const [errorGrupos, setErrorGrupos] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState('todos'); // todos | faltan | prendidos
  const [guardando, setGuardando] = useState({}); // id → true
  const [avisos, setAvisos] = useState({}); // id → texto
  const [copiado, setCopiado] = useState(null);

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

  const lista = useMemo(() => {
    const q = normNombre(busqueda);
    return [...clientes]
      .filter(c => !q || normNombre(c.nombre).includes(q))
      .filter(c => filtro === 'todos' ? true : filtro === 'prendidos' ? c.bot_habilitado : (!c.fija && !c.bot_habilitado))
      .sort((a, b) => (!!a.fija - !!b.fija) || String(a.nombre).localeCompare(String(b.nombre)));
  }, [clientes, busqueda, filtro]);

  const configurar = async (c, habilitado, chatId) => {
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
            const opciones = ordenarGrupos(grupos, c.nombre);
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

                <select value={c.chat_id || ''} disabled={c.fija || ocupado}
                  onChange={e => configurar(c, c.bot_habilitado && !!e.target.value, e.target.value)}
                  aria-label={`Grupo de WhatsApp de ${c.nombre}`} style={sel}>
                  <option value="">— Elegí el grupo —</option>
                  {opciones.map(o => (
                    <option key={o.chat_id} value={o.chat_id}>
                      {o.nombre_grupo}{o.estado === 'activo' ? ' (agente)' : o.estado === 'inactivo' ? ' (pausado)' : ''}
                    </option>
                  ))}
                </select>

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
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
