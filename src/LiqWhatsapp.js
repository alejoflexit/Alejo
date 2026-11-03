// src/LiqWhatsapp.js — Liquidaciones › "Enviar por WhatsApp" (2026-11-02)
// Manda el mensaje de liquidación ("Buen día X, tengo N envíos entregados…") desde el WhatsApp
// PERSONAL de Alejo. La app NO manda nada sola: Alejo revisa la tanda, toca "Mandar" y confirma.
// La base (liq_wa_encolar) los escalona 25–35 s y el worker del VPS (vps/flexit-liq-wa.py) los
// manda por OpenWA. Al salir bien, la fila queda "✓ Avisado" (pagos_avisos) como con el 💬.
// Todo lo de acá es solo admin (RLS por email): el QR da acceso completo a tu WhatsApp.
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

// "011 15-2233-4455", "+54 9 11 2233 4455", "1122334455"… → "5491122334455@c.us" (o null)
export function normalizarWhatsapp(entrada) {
  if (!entrada) return null;
  let d = String(entrada).replace(/@c\.us$/, '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('549') && d.length === 13) return d + '@c.us';
  if (d.startsWith('54') && d.length === 12) return '549' + d.slice(2) + '@c.us';
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 12) { // número local con el "15" adentro: 11 15 2233 4455 / 351 15 223 3445
    for (const p of [2, 3, 4]) {
      if (d.slice(p, p + 2) === '15') { const r = d.slice(0, p) + d.slice(p + 2); if (r.length === 10) return '549' + r + '@c.us'; }
    }
    return null;
  }
  if (d.length === 10) return '549' + d + '@c.us';
  return null;
}

export function mostrarWhatsapp(chatId) {
  const d = String(chatId || '').replace(/@c\.us$/, '');
  if (!/^549\d{10}$/.test(d)) return chatId || '';
  const r = d.slice(3);
  const area = r.startsWith('11') ? 2 : (r.startsWith('2') || r.startsWith('3')) ? 3 : 2;
  const loc = r.slice(area);
  return `+54 9 ${r.slice(0, area)} ${loc.slice(0, loc.length - 4)}-${loc.slice(-4)}`;
}

const sinAcentos = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = s => sinAcentos(s).split(/[^a-z0-9ñ]+/).filter(t => t.length >= 3);

// Contacto de tu WhatsApp que más se parece al nombre del cadete (o null si es ambiguo / no hay)
function sugerirContacto(nombre, contactos) {
  const tk = tokens(nombre);
  if (!tk.length) return null;
  const necesita = Math.min(2, tk.length);
  const cands = [];
  for (const c of contactos) {
    const ct = tokens(c.nombre);
    // "Caro" en tus contactos cuenta como "Carolina": vale el prefijo (mín. 3 letras)
    const n = tk.filter(t => ct.some(x => x === t || x.startsWith(t) || t.startsWith(x))).length;
    if (n >= necesita) cands.push({ ...c, n });
  }
  if (!cands.length) return null;
  cands.sort((a, b) => b.n - a.n);
  if (cands.length > 1 && cands[1].n === cands[0].n && cands[1].chat_id !== cands[0].chat_id) return { ambiguo: true, opciones: cands.slice(0, 3) };
  return cands[0];
}

function hora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hour12: false });
}

function QrImagen({ valor }) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!valor) { setImg(null); return; }
    if (valor.startsWith('data:image')) { setImg(valor); return; }
    import('qrcode').then(m => m.toDataURL(valor, { width: 260, margin: 2 })).then(setImg).catch(() => setImg(''));
  }, [valor]);
  if (!img) return <div style={{ width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 12 }}>Cargando QR…</div>;
  return <img src={img} alt="QR para vincular tu WhatsApp" width={260} height={260} style={{ background: '#fff', borderRadius: 8, padding: 6 }} />;
}

export default function LiqWhatsapp({ semanaLunes, semanaTxt, filas, tarifas, avisados, armarMensaje, sb, norm, BRAND, alcanceLbl, onCerrar, onAvisadosCambio, onTarifasCambio }) {
  const [salud, setSalud] = useState(null);
  const [envios, setEnvios] = useState([]);
  const [contactos, setContactos] = useState([]);
  const [numeros, setNumeros] = useState({});     // key → texto que está escribiendo
  const [elegidos, setElegidos] = useState(null); // Set de keys (null = todavía sin default)
  const [confirmar, setConfirmar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const avisadosAntes = useRef(null);

  const tarifaById = useMemo(() => new Map((tarifas || []).map(t => [t.id, t])), [tarifas]);

  const cargar = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([
        sb('liq_wa_salud?select=estado,estado_at,qr,qr_at,encender_hasta,contactos_at,ultimo_error&id=eq.1'),
        sb(`liq_envios?select=id,cadete,estado,error,enviar_desde,enviado_at&semana_label=eq.${semanaLunes}&order=id.asc`),
      ]);
      setSalud((s && s[0]) || {});
      setEnvios(e || []);
      setErr('');
    } catch (ex) {
      setErr(/liq_wa_salud|liq_envios|42P01|PGRST2/.test(ex.message)
        ? 'Falta correr la migración de WhatsApp en Supabase (20261102230000_liquidaciones_whatsapp.sql).'
        : ex.message);
    }
  }, [sb, semanaLunes]);

  const cargarContactos = useCallback(() => {
    sb('liq_wa_contactos?select=chat_id,nombre').then(c => setContactos(c || [])).catch(() => {});
  }, [sb]);

  useEffect(() => { cargar(); cargarContactos(); }, [cargar, cargarContactos]);

  // último envío por cadete de esta semana
  const envioPorCadete = useMemo(() => {
    const m = new Map();
    for (const e of envios) m.set(norm(e.cadete), e);
    return m;
  }, [envios, norm]);

  const activos = envios.filter(e => e.estado === 'en_cola' || e.estado === 'enviando');
  const qrFresco = salud && salud.qr && salud.qr_at && (Date.now() - new Date(salud.qr_at).getTime()) < 2 * 60 * 1000;
  const conectado = salud && ['ready', 'connected', 'authenticated'].includes(salud.estado);
  const pidioEncender = salud && salud.encender_hasta && new Date(salud.encender_hasta) > new Date();

  // refresco: rápido mientras manda o mientras espera el QR; lento si no
  useEffect(() => {
    const ms = (activos.length || pidioEncender) ? 4000 : 15000;
    const id = setInterval(cargar, ms);
    return () => clearInterval(id);
  }, [cargar, activos.length, pidioEncender]);

  // cuando sale un mensaje, la base ya marcó "Avisado": avisarle a la tabla para que lo muestre
  useEffect(() => {
    const enviados = envios.filter(e => e.estado === 'enviado').length;
    if (avisadosAntes.current !== null && enviados !== avisadosAntes.current) onAvisadosCambio && onAvisadosCambio();
    avisadosAntes.current = enviados;
  }, [envios, onAvisadosCambio]);

  // contactos recién subidos por el VPS
  useEffect(() => { if (salud && salud.contactos_at) cargarContactos(); }, [salud && salud.contactos_at, cargarContactos]); // eslint-disable-line react-hooks/exhaustive-deps

  const filasInfo = useMemo(() => filas.map(f => {
    const t = f.tarifaId != null ? tarifaById.get(f.tarifaId) : null;
    const guardado = t && t.whatsapp ? t.whatsapp : null;
    const sug = !guardado && contactos.length ? sugerirContacto(f.nombre, contactos) : null;
    const env = envioPorCadete.get(norm(f.nombre));
    return { f, t, guardado, sug, env, texto: armarMensaje(f), avisado: avisados.has(norm(f.nombre)) };
  }), [filas, tarifaById, contactos, envioPorCadete, armarMensaje, avisados, norm]);

  // por defecto: los que no avisaste, tienen número y no salieron/están en cola
  useEffect(() => {
    if (elegidos !== null || !filasInfo.length) return;
    setElegidos(new Set(filasInfo.filter(x => !x.avisado && x.guardado && !(x.env && ['en_cola', 'enviando', 'enviado'].includes(x.env.estado))).map(x => x.f.key)));
  }, [filasInfo, elegidos]);

  const sel = elegidos || new Set();
  const puedeElegir = x => !!x.guardado && !(x.env && ['en_cola', 'enviando', 'enviado'].includes(x.env.estado));
  const aMandar = filasInfo.filter(x => sel.has(x.f.key) && puedeElegir(x));
  const sinNumero = filasInfo.filter(x => !x.guardado && !(x.env && x.env.estado === 'enviado'));

  function toggle(key) {
    setElegidos(prev => { const n = new Set(prev || []); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }

  async function guardarNumero(x, valor) {
    setErr('');
    if (!x.t) { setErr(`${x.f.nombre} no tiene config de cadete: dalo de alta primero.`); return; }
    const chat = valor ? normalizarWhatsapp(valor) : null;
    if (valor && !chat) { setErr(`El número de ${x.f.nombre} no parece un celular argentino. Probá con código de área, ej. 11 2233 4455.`); return; }
    try {
      await sb(`cadetes_tarifas?id=eq.${x.t.id}`, { method: 'PATCH', body: JSON.stringify({ whatsapp: chat }) });
      setNumeros(p => { const n = { ...p }; delete n[x.f.key]; return n; });
      onTarifasCambio && onTarifasCambio(x.t.id, chat);
      if (chat && !(x.env && ['en_cola', 'enviando', 'enviado'].includes(x.env.estado)) && !x.avisado) {
        setElegidos(prev => new Set([...(prev || []), x.f.key]));
      }
    } catch (ex) {
      setErr(/whatsapp/.test(ex.message) ? 'Falta correr la migración de WhatsApp en Supabase.' : ex.message);
    }
  }

  async function conectar() {
    setBusy(true); setErr('');
    try { await sb('rpc/liq_wa_encender', { method: 'POST', body: JSON.stringify({ p_minutos: 15 }) }); setMsg('Prendiendo tu WhatsApp en el servidor… tarda hasta 1–2 min.'); await cargar(); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  async function mandar() {
    setBusy(true); setErr(''); setMsg('');
    try {
      const items = aMandar.map(x => ({ cadete: x.f.nombre, chat_id: x.guardado, texto: x.texto }));
      const r = await sb('rpc/liq_wa_encolar', { method: 'POST', body: JSON.stringify({ p_semana: semanaLunes, p_items: items }) });
      const salteados = (r && r.salteados) || [];
      setMsg(`${r.encolados} mensaje${r.encolados === 1 ? '' : 's'} en cola` + (r.termina_aprox ? ` · el último sale ~${hora(r.termina_aprox)}` : '') +
        (salteados.length ? ` · salteados: ${salteados.map(s => `${s.cadete} (${s.motivo})`).join(', ')}` : ''));
      setConfirmar(false);
      setElegidos(new Set());
      await cargar();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  async function frenar() {
    setBusy(true); setErr('');
    try {
      const n = await sb('rpc/liq_wa_cancelar', { method: 'POST', body: JSON.stringify({ p_semana: semanaLunes }) });
      setMsg(`Frenado: ${n} mensaje${n === 1 ? '' : 's'} no se van a mandar.`);
      await cargar();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  }

  const enviadosN = envios.filter(e => e.estado === 'enviado').length;
  const erroresN = envios.filter(e => e.estado === 'error').length;
  const fin = activos.length ? activos[activos.length - 1].enviar_desde : null;

  const btn = (primario, dis) => ({
    padding: '8px 14px', fontSize: 13, fontWeight: 700, borderRadius: 9, cursor: dis ? 'default' : 'pointer', opacity: dis ? 0.5 : 1,
    border: `1px solid ${primario ? BRAND.teal : BRAND.border}`, background: primario ? 'rgba(46,207,170,0.14)' : BRAND.faint, color: primario ? BRAND.teal : BRAND.white,
  });
  const chipEstado = (() => {
    if (!salud) return { t: 'Cargando…', c: BRAND.muted };
    if (conectado) return { t: '● Conectado', c: BRAND.teal };
    if (qrFresco) return { t: 'Pide vincular (QR)', c: BRAND.amber };
    if (salud.estado === 'no_existe' || salud.estado === 'container_caido') return { t: 'Servidor sin configurar', c: BRAND.amber };
    if (!salud.estado) return { t: 'Nunca conectado', c: BRAND.muted };
    if (pidioEncender || activos.length) return { t: 'Conectando…', c: BRAND.muted };
    return { t: 'Apagado · se prende solo al mandar', c: BRAND.muted };
  })();
  const sinSenal = salud && salud.estado_at && (Date.now() - new Date(salud.estado_at).getTime()) > 5 * 60 * 1000 && (activos.length || pidioEncender);

  return (
    <div onClick={onCerrar} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(6,6,26,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 820, maxWidth: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: BRAND.navyCard, border: `1px solid ${BRAND.border}`, borderRadius: 14 }}>
        {/* encabezado */}
        <div style={{ padding: '16px 18px 12px', borderBottom: `1px solid ${BRAND.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Enviar por WhatsApp · {semanaTxt}{alcanceLbl ? <span style={{ color: BRAND.muted, fontWeight: 500 }}> · solo {alcanceLbl}</span> : null}</div>
            <button onClick={onCerrar} aria-label="cerrar" style={{ background: 'none', border: 'none', color: BRAND.muted, cursor: 'pointer', fontSize: 18, padding: 4 }}>✕</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 8, fontSize: 12.5 }}>
            <span style={{ color: BRAND.muted }}>Tu WhatsApp:</span>
            <span style={{ color: chipEstado.c, fontWeight: 700 }}>{chipEstado.t}</span>
            {salud && salud.estado && !conectado && (
              <span style={{ color: BRAND.muted, fontSize: 11.5 }}>servidor: {salud.estado}{salud.estado_at ? ` · ${hora(salud.estado_at)}` : ''}{salud.ultimo_error ? ` · ${salud.ultimo_error}` : ''}</span>
            )}
            {!conectado && !qrFresco && <button disabled={busy} onClick={conectar} style={{ ...btn(false, busy), padding: '4px 10px', fontSize: 12 }}>{salud && salud.estado ? 'Conectar ahora' : 'Vincular mi WhatsApp'}</button>}
            {conectado && <button disabled={busy} onClick={conectar} title="vuelve a leer tus contactos para sugerir números" style={{ ...btn(false, busy), padding: '4px 10px', fontSize: 12 }}>Actualizar contactos</button>}
          </div>
          {sinSenal ? <div style={{ marginTop: 8, fontSize: 12, color: BRAND.amber }}>El servidor no reporta desde las {hora(salud.estado_at)}. Si sigue así, avisale a Hermes.</div> : null}
          {salud && salud.estado === 'no_existe' && <div style={{ marginTop: 8, fontSize: 12, color: BRAND.amber }}>Falta instalar el envío en el VPS (vps/setup-liq-wa.sh).</div>}
        </div>

        <div style={{ overflowY: 'auto', padding: '12px 18px', flex: 1 }}>
          {qrFresco && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', padding: 12, marginBottom: 12, borderRadius: 10, border: `1px solid ${BRAND.border}`, background: BRAND.faint }}>
              <QrImagen valor={salud.qr} />
              <div style={{ flex: '1 1 220px', fontSize: 13, lineHeight: 1.5 }}>
                <b>Escanealo con TU celular</b><br />
                WhatsApp › Ajustes › Dispositivos vinculados › Vincular un dispositivo.<br />
                <span style={{ color: BRAND.muted, fontSize: 12 }}>Si estás mirando esto en el celu, abrí Liquidaciones en la compu: el QR no se puede escanear desde el mismo teléfono. Se renueva solo cada ~15 s.</span>
              </div>
            </div>
          )}

          {(activos.length > 0 || enviadosN > 0 || erroresN > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '10px 12px', marginBottom: 12, borderRadius: 10, border: `1px solid ${BRAND.border}`, fontSize: 13 }}>
              <span><b>{enviadosN}</b> enviado{enviadosN === 1 ? '' : 's'}</span>
              {activos.length > 0 && <span style={{ color: BRAND.muted }}>{activos.length} en cola · termina ~{hora(fin)}</span>}
              {erroresN > 0 && <span style={{ color: BRAND.amber }}>{erroresN} con error</span>}
              {activos.length > 0 && <button disabled={busy} onClick={frenar} style={{ ...btn(false, busy), marginLeft: 'auto', padding: '5px 12px', fontSize: 12 }}>Frenar los que faltan</button>}
            </div>
          )}

          {sinNumero.length > 0 && (
            <div style={{ fontSize: 12, color: BRAND.muted, marginBottom: 8 }}>
              {sinNumero.length} sin número cargado.{contactos.length ? ' Donde aparece una sugerencia de tus contactos, tocá "Usar".' : conectado ? '' : ' Vinculá tu WhatsApp y te sugiero los números de tus contactos.'}
            </div>
          )}

          {filasInfo.map(x => {
            const est = x.env && x.env.estado;
            const elegible = puedeElegir(x);
            const marcado = sel.has(x.f.key) && elegible;
            const escribiendo = numeros[x.f.key];
            return (
              <div key={x.f.key} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 0', borderTop: `1px solid ${BRAND.border}` }}>
                <input type="checkbox" checked={marcado} disabled={!elegible} onChange={() => toggle(x.f.key)}
                  style={{ width: 20, height: 20, marginTop: 2, flex: '0 0 auto', accentColor: BRAND.teal }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{x.f.nombre}</span>
                    {x.guardado && escribiendo === undefined && (
                      <button onClick={() => setNumeros(p => ({ ...p, [x.f.key]: mostrarWhatsapp(x.guardado) }))} title="cambiar número"
                        style={{ background: 'none', border: 'none', padding: 0, color: BRAND.muted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline dotted' }}>{mostrarWhatsapp(x.guardado)}</button>
                    )}
                    {est === 'enviado' && <span style={{ fontSize: 12, color: BRAND.teal }}>✓ enviado {hora(x.env.enviado_at)}</span>}
                    {est === 'en_cola' && <span style={{ fontSize: 12, color: BRAND.muted }}>en cola · ~{hora(x.env.enviar_desde)}</span>}
                    {est === 'enviando' && <span style={{ fontSize: 12, color: BRAND.muted }}>enviando…</span>}
                    {est === 'error' && <span style={{ fontSize: 12, color: BRAND.amber }} title={x.env.error || ''}>no salió: {x.env.error}</span>}
                    {!est && x.avisado && <span style={{ fontSize: 12, color: BRAND.muted }}>ya avisado a mano</span>}
                  </div>
                  {(!x.guardado || escribiendo !== undefined) && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                      <input type="tel" inputMode="tel" placeholder="Celular, ej. 11 2233 4455" value={escribiendo || ''}
                        onChange={e => setNumeros(p => ({ ...p, [x.f.key]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') guardarNumero(x, escribiendo); }}
                        style={{ width: 190, padding: '6px 9px', fontSize: 13, borderRadius: 8, border: `1px solid ${BRAND.border}`, background: BRAND.navy, color: BRAND.white }} />
                      <button disabled={!escribiendo} onClick={() => guardarNumero(x, escribiendo)} style={{ ...btn(false, !escribiendo), padding: '5px 10px', fontSize: 12 }}>Guardar</button>
                      {escribiendo && normalizarWhatsapp(escribiendo) && <span style={{ fontSize: 11.5, color: BRAND.muted }}>{mostrarWhatsapp(normalizarWhatsapp(escribiendo))}</span>}
                      {x.guardado && <button onClick={() => setNumeros(p => { const n = { ...p }; delete n[x.f.key]; return n; })} style={{ background: 'none', border: 'none', color: BRAND.muted, fontSize: 12, cursor: 'pointer' }}>cancelar</button>}
                      {x.sug && !x.sug.ambiguo && escribiendo === undefined && (
                        <span style={{ fontSize: 12, color: BRAND.muted }}>
                          ¿Es <b style={{ color: BRAND.white }}>{x.sug.nombre}</b> {mostrarWhatsapp(x.sug.chat_id)}?{' '}
                          <button onClick={() => guardarNumero(x, x.sug.chat_id)} style={{ ...btn(false, false), padding: '3px 9px', fontSize: 12 }}>Usar</button>
                        </span>
                      )}
                      {x.sug && x.sug.ambiguo && escribiendo === undefined && (
                        <span style={{ fontSize: 12, color: BRAND.muted }}>
                          Coinciden: {x.sug.opciones.map(o => (
                            <button key={o.chat_id} onClick={() => guardarNumero(x, o.chat_id)} style={{ ...btn(false, false), padding: '3px 9px', fontSize: 12, marginLeft: 4 }}>{o.nombre}</button>
                          ))}
                        </span>
                      )}
                    </div>
                  )}
                  <div style={{ marginTop: 5, fontSize: 12.5, color: BRAND.muted, whiteSpace: 'pre-wrap' }}>{x.texto}</div>
                </div>
              </div>
            );
          })}
          {!filasInfo.length && <div style={{ color: BRAND.muted, fontSize: 13, padding: '12px 0' }}>No hay cadetes en esta vista.</div>}
        </div>

        {/* pie */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${BRAND.border}` }}>
          {err && <div style={{ fontSize: 12.5, color: BRAND.amber, marginBottom: 8 }}>{err}</div>}
          {msg && !err && <div style={{ fontSize: 12.5, color: BRAND.muted, marginBottom: 8 }}>{msg}</div>}
          {!confirmar ? (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: BRAND.muted }}>{aMandar.length} elegido{aMandar.length === 1 ? '' : 's'}</span>
              <button onClick={() => setElegidos(new Set(filasInfo.filter(x => puedeElegir(x) && !x.avisado).map(x => x.f.key)))} style={{ ...btn(false, false), padding: '5px 10px', fontSize: 12 }}>Elegir los no avisados</button>
              <button onClick={() => setElegidos(new Set())} style={{ ...btn(false, false), padding: '5px 10px', fontSize: 12 }}>Ninguno</button>
              <button disabled={!aMandar.length || busy} onClick={() => setConfirmar(true)} style={{ ...btn(true, !aMandar.length || busy), marginLeft: 'auto' }}>{aMandar.length ? `Mandar ${aMandar.length} mensaje${aMandar.length === 1 ? '' : 's'}…` : 'Mandar mensajes…'}</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, flex: '1 1 260px' }}>
                Se mandan <b>{aMandar.length}</b> mensaje{aMandar.length === 1 ? '' : 's'} desde <b>tu WhatsApp</b>, de a uno cada ~30 s
                (~{Math.max(1, Math.round(aMandar.length * 30 / 60 + 1))} min). Solo entre las 8 y las 21.
              </span>
              <button disabled={busy} onClick={() => setConfirmar(false)} style={btn(false, busy)}>Volver</button>
              <button disabled={busy} onClick={mandar} style={btn(true, busy)}>{busy ? 'Encolando…' : 'OK, mandar'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
