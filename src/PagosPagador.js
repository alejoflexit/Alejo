// src/PagosPagador.js — Vista de pago semanal de cadetes (para quien ejecuta los pagos).
// Solo LEE pagos_cierres + cadetes_tarifas. No recalcula, no edita montos, sin export, sin Config.
// Ver wiki/analisis/spec-pagos-vista-pagador.md
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { authedFetch } from './auth';

// Medios de pago (para distinguir cómo se pagó cada cadete). Logos incrustados como data URL.
const LOGO_GALICIA = "data:image/png;base64,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";
const LOGO_MP = "data:image/png;base64,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";


const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";

const BRAND = {
  navyCard: "#162d42",
  teal:     "#2ECFAA",
  red:      "#E24B4A",
  amber:    "#FFB020",
  azul:     "#3A8FD4",
  blue:     "#4C8DFF",
  white:    "#FFFFFF",
  muted:    "rgba(255,255,255,0.58)",
  faint:    "rgba(255,255,255,0.06)",
  border:   "rgba(255,255,255,0.09)",
};

const MEDIOS = {
  galicia:     { nombre: 'Galicia',      logo: LOGO_GALICIA, color: '#FF6A13' },
  mercadopago: { nombre: 'Mercado Pago', logo: LOGO_MP,      color: '#009EE3' },
  // Efectivo solo aparece dentro del pago dividido: un cadete que factura pero cobra una parte
  // en mano. Para el pago simple los medios siguen siendo los dos bancarios.
  efectivo:    { nombre: 'Efectivo',     logo: null,         color: '#2ECFAA', soloDividido: true },
};
const MEDIOS_SIMPLES = Object.keys(MEDIOS).filter(k => !MEDIOS[k].soloDividido);

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function money(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return '$' + Math.round(n).toLocaleString('es-AR');
}

function maskCbu(cbu) {
  const s = String(cbu || '');
  return s.length > 8 ? '…' + s.slice(-6) : s;
}

function fmtSemanaLabel(lunes) {
  if (!lunes) return '';
  const d = new Date(lunes + 'T00:00:00');
  const sab = new Date(d); sab.setDate(d.getDate() + 5);
  const f = (x) => `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}`;
  return `${f(d)} al ${f(sab)}`;
}

// pdf.js se carga a demanda (recién al soltar el primer PDF): ~350KB que no tienen
// por qué frenar la pantalla. Mismo patrón que ExcelJS en Pagos.js.
let pdfJsPromise = null;
function cargarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      if (!window.pdfjsLib) return reject(new Error('pdf.js no cargó'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfJsPromise = null; reject(new Error('No se pudo descargar pdf.js (¿sin internet?)')); };
    document.head.appendChild(s);
  });
  return pdfJsPromise;
}

// Busca el número de comprobante en el texto de una factura AFIP y devuelve los
// últimos 4 dígitos. Prueba primero los rótulos típicos ("Comp. Nro", "Número")
// y después el formato punto de venta-comprobante (00003-00001234).
function nroDesdeTexto(texto) {
  const t = String(texto || '');
  const pats = [
    /Comp\.?\s*N[roº°.]*\s*[:.]?\s*(\d{4,13})/i,
    /N[uú]mero\s*[:.]?\s*(?:\d{1,5}\s*-\s*)?(\d{4,13})/i,
    /N[roº°]+\s*[:.]?\s*(?:\d{1,5}\s*-\s*)?(\d{4,13})/i,
    /\b\d{1,5}\s*-\s*(\d{8})\b(?!\s*-)/, // 00003-00001234; el (?!-) evita confundir un CUIT (30-71234567-8)
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m) {
      const dig = m[1].replace(/\D/g, '');
      if (dig.length >= 4) return dig.slice(-4);
    }
  }
  return null;
}

// Extrae los últimos 4 del número de factura de un PDF (primera página). Si el PDF
// es una foto escaneada sin texto, devuelve null y el número se carga a mano.
async function extraerNroFactura(file) {
  try {
    const pdfjs = await cargarPdfJs();
    const data = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data }).promise;
    const page = await doc.getPage(1);
    const tc = await page.getTextContent();
    const texto = tc.items.map(i => i.str).join(' ');
    return nroDesdeTexto(texto);
  } catch { return null; }
}

// "4/8 17:25" — fecha corta de cuándo se marcó pagado
function fmtCuando(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Quiénes suelen ejecutar los pagos. Cualquier otro nombre se escribe con "Otro…" y queda guardado.
const QUIENES_PAGAN = ['Adrián', 'Alejo'];

async function sb(path, options = {}) {
  const res = await authedFetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { 'Prefer': 'return=representation', ...(options.headers || {}) },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status}: ${t.slice(0, 300)}`);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

function copiar(valor, setCopiado, key) {
  if (!valor) return;
  navigator.clipboard.writeText(valor).then(() => {
    setCopiado(key);
    setTimeout(() => setCopiado(c => (c === key ? null : c)), 1200);
  }).catch(() => {});
}

// Chip copiable de un dato bancario. `display` opcional (ej. CBU enmascarado); copia el valor completo.
function CopyField({ label, valor, display, campoKey, copiado, setCopiado }) {
  if (!valor) return null;
  const isCopiado = copiado === campoKey;
  return (
    <span onClick={() => copiar(valor, setCopiado, campoKey)} title={`Tocar para copiar ${label}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5,
        padding: '5px 10px', borderRadius: 8, background: isCopiado ? 'rgba(46,207,170,0.15)' : BRAND.faint,
        border: `1px solid ${isCopiado ? 'rgba(46,207,170,0.4)' : BRAND.border}` }}>
      <span style={{ color: BRAND.muted }}>{label}</span>
      <span style={{ fontWeight: 600, color: BRAND.white, wordBreak: 'break-all' }}>{display || valor}</span>
      <span style={{ fontSize: 12, color: isCopiado ? BRAND.teal : BRAND.muted }}>{isCopiado ? '✓' : '📋'}</span>
    </span>
  );
}

// tarifas: array de cadetes_tarifas ya cargado por Pagos.js (evita refetch).
export default function PagosPagador({ tarifas }) {
  const [semanas, setSemanas] = useState([]);
  const [semanaSel, setSemanaSel] = useState(null);
  const [cierres, setCierres] = useState([]);
  const [loadingSemanas, setLoadingSemanas] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filtro, setFiltro] = useState('listos');          // listos | pendientes | pagados | falta_factura | todos
  const [armado, setArmado] = useState(null);
  const [filtroMetodo, setFiltroMetodo] = useState('todos'); // todos | factura | efectivo
  const [copiado, setCopiado] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [pickId, setPickId] = useState(null); // fila cuyo selector de medio (Galicia/MP) está abierto
  const [menuId, setMenuId] = useState(null); // fila con el menú "⋯" (acciones secundarias) abierto
  const [filtroMedio, setFiltroMedio] = useState('todos'); // en Pagados: todos | galicia | mercadopago
  // Quién está ejecutando los pagos AHORA. Se guarda con cada "Ya pagué" (pagado_por + pagado_at)
  // para que después se sepa quién marcó cada pago y cuándo — sin esto pasó que dos personas
  // transfirieron al mismo cadete la misma semana sin poder reconstruir quién fue.
  // Arranca en Adrián (siempre paga él, pedido de Alejo 05/08); se puede cambiar si un día paga otro.
  const [quienPaga, setQuienPaga] = useState(() => { try { return localStorage.getItem('fx_quien_paga') || 'Adrián'; } catch { return 'Adrián'; } });
  const [otroNombre, setOtroNombre] = useState(false); // el input de "Otro…" está abierto
  const [dragKey, setDragKey] = useState(null);   // fila resaltada porque hay una factura por soltar encima
  const [nroDraft, setNroDraft] = useState({});   // borrador del input "últimos 4" por fila (cuando el PDF no se pudo leer)

  function elegirQuienPaga(v) {
    const limpio = String(v || '').trim();
    setQuienPaga(limpio);
    try { localStorage.setItem('fx_quien_paga', limpio); } catch {}
  }

  useEffect(() => {
    sb('pagos_cierres?select=semana_label&estado=eq.confirmado')
      .then(rows => {
        const unicas = Array.from(new Set((rows || []).map(r => r.semana_label))).sort().reverse();
        setSemanas(unicas);
        setSemanaSel(unicas[0] || null);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingSemanas(false));
  }, []);

  const cargarCierres = useCallback((semana) => {
    if (!semana) { setCierres([]); setLoading(false); return; }
    setLoading(true); setError('');
    sb(`pagos_cierres?select=*&semana_label=eq.${semana}&estado=eq.confirmado`)
      .then(rows => setCierres(rows || []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { cargarCierres(semanaSel); }, [semanaSel, cargarCierres]);

  const tarifaByLD = useMemo(() => {
    const m = new Map();
    (tarifas || []).forEach(t => { if (t.nombre_lightdata) m.set(norm(t.nombre_lightdata), t); });
    return m;
  }, [tarifas]);

  // Una fila de esta pantalla = UNA plata que hay que mandar, no un cadete.
  // El cadete dividido (factura una parte y cobra el resto en mano) genera DOS filas
  // independientes: la de transferencia, que espera la factura, y la de efectivo, que se
  // paga sin esperar nada. Cada una se confirma por su cuenta y cae en el filtro que le
  // corresponde — que es justo lo que se hacía a mano antes de que existiera la división.
  const filas = useMemo(() => {
    const out = [];
    cierres.forEach(c => {
      const t = tarifaByLD.get(norm(c.cadete)) || {};
      const alias = t.alias || '', cbu = t.cbu || '';
      const base = {
        id: c.id,
        nombre: c.cadete || t.nombre || '', // Tarea 4: nombre completo de LightData (no el apodo)
        totalCierre: c.total,
        facturaOk: !!c.factura_ok, // Tarea 3: la transferencia se traba hasta que Alejo marque "mandó factura"
        facturaNro: c.factura_nro || null,   // últimos 4 del comprobante (referencia de Adrián)
        facturaFile: c.factura_file || null, // path del archivo en el bucket 'facturas'
        alias, cuil: t.cuil || '', cbu,
      };
      const partes = (Array.isArray(c.pagos) ? c.pagos : []).filter(p => (+p.monto || 0) > 0);
      if (partes.length > 1) {
        partes.forEach((p, i) => {
          const esEfectivo = p.via === 'efectivo';
          out.push({
            ...base,
            key: `${c.id}#${i}`,
            parte: i, partes: partes.length,
            // Banco fijo SOLO si la división vieja lo traía elegido (galicia/mercadopago).
            // Desde el 06/08 la división guarda via:'transferencia' → el banco lo elige
            // Adrián acá, al pagar la parte (mismo picker que una transferencia simple).
            viaFija: esEfectivo ? null : (p.via === 'galicia' || p.via === 'mercadopago' ? p.via : null),
            total: +p.monto,
            // Una división en dos facturas puede traer un alias distinto por importe.
            // Si no lo trae (divisiones viejas), conserva el alias fijo del cadete.
            alias: String(p.alias || alias || ''),
            // Un alias puntual puede ser de otro titular: no mostrar al lado el CUIL/CBU
            // fijo del cadete porque podría hacer validar la transferencia contra otra cuenta.
            cuil: p.alias ? '' : (t.cuil || ''),
            cbu: p.alias ? '' : cbu,
            metodo: esEfectivo ? 'efectivo' : 'transferencia',
            factura: !esEfectivo, // solo la parte que sale por transferencia depende de la factura
            pagado: !!p.pagado,
            pagadoVia: p.pagado ? p.via : null,
            pagadoPor: p.pagado_por || null,
            pagadoAt: p.pagado_at || null,
            sinDatos: !esEfectivo && !(p.alias || alias) && !cbu,
          });
        });
        return;
      }
      out.push({
        ...base,
        key: String(c.id),
        parte: null, partes: 0,
        viaFija: null,
        total: c.total,
        metodo: c.metodo,
        factura: c.metodo === 'transferencia',
        pagado: !!c.pagado,
        pagadoVia: c.pagado_via || null,
        pagadoPor: c.pagado_por || null,
        pagadoAt: c.pagado_at || null,
        sinDatos: c.metodo === 'transferencia' && !alias && !cbu, // no hay forma de transferir
      });
    });
    return out.sort((a, b) => {
      if (a.factura !== b.factura) return a.factura ? -1 : 1; // factura (cobran lunes) primero
      const n = a.nombre.localeCompare(b.nombre, 'es');
      return n !== 0 ? n : (a.parte || 0) - (b.parte || 0);
    });
  }, [cierres, tarifaByLD]);

  // "Falta factura" = transferencia que todavía no pasó factura y no está pagada. Se marca acá, en Pagar.
  const faltaFactura = f => f.factura && !f.facturaOk && !f.pagado;
  // "Listo para pagar" = no está pagado y no le falta nada: o es efectivo, o ya mandó la factura.
  // Es la cola de trabajo del que transfiere; por eso es el filtro por defecto de esta pantalla.
  const listoParaPagar = f => !f.pagado && (!f.factura || f.facturaOk);

  const filasFiltradas = useMemo(() => {
    let r = filas;
    if (filtro === 'listos') r = r.filter(listoParaPagar);
    else if (filtro === 'pagados') r = r.filter(f => f.pagado);
    else if (filtro === 'pendientes') r = r.filter(f => !f.pagado);
    else if (filtro === 'falta_factura') r = r.filter(faltaFactura);
    if (filtroMetodo === 'factura') r = r.filter(f => f.factura);
    else if (filtroMetodo === 'efectivo') r = r.filter(f => !f.factura);
    if (filtro === 'pagados' && filtroMedio !== 'todos') r = r.filter(f => f.pagadoVia === filtroMedio);
    return r;
  }, [filas, filtro, filtroMetodo, filtroMedio]);

  const counts = useMemo(() => ({
    listos: filas.filter(listoParaPagar).length,
    pendientes: filas.filter(f => !f.pagado).length,
    pagados: filas.filter(f => f.pagado).length,
    falta_factura: filas.filter(faltaFactura).length,
    todos: filas.length,
    factura: filas.filter(f => f.factura).length,
    efectivo: filas.filter(f => !f.factura).length,
  }), [filas]);

  // Cuántas filas se pagaron por cada medio. Va aparte de `counts` porque ahí 'efectivo' es el
  // MÉTODO (cómo se le paga a ese cadete) y acá es el MEDIO (por dónde salió la plata): mismo
  // nombre, dos preguntas distintas.
  const pagadasPorMedio = useMemo(() => {
    const m = {};
    Object.keys(MEDIOS).forEach(k => { m[k] = filas.filter(f => f.pagado && f.pagadoVia === k).length; });
    return m;
  }, [filas]);

  const resumen = useMemo(() => {
    const pagados = filas.filter(f => f.pagado).length;
    const faltan = filas.filter(f => !f.pagado).reduce((s, f) => s + (f.total || 0), 0);
    const sinFactura = filas.filter(faltaFactura);
    const pct = filas.length ? Math.round(pagados / filas.length * 100) : 0;
    // total pagado por cada medio. Como cada parte de un cadete dividido ya es su propia
    // fila, alcanza con sumar por `pagadoVia`: cada plata cae en el medio por el que salió.
    const porMedio = {};
    Object.keys(MEDIOS).forEach(k => {
      porMedio[k] = filas.reduce((s, f) => s + (f.pagado && f.pagadoVia === k ? (f.total || 0) : 0), 0);
    });
    return { pagados, total: filas.length, faltan, faltaFacturaN: sinFactura.length, faltaFacturaMonto: sinFactura.reduce((s, f) => s + (f.total || 0), 0), pct, porMedio };
  }, [filas]);

  // Soltar la factura (PDF o foto) sobre la fila del cadete: sube el archivo al bucket
  // privado 'facturas', marca "Mandó factura" solo, y si es un PDF con texto le lee el
  // número de comprobante y guarda los últimos 4 (la referencia que usa Adrián).
  // Foto o PDF escaneado → el archivo queda igual y los 4 números se cargan a mano.
  async function subirFactura(f, file) {
    if (!file) return;
    const tiposOk = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!tiposOk.includes(file.type)) { setError('Ese archivo no parece una factura: tiene que ser PDF o imagen (JPG/PNG).'); return; }
    if (file.size > 15 * 1024 * 1024) { setError('El archivo es muy pesado (máx. 15 MB).'); return; }
    setBusyId(f.key); setError('');
    try {
      const ext = file.type === 'application/pdf' ? 'pdf' : (file.type.split('/')[1] || 'bin');
      const path = `${semanaSel}/${f.id}.${ext}`;
      const up = await authedFetch(`${SUPABASE_URL}/storage/v1/object/facturas/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': file.type, 'x-upsert': 'true' },
        body: file,
      });
      if (!up.ok) throw new Error(`No se pudo guardar el archivo (${up.status}). ¿Estás logueado como admin?`);
      const nro = file.type === 'application/pdf' ? await extraerNroFactura(file) : null;
      const cambio = { factura_ok: true, factura_ok_at: new Date().toISOString(), factura_file: path, factura_nro: nro };
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify(cambio) });
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, ...cambio } : c));
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  // Guardar a mano los últimos 4 de la factura (cuando el archivo era foto o PDF sin texto)
  async function guardarNroFactura(f, valor) {
    const nro = String(valor || '').replace(/\D/g, '').slice(-4);
    if (nro.length !== 4) { setError('Cargá los 4 últimos números de la factura.'); return; }
    setBusyId(f.key);
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ factura_nro: nro }) });
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, factura_nro: nro } : c));
      setNroDraft(d => { const n = { ...d }; delete n[f.key]; return n; });
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  // Abrir la factura guardada (link firmado de 1 hora — el bucket es privado)
  async function verFactura(f) {
    try {
      const res = await authedFetch(`${SUPABASE_URL}/storage/v1/object/sign/facturas/${f.facturaFile}`, {
        method: 'POST', body: JSON.stringify({ expiresIn: 3600 }),
      });
      if (!res.ok) throw new Error('No se pudo abrir la factura.');
      const d = await res.json();
      if (d && d.signedURL) window.open(`${SUPABASE_URL}/storage/v1${d.signedURL}`, '_blank');
    } catch (e) { setError(e.message); }
  }

  // "Volver a Semana": revierte la confirmación (estado → borrador). La fila sale de Pagar
  // (que solo muestra confirmados) y en Semana vuelve a "Falta confirmar", donde Alejo puede
  // editarla o dividirla y confirmarla de nuevo. Conserva factura/archivo. Bloqueado si hay
  // plata ya marcada como pagada.
  async function volverASemana(f) {
    const c = cierres.find(x => x.id === f.id);
    if (!c || c.pagado) return;
    if ((Array.isArray(c.pagos) ? c.pagos : []).some(p => p.pagado)) {
      setError('Este cadete tiene una parte ya pagada: deshacé ese pago antes de mandarlo de vuelta a Semana.');
      setMenuId(null);
      return;
    }
    setBusyId(f.key); setMenuId(null);
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ estado: 'borrador' }) });
      setCierres(prev => prev.filter(x => x.id !== f.id));
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  // marcar / desmarcar "mandó factura" acá en Pagar: habilita el pago de esa transferencia
  async function marcarFactura(f, valor) {
    setBusyId(f.key);
    setCierres(prev => prev.map(c => c.id === f.id ? { ...c, factura_ok: valor, factura_ok_at: valor ? new Date().toISOString() : null } : c));
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ factura_ok: valor, factura_ok_at: valor ? new Date().toISOString() : null }) });
    } catch (e) {
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, factura_ok: !valor } : c));
      setError(e.message);
    } finally { setBusyId(null); }
  }

  // Aplicar un cambio a UNA parte de un cadete dividido. Cada parte se paga sola, y el
  // cierre entero recién queda pagado cuando salieron todas (ahí el medio pasa a 'mixto',
  // porque la plata salió por dos vías distintas). Sin esto, confirmar el efectivo daba
  // por saldada también la transferencia, que es lo que pasaba antes.
  async function guardarParte(f, valor, via) {
    if (valor && !quienPaga) { setError('Antes de marcar un pago, elegí quién está pagando (arriba a la derecha).'); return; }
    const c = cierres.find(x => x.id === f.id);
    const partes = (Array.isArray(c && c.pagos) ? c.pagos : []).filter(p => (+p.monto || 0) > 0);
    if (!partes[f.parte]) return;
    const ahora = new Date().toISOString();
    const nuevas = partes.map((p, i) => i === f.parte
      ? { ...p, via: via || p.via, pagado: valor, pagado_at: valor ? ahora : null, pagado_por: valor ? quienPaga : null }
      : p);
    const todas = nuevas.every(p => p.pagado);
    const body = {
      pagos: nuevas, pagado: todas,
      pagado_via: todas ? (nuevas.length === 1 ? nuevas[0].via : 'mixto') : null,
      pagado_por: todas ? quienPaga : null,
      pagado_at: todas ? ahora : null,
    };
    const antes = { pagos: c.pagos, pagado: !!c.pagado, pagado_via: c.pagado_via || null, pagado_por: c.pagado_por || null, pagado_at: c.pagado_at || null };
    setBusyId(f.key); setPickId(null);
    setCierres(prev => prev.map(x => x.id === f.id ? { ...x, ...body } : x));
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify(body) });
    } catch (e) {
      setCierres(prev => prev.map(x => x.id === f.id ? { ...x, ...antes } : x));
      setError(e.message);
    } finally { setBusyId(null); }
  }

  // marcar pagado eligiendo el medio (galicia | mercadopago); queda guardado en pagos_cierres.pagado_via
  async function marcarPagado(f, via) {
    if (!quienPaga) { setError('Antes de marcar un pago, elegí quién está pagando (arriba a la derecha).'); return; }
    if (f.parte != null) return guardarParte(f, true, via);
    const cambio = { pagado: true, pagado_via: via, pagado_por: quienPaga, pagado_at: new Date().toISOString() };
    setBusyId(f.key); setPickId(null);
    setCierres(prev => prev.map(c => c.id === f.id ? { ...c, ...cambio } : c));
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify(cambio) });
    } catch (e) {
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: false, pagado_via: null, pagado_por: null, pagado_at: null } : c));
      setError(e.message);
    } finally { setBusyId(null); }
  }

  // deshacer el pago (vuelve a pendiente y borra el medio). En un cadete dividido deshace
  // solo ESA parte: la otra queda como estaba.
  async function desmarcar(f) {
    if (f.parte != null) return guardarParte(f, false);
    setBusyId(f.key); setPickId(null);
    // pagado_por/pagado_at se limpian acá, pero el historial de la base guarda quién había
    // marcado y quién desmarcó — deshacer no borra el rastro.
    setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: false, pagado_via: null, pagado_por: null, pagado_at: null } : c));
    try {
      await sb(`pagos_cierres?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ pagado: false, pagado_via: null, pagado_por: null, pagado_at: null }) });
    } catch (e) {
      setCierres(prev => prev.map(c => c.id === f.id ? { ...c, pagado: true, pagado_via: f.pagadoVia, pagado_por: f.pagadoPor, pagado_at: f.pagadoAt } : c));
      setError(e.message);
    } finally { setBusyId(null); }
  }

  const cardSt = { background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: '12px 14px' };
  const pill = (active, color = BRAND.teal) => ({ padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 20, cursor: 'pointer', border: `1px solid ${active ? color : BRAND.border}`, background: active ? `${color}26` : BRAND.faint, color: active ? color : BRAND.muted });

  return (
    <div style={{ maxWidth: 940 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: BRAND.muted }}>Semana:</span>
        {semanas.length > 0 && (
          <select value={semanaSel || ''} onChange={e => setSemanaSel(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: BRAND.white }}>
            {semanas.map(s => <option key={s} value={s}>{fmtSemanaLabel(s)}</option>)}
          </select>
        )}
        {/* Quién está pagando: obligatorio antes de poder marcar "Ya pagué". Cada marca queda
            guardada con este nombre y la hora, para poder auditar después quién pagó qué. */}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: quienPaga ? 400 : 700, color: quienPaga ? BRAND.muted : BRAND.amber }}>
            {quienPaga ? 'Paga:' : '⚠ ¿Quién paga?'}
          </span>
          {otroNombre ? (
            <input autoFocus placeholder="tu nombre" defaultValue={QUIENES_PAGAN.includes(quienPaga) ? '' : quienPaga}
              onKeyDown={e => { if (e.key === 'Enter') { elegirQuienPaga(e.target.value); setOtroNombre(false); } if (e.key === 'Escape') setOtroNombre(false); }}
              onBlur={e => { if (e.target.value.trim()) elegirQuienPaga(e.target.value); setOtroNombre(false); }}
              style={{ padding: '6px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: BRAND.white, width: 120 }} />
          ) : (
            <select value={QUIENES_PAGAN.includes(quienPaga) || !quienPaga ? quienPaga : '__actual'}
              onChange={e => { if (e.target.value === '__otro') setOtroNombre(true); else elegirQuienPaga(e.target.value); }}
              style={{ padding: '6px 10px', fontSize: 13, fontWeight: 700, borderRadius: 8,
                border: `1px solid ${quienPaga ? BRAND.border : BRAND.amber}`,
                background: quienPaga ? BRAND.faint : 'rgba(255,176,32,0.14)', color: quienPaga ? BRAND.white : BRAND.amber }}>
              <option value="" disabled>elegí tu nombre</option>
              {QUIENES_PAGAN.map(n => <option key={n} value={n}>{n}</option>)}
              {quienPaga && !QUIENES_PAGAN.includes(quienPaga) && <option value="__actual">{quienPaga}</option>}
              <option value="__otro">Otro…</option>
            </select>
          )}
        </span>
      </div>

      {error && <div style={{ background: 'rgba(226,75,74,0.15)', color: BRAND.red, border: `1px solid ${BRAND.red}`, padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}

      {!loadingSemanas && semanas.length === 0 && (
        <div style={{ color: BRAND.muted, fontSize: 13 }}>Alejo todavía no cerró ninguna semana.</div>
      )}

      {semanaSel && (
        <>
          <div style={{ ...cardSt, marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Pagados {resumen.pagados} de {resumen.total} <span style={{ color: BRAND.muted, fontWeight: 600 }}>· {resumen.pct}%</span></span>
              <span style={{ fontSize: 13, color: BRAND.muted }}>Faltan <b style={{ color: BRAND.white }}>{money(resumen.faltan)}</b>{resumen.faltaFacturaN > 0 && <> · <span style={{ color: BRAND.amber }}>⚠</span> Falta factura {resumen.faltaFacturaN} · <b style={{ color: BRAND.white }}>{money(resumen.faltaFacturaMonto)}</b></>}</span>
            </div>
            <div style={{ height: 10, borderRadius: 20, background: 'rgba(255,255,255,0.10)', overflow: 'hidden' }}>
              <div style={{ width: `${resumen.pct}%`, height: '100%', borderRadius: 20, background: BRAND.teal, transition: 'width 0.3s' }} />
            </div>
            {Object.keys(MEDIOS).some(k => resumen.porMedio[k] > 0) && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
                <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', alignSelf: 'center' }}>Pagado por</span>
                {Object.entries(MEDIOS).filter(([k]) => resumen.porMedio[k] > 0).map(([k, m]) => (
                  <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, padding: '5px 11px', borderRadius: 10, background: BRAND.faint, border: `1px solid ${BRAND.border}` }}>
                    {m.logo ? <img src={m.logo} alt="" width="18" height="18" style={{ display: 'block' }} /> : <span style={{ fontSize: 15 }}>💵</span>}
                    <span style={{ color: BRAND.muted }}>{m.nombre}</span>
                    <b style={{ color: m.color }}>{money(resumen.porMedio[k] || 0)}</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 56 }}>Estado</span>
              {/* "Listos para pagar" primero y en verde: es la cola del que transfiere y la única
                  que lleva a la acción de plata. El resto (revisar pendientes, marcar facturas,
                  auditar pagados) son tareas de Alejo y quedan en azul, detrás. */}
              <button onClick={() => setFiltro(filtro === 'listos' ? 'todos' : 'listos')} style={{ ...pill(filtro === 'listos', BRAND.teal), fontWeight: 700 }}>
                💸 Listos para pagar {counts.listos > 0 && <span style={{ opacity: 0.7 }}>({counts.listos})</span>}
              </button>
              {[['pendientes', 'Pendientes'], ['pagados', 'Pagados'], ['falta_factura', 'Falta factura']].map(([k, l]) => (
                <button key={k} onClick={() => setFiltro(filtro === k ? 'todos' : k)} style={pill(filtro === k, BRAND.blue)}>{l} {counts[k] > 0 && <span style={{ opacity: 0.7 }}>({counts[k]})</span>}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 56 }}>Método</span>
              {[['factura', 'Factura'], ['efectivo', 'Efectivo']].map(([k, l]) => (
                <button key={k} onClick={() => setFiltroMetodo(filtroMetodo === k ? 'todos' : k)} style={pill(filtroMetodo === k, BRAND.blue)}>{l} <span style={{ opacity: 0.7 }}>({counts[k]})</span></button>
              ))}
            </div>
            {filtro === 'pagados' && Object.keys(MEDIOS).some(k => pagadasPorMedio[k] > 0) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.05em', minWidth: 56 }}>Medio</span>
                {Object.entries(MEDIOS).filter(([k]) => pagadasPorMedio[k] > 0).map(([k, m]) => (
                  <button key={k} onClick={() => setFiltroMedio(filtroMedio === k ? 'todos' : k)} style={{ ...pill(filtroMedio === k, m.color), display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    {m.logo ? <img src={m.logo} alt="" width="18" height="18" style={{ display: 'block' }} /> : <span style={{ fontSize: 15 }}>💵</span>} {m.nombre} <span style={{ opacity: 0.7 }}>({pagadasPorMedio[k]})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {loading && <div style={{ color: BRAND.muted, fontSize: 13, padding: 20, textAlign: 'center' }}>Cargando…</div>}

          {!loading && filasFiltradas.length === 0 && (
            <div style={{ color: BRAND.muted, fontSize: 13, padding: '2rem', textAlign: 'center' }}>
              {filtro === 'listos'
                // Vacío acá NO es "no hay nada": puede que falten facturas. Decirlo, si no el que
                // paga cierra la pantalla creyendo que terminó.
                ? (counts.falta_factura > 0
                  ? <>No queda nada para transferir. Hay <b style={{ color: BRAND.amber }}>{counts.falta_factura}</b> esperando factura.</>
                  : counts.pendientes === 0 ? '✓ Semana pagada por completo.' : 'Nada listo para pagar por ahora.')
                : 'Nada para mostrar con este filtro.'}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filasFiltradas.map(f => {
              const sinFactura = faltaFactura(f); // transferencia confirmada que todavía no mandó factura
              const busy = busyId === f.key;
              // Medio ya determinado: efectivo (no sale de ninguna cuenta) o parte vieja con
              // banco fijado. Una transferencia simple o una parte facturada nueva preguntan
              // Galicia/MP acá — el banco es decisión de Adrián al pagar.
              const viaUnica = !f.factura ? 'efectivo' : (f.parte != null ? f.viaFija : null);
              // La fila entera recibe el archivo de la factura por drag & drop (solo
              // transferencias sin pagar). El resaltado es solo borde+fondo: nada cambia
              // de alto, así no tiembla la lista.
              const aceptaDrop = f.factura && !f.pagado;
              const enDrag = dragKey === f.key;
              // Menú "⋯" de acciones secundarias — disponible en toda fila sin pagar:
              // quitar la factura (si la tiene) y volver el cadete a Semana (des-confirmar).
              const menuFila = (
                <span style={{ position: 'relative' }}>
                  <button onClick={() => setMenuId(menuId === f.key ? null : f.key)} title="más acciones"
                    style={{ height: 36, width: 34, borderRadius: 10, border: `1px solid ${BRAND.border}`, background: 'transparent', color: BRAND.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>⋯</button>
                  {menuId === f.key && (
                    <>
                      <div onClick={() => setMenuId(null)} style={{ position: 'fixed', inset: 0, zIndex: 20 }} />
                      <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 10, padding: 4, minWidth: 210, boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }}>
                        {f.factura && f.facturaOk && (
                          <button onClick={() => { marcarFactura(f, false); setMenuId(null); }} disabled={busy}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', color: BRAND.amber, cursor: 'pointer', fontSize: 13, padding: '8px 10px', borderRadius: 8 }}>🗑 Quitar factura</button>
                        )}
                        {/* Vuelve a "Falta confirmar" en Semana para editar o dividir; sale de esta pantalla */}
                        <button onClick={() => volverASemana(f)} disabled={busy}
                          title="revierte la confirmación: sale de Pagar y en Semana vuelve a 'Falta confirmar' para editarlo o dividirlo"
                          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', color: BRAND.azul, cursor: 'pointer', fontSize: 13, padding: '8px 10px', borderRadius: 8 }}>↩ Volver a Semana</button>
                      </div>
                    </>
                  )}
                </span>
              );
              return (
                <div key={f.key}
                  onDragOver={aceptaDrop ? (e => { e.preventDefault(); if (!enDrag) setDragKey(f.key); }) : undefined}
                  onDragLeave={aceptaDrop ? (() => setDragKey(k => (k === f.key ? null : k))) : undefined}
                  onDrop={aceptaDrop ? (e => { e.preventDefault(); setDragKey(null); subirFactura(f, e.dataTransfer.files && e.dataTransfer.files[0]); }) : undefined}
                  title={aceptaDrop && !f.facturaOk ? 'arrastrá acá el PDF o la foto de la factura: se guarda y se marca sola' : undefined}
                  style={{ ...cardSt, padding: '15px 16px', opacity: f.pagado ? 0.5 : 1, display: 'flex', flexDirection: 'column', gap: 11,
                    background: enDrag ? 'rgba(46,207,170,0.10)' : BRAND.navyCard,
                    borderColor: enDrag ? BRAND.teal : f.pagado ? 'rgba(46,207,170,0.3)' : sinFactura ? 'rgba(255,176,32,0.4)' : BRAND.border }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    {/* Método de pago (cómo se le paga) — badge neutro */}
                    <span title={f.factura ? 'Transferencia' : 'Efectivo'} style={{ fontSize: 10.5, fontWeight: 600, padding: '3px 9px', borderRadius: 20, color: BRAND.muted, background: 'rgba(255,255,255,0.06)', border: `1px solid ${BRAND.border}`, whiteSpace: 'nowrap' }}>
                      {f.factura ? '🏦 Transferencia' : '💵 Efectivo'}
                    </span>
                    {/* Estado de la factura (requisito, separado del método) — solo transferencia */}
                    {/* Cuando la factura ya está, el chip baja de tono: es info resuelta, no compite
                        con el verde del botón de pagar. Pendiente sigue en ámbar, que es lo que frena. */}
                    {f.factura && (f.facturaOk
                      ? (f.facturaFile
                        // Con archivo adjunto el chip es un botón: abre la factura guardada.
                        // Los últimos 4 del comprobante van a la vista — es la referencia de Adrián.
                        ? <button onClick={() => verFactura(f)} title="ver la factura guardada"
                            style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, cursor: 'pointer', color: BRAND.muted, background: 'transparent', border: `1px solid ${BRAND.border}`, whiteSpace: 'nowrap' }}>
                            <span style={{ color: BRAND.teal }}>✓</span> 📄 Factura{f.facturaNro ? <b style={{ color: BRAND.white }}> …{f.facturaNro}</b> : ''}
                          </button>
                        : <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, color: BRAND.muted, background: 'transparent', border: `1px solid ${BRAND.border}`, whiteSpace: 'nowrap' }}><span style={{ color: BRAND.teal }}>✓</span> Factura recibida</span>)
                      : <span title="arrastrá el PDF o la foto de la factura sobre esta fila" style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 20, color: BRAND.amber, background: 'rgba(255,176,32,0.14)', border: '1px solid rgba(255,176,32,0.4)', whiteSpace: 'nowrap' }}>🟡 Factura pendiente</span>
                    )}
                    {/* Archivo adjunto pero sin número (foto o PDF escaneado): los 4 últimos se cargan a mano */}
                    {f.factura && f.facturaFile && !f.facturaNro && !f.pagado && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <input value={nroDraft[f.key] || ''} onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 4); setNroDraft(d => ({ ...d, [f.key]: v })); }}
                          onKeyDown={e => { if (e.key === 'Enter') guardarNroFactura(f, nroDraft[f.key]); }}
                          placeholder="últimos 4" inputMode="numeric"
                          style={{ width: 74, padding: '3px 8px', fontSize: 11.5, borderRadius: 8, border: `1px solid ${BRAND.amber}`, background: 'rgba(255,176,32,0.10)', color: BRAND.white }} />
                        <button onClick={() => guardarNroFactura(f, nroDraft[f.key])} disabled={busy}
                          style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: BRAND.white }}>OK</button>
                      </span>
                    )}
                    <span style={{ fontWeight: 700, fontSize: 15, minWidth: 130, textDecoration: f.pagado ? 'line-through' : 'none' }}>
                      {f.nombre}
                      {/* El cadete dividido aparece dos veces: hay que poder distinguir de un
                          vistazo cuál de las dos partes es cada fila y sobre cuánto es. */}
                      {f.parte != null && (
                        <span style={{ marginLeft: 7, fontSize: 10.5, fontWeight: 700, color: BRAND.azul, background: 'rgba(58,143,212,0.14)', border: '1px solid rgba(58,143,212,0.4)', borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap' }}>
                          parte {f.parte + 1} de {f.partes} · total {money(f.totalCierre)}
                        </span>
                      )}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 17, fontWeight: 800, color: f.pagado ? BRAND.muted : BRAND.white }}>{money(f.total)}</span>
                    {f.pagado ? (() => {
                      const m = MEDIOS[f.pagadoVia];
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 36, padding: '0 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, whiteSpace: 'nowrap',
                          color: m ? m.color : BRAND.teal, background: m ? `${m.color}1f` : 'rgba(46,207,170,0.12)', border: `1px solid ${m ? m.color : BRAND.teal}66` }}>
                          {m && m.logo ? <img src={m.logo} alt="" width="20" height="20" style={{ display: 'block', borderRadius: 4 }} /> : m ? '💵' : '✓'}
                          {m ? m.nombre : 'Pagado'}
                          {/* Quién marcó el pago y cuándo — el rastro que faltaba cuando hubo un doble pago */}
                          {(f.pagadoPor || f.pagadoAt) && (
                            <span style={{ fontSize: 11, fontWeight: 600, color: BRAND.muted, whiteSpace: 'nowrap' }}>
                              {f.pagadoPor}{f.pagadoPor && f.pagadoAt ? ' · ' : ''}{fmtCuando(f.pagadoAt)}
                            </span>
                          )}
                          <button onClick={() => desmarcar(f)} disabled={busy} title="deshacer pago"
                            style={{ background: 'none', border: 'none', color: BRAND.muted, cursor: busy ? 'wait' : 'pointer', fontSize: 14, marginLeft: 2, lineHeight: 1 }}>✕</button>
                        </span>
                      );
                    })() : sinFactura ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {/* Ámbar, no verde: esta acción RESUELVE el chip ámbar "Factura pendiente".
                            El verde queda reservado para la única acción de plata ("Ya pagué"),
                            que antes se confundía con esta por estar en el mismo lugar y del mismo color.
                            Doble clic: el primero arma, el segundo aplica (se tocaba sin querer). */}
                        <button
                          onClick={() => {
                            if (armado !== f.key) {
                              setArmado(f.key);
                              setTimeout(() => setArmado(a => (a === f.key ? null : a)), 3000);
                            } else { setArmado(null); marcarFactura(f, true); }
                          }}
                          disabled={busy}
                          title={armado === f.key ? 'tocá de nuevo para confirmar' : 'cuando mandó la factura: se habilita el pago'}
                          style={{ height: 36, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
                            border: `1px solid ${BRAND.amber}`,
                            background: armado === f.key ? BRAND.amber : 'rgba(255,176,32,0.12)',
                            color: armado === f.key ? '#2b1a00' : BRAND.amber }}>
                          {armado === f.key ? '¿Seguro? tocá otra vez' : 'Mandó factura'}
                        </button>
                        {menuFila}
                      </span>
                    ) : pickId === f.key && viaUnica ? (() => {
                      /* Cuando el medio ya está determinado no hay banco que elegir: en efectivo
                         porque no sale de ninguna cuenta, y en una parte dividida porque la
                         división ya dijo por dónde sale. Queda un solo botón, que igual pide el
                         segundo clic: "Ya pagué" arma, este confirma. */
                      const via = viaUnica;
                      const m = MEDIOS[via];
                      return (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <button onClick={() => marcarPagado(f, via)} disabled={busy}
                            style={{ height: 36, padding: '0 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', color: m.color, background: `${m.color}1f`, border: `1px solid ${m.color}`, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                            {m.logo ? <img src={m.logo} alt="" width="22" height="22" style={{ display: 'block' }} /> : '💵'} Sí, {via === 'efectivo' ? 'pagué en efectivo' : m.nombre} {money(f.total)}
                          </button>
                          <button onClick={() => setPickId(null)} style={{ background: 'none', border: 'none', color: BRAND.muted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>cancelar</button>
                        </span>
                      );
                    })() : pickId === f.key ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {MEDIOS_SIMPLES.map(k => MEDIOS[k]).map((m, i) => { const k = MEDIOS_SIMPLES[i]; return (
                          <button key={k} onClick={() => marcarPagado(f, k)} disabled={busy} title={`Marcar pagado por ${m.nombre}`}
                            style={{ height: 36, padding: '0 13px', borderRadius: 10, fontSize: 12.5, fontWeight: 800, cursor: busy ? 'wait' : 'pointer', color: m.color, background: `${m.color}1f`, border: `1px solid ${m.color}`, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                            <img src={m.logo} alt="" width="22" height="22" style={{ display: 'block' }} /> {m.nombre}
                          </button>
                        ); })}
                        <button onClick={() => setPickId(null)} style={{ background: 'none', border: 'none', color: BRAND.muted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}>cancelar</button>
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {menuFila}
                      {/* "Ya pagué" y no "Pagar": la app NO transfiere — la transferencia la hace
                          Alejo en el banco y acá solo queda registrada. Mismo criterio que
                          "Mandó factura": el rótulo nombra un hecho que ya pasó afuera, no una
                          acción que el sistema pueda ejecutar. */}
                      <button onClick={() => { if (!quienPaga) { setError('Antes de marcar un pago, elegí quién está pagando (arriba a la derecha).'); window.scrollTo({ top: 0, behavior: 'smooth' }); return; } setPickId(f.key); }} title={viaUnica === 'efectivo' ? 'registrar que ya le diste la plata en mano' : 'registrar que ya le pagaste'}
                        style={{ height: 36, padding: '0 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none', background: BRAND.teal, color: '#06231b', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                        ✓ Ya pagué
                      </button>
                      </span>
                    )}
                  </div>

                  {f.factura && (f.alias || f.cuil || f.cbu || f.sinDatos) && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                      <CopyField label="Alias" valor={f.alias} campoKey={`alias-${f.key}`} copiado={copiado} setCopiado={setCopiado} />
                      <CopyField label="CUIL" valor={f.cuil} campoKey={`cuil-${f.id}`} copiado={copiado} setCopiado={setCopiado} />
                      <CopyField label="CBU" valor={f.cbu} display={maskCbu(f.cbu)} campoKey={`cbu-${f.id}`} copiado={copiado} setCopiado={setCopiado} />
                      {f.sinDatos && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: BRAND.amber }}>⚠ falta alias o CBU para transferir</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
