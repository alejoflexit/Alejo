// Buscar envío — de un mensaje de WhatsApp al estado del envío en un toque.
// Se abre desde: el menú, el atajo del ícono de la app (manifest shortcuts), "Compartir → Flexit" en
// Android (share_target del manifest) y el atajo de iPhone (abre /?text=...). En todos los casos el
// texto del mensaje llega como `inicial`: se sacan los números (tracking, envío ML, ID) y se busca solo.
// Reusa el panel de la Tiquetera (estado + cadete + historial en vivo de LightData).
import React, { useEffect, useState } from 'react';
import { getSession } from './auth';
import { LoginFlexit } from './colectasShared';
import { PanelEnvio, sbTiquetera as sb, numerosDelTexto } from './Tiquetera';

const COLS = 'id_interno,nombre,direccion,localidad,estado,fecha_estado,cadete,razon_social,fecha_flexit';

async function buscar(texto) {
  const nums = numerosDelTexto(texto);
  if (nums.length) {
    const list = nums.join(',');
    const rows = await sb(`envios_busqueda?or=(id_venta_ml.in.(${list}),id_interno.in.(${list}),tracking.in.(${list}))&select=${COLS}&limit=10`);
    if (rows && rows.length) return rows;
  }
  // sin números (o no matchearon): por nombre / dirección, todas las palabras
  const pal = String(texto || '').toLowerCase().replace(/[^a-záéíóúñü0-9 ]/gi, ' ').split(/\s+/).filter((p) => p.length >= 3).slice(0, 4);
  if (!pal.length) return [];
  const filtros = pal.map((p) => `or(nombre.ilike.*${encodeURIComponent(p)}*,direccion.ilike.*${encodeURIComponent(p)}*)`).join(',');
  return (await sb(`envios_busqueda?and=(${filtros})&select=${COLS}&order=actualizado_at.desc&limit=10`)) || [];
}

export default function BuscarEnvio({ inicial = '' }) {
  const [sesion, setSesion] = useState(() => getSession());
  const [texto, setTexto] = useState(inicial);
  const [res, setRes] = useState(null);   // null = sin buscar; [] = sin resultados
  const [elegido, setElegido] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const correr = async (t) => {
    const q = String(t ?? texto).trim();
    if (!q) return;
    setBusy(true); setErr(''); setElegido(null);
    try {
      const rows = await buscar(q);
      setRes(rows);
      if (rows.length === 1) setElegido(rows[0].id_interno);
    } catch (e) { setErr('No se pudo buscar: ' + e.message); setRes(null); }
    setBusy(false);
  };

  // si llegó texto (compartido desde WhatsApp o por link), buscar apenas haya sesión
  useEffect(() => { if (sesion && inicial) correr(inicial); }, [sesion, inicial]); // eslint-disable-line react-hooks/exhaustive-deps

  const pegar = async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { setTexto(t); correr(t); } }
    catch { setErr('El navegador no dejó leer el portapapeles: pegalo a mano en el recuadro.'); }
  };

  if (!sesion) return <LoginFlexit titulo="Buscar envío" icono="🔎" onOk={() => setSesion(getSession())} />;

  const boton = { padding: '10px 16px', borderRadius: 10, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' };
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '8px 0 40px' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); correr(); } }}
          placeholder="Pegá el mensaje del cliente, el número de envío, el tracking o la dirección"
          style={{ flex: '1 1 260px', minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(0,0,0,0.25)', color: '#fff', fontSize: 15, resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <button onClick={pegar} style={{ ...boton, background: 'rgba(255,255,255,0.08)', color: '#fff' }}>📋 Pegar</button>
          <button onClick={() => correr()} disabled={busy} style={{ ...boton, background: '#2ECFAA', color: '#04150f' }}>{busy ? 'Buscando…' : 'Buscar'}</button>
        </div>
      </div>
      {err && <div style={{ color: '#FFB020', fontSize: 13, marginTop: 10 }}>{err}</div>}

      {res && res.length === 0 && (
        <div style={{ marginTop: 18, color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 1.6 }}>
          No encontré ese envío en los últimos días. Probá con el número de envío de ML (empieza con 2000017…), el tracking o la calle y altura.
        </div>
      )}

      {res && res.length > 1 && !elegido && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>Encontré {res.length}. ¿Cuál es?</div>
          {res.map((r) => (
            <button key={r.id_interno} onClick={() => setElegido(r.id_interno)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', marginBottom: 6, borderRadius: 10, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', color: '#fff', cursor: 'pointer' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{r.nombre || '—'} <span style={{ color: 'rgba(255,255,255,0.4)', fontWeight: 400 }}>#{r.id_interno}</span></div>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.6)' }}>{[r.direccion, r.localidad].filter(Boolean).join(', ')} · {r.estado || 'sin estado'} · {r.razon_social || ''}</div>
            </button>
          ))}
        </div>
      )}

      {elegido && (
        <div style={{ marginTop: 18, padding: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)' }}>
          {res && res.length > 1 && (
            <button onClick={() => setElegido(null)} style={{ background: 'none', border: 'none', color: '#4A9EFF', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 10 }}>← Ver los {res.length} resultados</button>
          )}
          <PanelEnvio caso={{ envio_id: elegido, mensaje: texto }} />
        </div>
      )}
    </div>
  );
}
