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

// "Desglosa" el mensaje del cliente: qué pide, el número de orden/envío y la dirección nueva.
// Los números cortos (pedidos de Tienda Nube/Shopify, 3-6 dígitos) solo cuentan si vienen con una
// palabra clave ("Orden 91709", "pedido #1234"); así la altura o el CP de una dirección no se confunden.
export function desglosar(texto) {
  const t = String(texto || '');
  const conClave = [...t.matchAll(/(?:orden|pedido|venta|env[ií]o|tracking|seguimiento|n[°ºro.]*|#)\s*[:#n°º.]*\s*(\d{3,})/gi)].map((m) => m[1]);
  const largos = numerosDelTexto(t); // 6+ dígitos (envío ML, tracking, ID)
  const numeros = [...new Set([...conClave, ...largos])].slice(0, 8);
  const low = t.toLowerCase();
  // qué pide el cliente (puede ser más de una cosa)
  const etiquetas = [
    [/reclamo|producto (diferente|equivocado|incorrecto)|otro domicilio|entregaron (otro|mal)|no es el que/, 'Reclamo: entrega equivocada'],
    [/es un cambio|\bcambio\b(?! de direcci)|retirar (el|un) producto|devoluci/, 'Cambio de producto (retiro)'],
    [/cambi\w* (de |la )?direcci|otra direcci|direcci\w* (nueva|correcta)/, 'Cambio de dirección'],
    [/reprogram|otro d[ií]a/, 'Reprogramar'],
    [/cancel/, 'Cancelar envío'],
    [/d[oó]nde est|no (me )?lleg|cu[aá]ndo llega/, 'Consulta de estado'],
  ].filter(([re]) => re.test(low)).map(([, txt]) => txt);
  const hora = low.match(/antes de las? (\d{1,2})(?::(\d{2}))?/);
  if (hora) etiquetas.push(`Urgente: antes de las ${hora[1]}${hora[2] ? ':' + hora[2] : ''} hs`);
  else if (/(entregue|entregar|llegue|pasen)\w* hoy|urgente/.test(low)) etiquetas.push('Urgente: entregar hoy');
  const pedido = etiquetas.join(' · ');
  let direccion = '', cp = '';
  const mCp = t.match(/c\.?\s*p\.?\s*:?\s*(\d{4})/i) || t.match(/\b([A-Z]\d{4}[A-Z]{3})\b/);
  if (mCp) cp = mCp[1];
  const mDir = t.match(/direcci[oó]n[^:\n]*:?\s*\n?([\s\S]+)$/i);
  if (mDir) {
    direccion = mDir[1].split('\n').map((l) => l.trim()).filter(Boolean).join(' ')
      .replace(/\s*-\s*/g, ', ').replace(/c\.?\s*p\.?\s*:?\s*\d{4},?\s*/i, '').replace(/,\s*,/g, ',').replace(/[.,\s]+$/, '').trim();
  }
  return { numeros, pedido, direccion, cp };
}

async function buscar(texto) {
  const nums = desglosar(texto).numeros;
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

      {res !== null && (() => {
        const d = desglosar(texto);
        if (!d.pedido && !d.direccion && !d.numeros.length) return null;
        const copiar = (v) => { try { navigator.clipboard.writeText(v); } catch {} };
        const filas = [
          d.pedido && ['Pide', d.pedido],
          d.numeros.length && ['N° de orden / envío', d.numeros.join(' · ')],
          d.direccion && ['Dirección nueva', d.direccion],
          d.cp && ['CP', d.cp],
        ].filter(Boolean);
        return (
          <div style={{ marginTop: 14, padding: '10px 14px', borderRadius: 12, background: 'rgba(74,158,255,0.07)', border: '1px solid rgba(74,158,255,0.25)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>Lo que entendí del mensaje</div>
            {filas.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 0', fontSize: 14 }}>
                <span style={{ width: 128, flexShrink: 0, color: 'rgba(255,255,255,0.45)', fontSize: 12.5 }}>{k}</span>
                <span style={{ flex: 1, color: '#fff', wordBreak: 'break-word' }}>{v}</span>
                {k !== 'Pide' && <button onClick={() => copiar(v)} style={{ background: 'none', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', borderRadius: 7, fontSize: 11.5, padding: '3px 8px', cursor: 'pointer' }}>Copiar</button>}
              </div>
            ))}
          </div>
        );
      })()}

      {res && res.length === 0 && (
        <div style={{ marginTop: 18, color: 'rgba(255,255,255,0.6)', fontSize: 14, lineHeight: 1.6 }}>
          No encontré ese envío en los últimos días. Si es un pedido de Tienda Nube o Shopify, el número de orden tiene que coincidir con el que cargó el cliente; si no, probá con el número de envío de ML (empieza con 2000017…), el tracking o el nombre del destinatario.
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
