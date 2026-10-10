// Buscar envío — de un mensaje de WhatsApp al estado del envío en un toque.
// Se abre desde: el menú, el atajo del ícono de la app (manifest shortcuts), "Compartir → Flexit" en
// Android (share_target del manifest) y el atajo de iPhone (abre /?text=...). En todos los casos el
// texto del mensaje llega como `inicial`: se sacan los números (tracking, envío ML, ID) y se busca solo.
// Reusa el panel de la Tiquetera (estado + cadete + historial en vivo de LightData).
import React, { useEffect, useState } from 'react';
import { getSession } from './auth';
import { LoginFlexit } from './colectasShared';
import { PanelEnvio, sbTiquetera as sb, numerosDelTexto } from './Tiquetera';

const COLS = 'id_interno,nombre,direccion,cp,localidad,estado,fecha_estado,cadete,razon_social,fecha_flexit';

// "Desglosa" el mensaje del cliente: qué pide, el número de orden/envío y la dirección nueva.
// Los números cortos (pedidos de Tienda Nube/Shopify, 3-6 dígitos) solo cuentan si vienen con una
// palabra clave ("Orden 91709", "pedido #1234"); así la altura o el CP de una dirección no se confunden.
export function desglosar(texto) {
  const t = String(texto || '');
  // La palabra clave tiene que ser una palabra entera: antes "n" suelto matcheaba el final de
  // "San Martín 487" y la altura de la calle se buscaba como número de pedido.
  const conClave = [...t.matchAll(/(?:\b(?:orden|pedido|venta|env[ií]o|tracking|seguimiento|nro|n[°º.])|#)\s*[:#n°º.]*\s*(\d{3,})/gi)].map((m) => m[1]);
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

// Palabras de relleno que aparecen en los mensajes y no sirven para buscar por nombre/dirección.
const RELLENO = new Set(('envio envío prioritario express domicilio direccion dirección calle casa depto dpto piso referencia referencias aparece gps poniendo '
  + 'entre esquina continuacion continuación altura barrio localidad hola buenas buen dia día dias días tardes noches por favor pedido orden cliente clienta '
  + 'nombre entregar entrega entreguen hoy mañana urgente gracias las los del hasta desde antes despues después horas hora compra despachado despachada '
  + 'fecha venta ventas recibe datos transportista cambio comprador reprogramada reprogramado figura consulta consultar llamar numero número '
  + 'entregado entregada recibido recibio recibió llego llegó paso pasó dice info novedad estado '
  + 'ene feb mar abr may jun jul ago sep set oct nov dic lunes martes miercoles miércoles jueves viernes sabado sábado domingo').split(' '));

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
// Vocales como comodín de una letra en un ilike: "martin" también encuentra "Martín" en la base.
const comodin = (s) => encodeURIComponent(sinTildes(s).toLowerCase().replace(/[aeiou]/g, '_'));

// "San Martín 487", "Av. Rivadavia 14048" → [{ calle: 'martin', altura: '487' }]: la última palabra
// antes de un número de 1 a 5 cifras. También las calles numeradas de La Plata ("Calle 50 2309").
// Se descartan horarios ("hasta las 18", "a las 17:30", "18 hs") y fechas.
export function callesConAltura(texto) {
  const t = sinTildes(texto);
  const out = [];
  for (const m of t.matchAll(/\b(?:calle|diagonal|diag\.?)\s+(\d{1,3})\s+(?:n[°º.]?\s*)?(\d{2,5})\b/gi)) {
    out.push({ calle: m[1], altura: m[2] });
  }
  for (const m of t.matchAll(/([a-zñ]{3,})\.?\s+(\d{1,5})\b(?!\s*(?::|\/|hs\b|h\b|horas\b|hrs\b))/gi)) {
    const calle = m[1].toLowerCase();
    if (RELLENO.has(calle) || /^(cp|nro|numero|orden|pedido|venta|envio|tracking)$/.test(calle)) continue;
    out.push({ calle, altura: m[2] });
  }
  return out.slice(0, 4);
}

// "Recibe: Karen Vera" (el bloque "Datos del envío" que copian de Mercado Libre). Los nombres
// enmascarados ("L ***** s") no sirven.
export function recibeDe(texto) {
  const m = String(texto || '').match(/recibe\s*:\s*\**\s*([^\n*\[]{3,60})/i);
  if (!m) return '';
  const n = m[1].replace(/\s+/g, ' ').trim();
  return /\*/.test(n) || n.split(' ').filter((w) => w.length >= 2).length < 2 ? '' : n;
}

// Números sueltos de 3 a 6 cifras que no son altura, CP, hora ni fecha: pueden ser un pedido de
// Tienda Nube/Shopify ("14262 figura entregado"). Son débiles: un mismo número de pedido se repite
// entre clientes (medido: ~8% de los pedidos cortos), así que nunca se abren solos.
export function numerosSueltos(texto, d, calles) {
  const usados = new Set([...d.numeros, d.cp, ...calles.map((c) => c.altura)].filter(Boolean));
  const t = String(texto || '').replace(/@\d+/g, ' ').replace(/\b\d{2,5}-\d{3,5}\b/g, ' ').replace(/\b\d{1,2}[/:.-]\d{1,2}([/:.-]\d{2,4})?\b/g, ' ');
  const out = [];
  for (const m of t.matchAll(/(?:^|[^\d\w])(\d{3,6})(?!\d)(?!\s*(?:hs\b|h\b|horas\b|hrs\b|pulgadas|mm\b|km\b|kg\b|w\b))/gi)) {
    if (!usados.has(m[1])) out.push(m[1]);
  }
  return [...new Set(out)].slice(0, 5);
}

// Ordena los resultados por las pistas del mensaje (CP, calle + altura, nombre de quien recibe) y,
// a igualdad, el envío más nuevo primero. Devuelve también si el primero gana claramente.
function ordenar(rows, pistas) {
  const nombreTok = sinTildes(pistas.recibe).toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const puntaje = (r) => {
    let p = 0;
    if (pistas.cp && String(r.cp || '') === pistas.cp) p += 3;
    const dir = sinTildes(r.direccion).toLowerCase();
    if (pistas.calles.some(({ calle, altura }) => dir.includes(calle) && new RegExp(`(^|\\D)${altura}(\\D|$)`).test(dir))) p += 3;
    const nom = sinTildes(r.nombre).toLowerCase();
    if (nombreTok.length && nombreTok.every((w) => nom.includes(w))) p += 3;
    return p;
  };
  const conP = rows.map((r) => ({ r, p: puntaje(r), id: Number(r.id_interno) || 0 }));
  conP.sort((a, b) => b.p - a.p || b.id - a.id);
  const claro = conP.length === 1 || (conP.length > 1 && conP[0].p >= 3 && conP[0].p > conP[1].p);
  return { rows: conP.map((x) => x.r), claro };
}

// Devuelve { rows, via, abrir }: `abrir` = se puede abrir solo el primero (match fuerte o pista clara).
async function buscar(texto) {
  const d = desglosar(texto);
  const calles = callesConAltura(texto);
  const recibe = recibeDe(texto);
  const pistas = { cp: d.cp, calles, recibe };
  const res = (rows, via, fuerte) => {
    const o = ordenar(rows, pistas);
    return { rows: o.rows, via, abrir: fuerte ? o.claro : o.claro && o.rows.length === 1 };
  };
  // Si escribieron solo un número ("91855", "#1234"), es a propósito: se busca tal cual.
  const solo = String(texto || '').trim().match(/^#?\s*(\d{3,})$/);
  const nums = solo ? [solo[1]] : d.numeros;
  // Tracking alfanumérico ("R207603841").
  const alfa = [...new Set((String(texto || '').match(/\b[A-Z]{1,3}\d{6,}\b/g) || []))].slice(0, 3);
  if (nums.length || alfa.length) {
    const list = nums.join(',');
    const conds = [
      ...(nums.length ? [`id_venta_ml.in.(${list})`, `id_interno.in.(${list})`, `tracking.in.(${list})`] : []),
      ...(alfa.length ? [`tracking.in.(${alfa.join(',')})`] : []),
    ];
    const rows = await sb(`envios_busqueda?or=(${conds.join(',')})&select=${COLS}&limit=20`);
    if (rows && rows.length) return res(rows, 'numero', true);
  }
  // Nombre de quien recibe (bloque de ML), con el CP si vino.
  if (recibe) {
    const pal = sinTildes(recibe).toLowerCase().split(/\s+/).filter((w) => w.length >= 3).slice(0, 3);
    if (pal.length) {
      const base = `envios_busqueda?and=(${pal.map((w) => `nombre.ilike.*${comodin(w)}*`).join(',')})&select=${COLS}&limit=20`;
      const rows = (d.cp && (await sb(`${base}&cp=eq.${encodeURIComponent(d.cp)}`))) || [];
      const todos = rows.length ? rows : (await sb(base)) || [];
      if (todos.length) return res(todos, 'nombre', !!d.cp && rows.length > 0);
    }
  }
  // Calle + altura ("San Martín 487"): primero con el CP si vino en el mensaje, después sin él.
  if (calles.length) {
    // Regex (imatch) y no ilike: la altura tiene que ser un número entero ("Catalina 5" no puede
    // traer "Catalina 1500"), y entre la calle y la altura no puede haber otros números.
    const or = calles.map(({ calle, altura }) => {
      const nombre = /^\d+$/.test(calle) ? `\\y${calle}` : sinTildes(calle).toLowerCase().replace(/[aeiou]/g, '.');
      return `direccion.imatch.${encodeURIComponent(`${nombre}[^0-9]*\\y${altura}\\y`)}`;
    }).join(',');
    const base = `envios_busqueda?or=(${or})&select=${COLS}&limit=20`;
    if (d.cp) {
      const conCp = await sb(`${base}&cp=eq.${encodeURIComponent(d.cp)}`);
      if (conCp && conCp.length) return res(conCp, 'direccion', true);
    }
    const rows = await sb(base);
    if (rows && rows.length) return res(rows, 'direccion', false);
  }
  // Números sueltos (posible pedido): nunca se abren solos.
  const sueltos = numerosSueltos(texto, { ...d, numeros: nums }, calles);
  if (sueltos.length) {
    const list = sueltos.join(',');
    const rows = await sb(`envios_busqueda?or=(id_venta_ml.in.(${list}),tracking.in.(${list}))&select=${COLS}&limit=20`);
    if (rows && rows.length) return { ...res(rows, 'suelto', false), abrir: false, sueltos };
  }
  // Por nombre / dirección, todas las palabras (sin las de relleno).
  const pal = sinTildes(texto).toLowerCase().replace(/[^a-zñ0-9 ]/gi, ' ').split(/\s+/).filter((p) => p.length >= 3 && !RELLENO.has(p) && p !== d.cp).slice(0, 4);
  if (!pal.length) return { rows: [], via: 'nada', abrir: false };
  const filtros = pal.map((p) => `or(nombre.ilike.*${comodin(p)}*,direccion.ilike.*${comodin(p)}*)`).join(',');
  const rows = (await sb(`envios_busqueda?and=(${filtros})&select=${COLS}&limit=20`)) || [];
  return res(rows, 'palabras', false);
}

export default function BuscarEnvio({ inicial = '' }) {
  const [sesion, setSesion] = useState(() => getSession());
  const [texto, setTexto] = useState(inicial);
  const [res, setRes] = useState(null);   // null = sin buscar; [] = sin resultados
  const [elegido, setElegido] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [via, setVia] = useState(null); // cómo se encontró: { via, abrir, sueltos }

  const correr = async (t) => {
    const q = String(t ?? texto).trim();
    if (!q) return;
    setBusy(true); setErr(''); setElegido(null);
    try {
      const r = await buscar(q);
      setRes(r.rows); setVia(r);
      if (r.rows.length && r.abrir) setElegido(r.rows[0].id_interno);
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

      {res && res.length > 0 && !elegido && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 8 }}>
            {via && via.via === 'suelto'
              ? <>No había número de envío. Busqué {via.sueltos.length === 1 ? 'el número suelto' : 'los números sueltos'} <b style={{ color: '#FFB020' }}>{via.sueltos.join(', ')}</b> como pedido: confirmá cuál es (los números de pedido se repiten entre clientes).</>
              : res.length === 1 ? 'Encontré 1, pero no estoy seguro. ¿Es este?' : `Encontré ${res.length}. ¿Cuál es?`}
          </div>
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
          {res && (res.length > 1 || (via && !via.abrir)) && (
            <button onClick={() => setElegido(null)} style={{ background: 'none', border: 'none', color: '#4A9EFF', cursor: 'pointer', fontSize: 13, padding: 0, marginBottom: 10 }}>{res.length === 1 ? '← Volver' : `← Ver los ${res.length} resultados`}</button>
          )}
          <PanelEnvio caso={{ envio_id: elegido, mensaje: texto }} />
        </div>
      )}
    </div>
  );
}
