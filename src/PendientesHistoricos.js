import React, { useEffect, useMemo, useState, useRef } from "react";
import PendingFilters from "./PendingFilters";
import { pendingPriority, OPEN_STATES, isOpenShipment, matchesSelection, ETIQUETAS, estiloEtiqueta, normalizarEtiqueta } from "./pendingPriority";
import { getSession, authedFetch } from "./auth";

const URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";
// Cancelado y Rechazado por el comprador NO son entregas abiertas: se gestionan como devolución a depósito (RETURN_STATES en pendingPriority.js). El grupo identifica casos a gestionar; no prueba que el paquete haya vuelto.
const resolved = /^entregado/i;
const dateOnly = value => String(value || "").split(/[ T]/)[0];
const isoDate = value => {
  const s = dateOnly(value); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};
const parseDate = value => {
  const s = dateOnly(value); if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : s.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, "$3-$2-$1");
  const d = new Date(`${iso}T12:00:00`); return Number.isNaN(d.getTime()) ? null : d;
};
const labelDate = value => { const d = parseDate(value); return d ? d.toLocaleDateString("es-AR", { day:"numeric", month:"long" }) : "Sin fecha"; };
const argentinaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone:"America/Argentina/Buenos_Aires", year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date());
const argentinaYesterday = () => { const d = new Date(`${argentinaToday()}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
// Icono de mensaje elegido por Alejo (opcion A): burbuja pelada, del mismo grosor
// y color que el de copiar, para que los dos se lean como un par.
const IconoMensaje = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ display:"block" }}>
    <path d="M2 4.2A1.7 1.7 0 0 1 3.7 2.5h8.6A1.7 1.7 0 0 1 14 4.2v5.1a1.7 1.7 0 0 1-1.7 1.7H6.6L3.4 13.4V11H3.7A1.7 1.7 0 0 1 2 9.3z" />
  </svg>
);
// Resumen para el tooltip del boton. Se usa el title nativo a proposito: flota
// sobre la pagina sin cambiar el alto de nada, asi que no hace temblar la tabla.
// En el telefono no aparece, y ahi el tap abre el globo, que es lo esperable.
const resumenChat = (lista, puestas) => {
  const partes = [];
  if (puestas?.length) partes.push(puestas.join(" \u00b7 "));
  const ultimos = (lista || []).slice(-3);
  for (const nota of ultimos) {
    const texto = String(nota.texto || "").replace(/\s+/g, " ").trim();
    partes.push(`${nota.autor}: ${texto.length > 90 ? texto.slice(0, 90) + "\u2026" : texto}`);
  }
  if ((lista || []).length > 3) partes.push(`\u2026 y ${lista.length - 3} mensaje(s) m\u00e1s`);
  return partes.length ? partes.join("\n") : "Chat interno del equipo";
};
const autorActual = () => { const s = getSession(); return (s && (s.nombre || s.email)) || "Equipo"; };
// La columna Equipo muestra el ULTIMO mensaje, que es como viene el tema ahora.
const ultimoMensaje = lista => (lista && lista.length) ? lista[lista.length - 1] : null;
// La fecha pesa mas que la hora: un "lo estoy buscando" de hace cuatro dias no
// dice lo mismo que uno de hoy, y mostrando solo la hora se lee como reciente.
// Solo el de hoy lleva hora; el resto, fecha. Amarillo pasados los dos dias,
// el mismo amarillo que ya marca "Atencion" en el semaforo.
const cuandoMensaje = value => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const dia = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dias = Math.round((dia(new Date()) - dia(d)) / 86400000);
  const fecha = d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
  if (dias <= 0) return { texto: `hoy ${d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`, viejo: false };
  if (dias === 1) return { texto: "ayer", viejo: false };
  if (dias < 7) return { texto: `${fecha} · hace ${dias} días`, viejo: true };
  return { texto: fecha, viejo: true };
};
const recortar = (texto, largo = 72) => { const t = String(texto || "").replace(/\s+/g, " ").trim(); return t.length > largo ? t.slice(0, largo - 1) + "…" : t; };
const horaCorta = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-AR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }); };
const serviceOf = row => ["flex", "ml", "mercado libre"].includes(String(row.origen || "").trim().toLowerCase()) ? "Flex" : "Particular";
const dayCard = { width:"100%", minHeight:126, textAlign:"left", display:"flex", flexDirection:"column", gap:4, padding:12, border:"1px solid transparent", background:"rgba(255,255,255,.045)", color:"#fff", borderRadius:9, cursor:"pointer" };
const dayActive = { background:"rgba(46,207,170,.14)", borderColor:"#2ECFAA" };
// Flex en amarillo, elegido por Alejo el 20/09. Ojo: el amarillo tambien marca
// "Atencion +24 h" en el semaforo y el Flex de la tabla sigue en verde agua.
const FLEX_ACCENT = "#f2c94c";
const dayFlexCount = { fontSize:28, lineHeight:1.05, marginTop:8, color:FLEX_ACCENT };
const dayFlexZero = { color:"rgba(255,255,255,.45)" };
const dayPart = { display:"block", marginTop:3, fontSize:11, color:"rgba(255,255,255,.62)" };
const tarjetaAtras = { width:172, flexShrink:0, textAlign:"left", display:"flex", flexDirection:"column", gap:2, padding:12, borderRadius:9, cursor:"pointer", color:"#fff", border:"1px dashed rgba(242,201,76,.5)", background:"rgba(242,201,76,.07)" };
const tarjetaAtrasAbierta = { borderStyle:"solid", borderColor:FLEX_ACCENT, background:"rgba(242,201,76,.13)" };
const atrasTitulo = { fontSize:10.5, fontWeight:700, letterSpacing:.5, textTransform:"uppercase", color:FLEX_ACCENT };
const atrasNumero = { fontSize:26, lineHeight:1.05, marginTop:4 };
const mesPanel = { width:"100%", marginTop:12, paddingTop:12, borderTop:"1px solid rgba(255,255,255,.1)" };
const mesCabecera = { display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:10 };
const mesGrid = { display:"grid", gridTemplateColumns:"repeat(7,minmax(0,1fr))", gap:5, maxWidth:640 };
const mesDow = { fontSize:9.5, fontWeight:700, letterSpacing:.6, textTransform:"uppercase", textAlign:"center", color:"rgba(255,255,255,.52)", paddingBottom:2 };
const mesDia = { minHeight:58, textAlign:"left", padding:"5px 6px", borderRadius:8, cursor:"pointer", color:"#fff", border:"1px solid rgba(255,255,255,.08)", background:"rgba(255,255,255,.035)", display:"flex", flexDirection:"column", gap:1 };
const mesDiaVacio = { opacity:.32 };
const mesDiaFuturo = { opacity:.18, cursor:"default" };
const mesDiaElegido = { borderColor:"#2ECFAA", background:"rgba(46,207,170,.13)" };
const mesDiaNumero = { fontSize:11, color:"rgba(255,255,255,.62)" };
const mesDiaFlex = { fontSize:17, lineHeight:1.1, fontWeight:700, color:FLEX_ACCENT, marginTop:2 };
const mesDiaFlexCero = { color:"rgba(255,255,255,.4)", fontWeight:400, fontSize:14 };
const mesDiaPart = { fontSize:10, color:"rgba(255,255,255,.52)" };
const daysGrid = { display:"grid", gridTemplateColumns:"repeat(7,minmax(78px,1fr))", gap:8, width:"100%", overflowX:"auto", paddingBottom:4 };
// El boton copia al portapapeles: NO manda el mensaje. El rotulo lo dice asi.
const primerNombre = value => String(value || "").trim().split(/\s+/)[0] || "";
function mensajeCadete(row) {
  const nombre = primerNombre(row.cadete);
  const envio = row.id_venta_ml || row.tracking || row.id_interno;
  // LightData trae direcciones con espacios repetidos ("Eva Peron  969").
  const limpio = value => String(value || "").replace(/\s+/g, " ").trim();
  const destino = [limpio(row.direccion), limpio(row.localidad)].filter(Boolean).join(", ");
  return [
    nombre ? `Hola ${nombre}, ¿cómo andás?` : "Hola, ¿cómo andás?",
    `Tengo este envío pendiente desde el ${labelDate(row.origin)} y sigue figurando como "${row.estado || "sin estado"}".`,
    "",
    `Envío ${envio}${row.razon_social ? ` · ${row.razon_social}` : ""}`,
    destino || "Dirección no informada",
    "",
    "¿Me contás qué pasó?",
  ].join("\n");
}
export default function PendientesHistoricos() {
  const [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [day, setDay] = useState(argentinaYesterday);
  // 0 = la semana que termina hoy; -1 la anterior. Las flechas de la tira no
  // hacian nada y prometian algo que el sistema no ejecutaba.
  const [semana, setSemana] = useState(0);
  // Mes abierto en el calendario grande (null = cerrado). La tira solo llega a
  // siete dias y mas de la mitad de los pendientes son anteriores.
  const [mesAbierto, setMesAbierto] = useState(null);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [courier, setCourier] = useState("");
  const [dataAt, setDataAt] = useState(null);
  const [sinc, setSinc] = useState(null);
  const sincRef = useRef(false);
  const [notas, setNotas] = useState({});
  const [etiquetas, setEtiquetas] = useState({});
  // Un borrador por envio: cerrar el globo (a proposito o de rebote) no puede
  // tirar lo que la persona venia escribiendo.
  const [borradores, setBorradores] = useState({});
  const [guardando, setGuardando] = useState(false);
  const abrirPanel = row => setSelected(row);
  // El chat va en un globo anclado al icono. Se posiciona fijo respecto de la ventana
  // porque el contenedor de la tabla tiene overflow y recortaria un absolute.
  const [chat, setChat] = useState(null);
  const [menuNota, setMenuNota] = useState(null);
  const [editando, setEditando] = useState(null);
  const [nuevaEtiqueta, setNuevaEtiqueta] = useState(null);
  const cerrarChat = () => { setChat(null); setMenuNota(null); setEditando(null); setNuevaEtiqueta(null); };
  // El menu de ⋯ vivia dentro del hilo, que tiene overflow para scrollear los
  // mensajes: quedaba recortado a una tirita y no se leia ni Editar ni Borrar.
  // Ahora se ancla a la ventana, igual que el globo con la tabla.
  const abrirMenuNota = (nota, boton) => {
    if (menuNota?.id === nota.id) { setMenuNota(null); return; }
    const caja = boton.getBoundingClientRect();
    const abajo = window.innerHeight - caja.bottom;
    setMenuNota({
      id: nota.id, texto: nota.texto,
      derecha: Math.max(8, window.innerWidth - caja.right),
      arriba: abajo < 90,
      y: caja.bottom + 4,
      abajo: window.innerHeight - caja.top + 4,
    });
  };
  const abrirChat = (row, boton) => {
    const caja = boton.getBoundingClientRect();
    const ancho = Math.min(330, window.innerWidth - 16);
    const izq = Math.max(8, Math.min(caja.right - ancho, window.innerWidth - ancho - 8));
    const abajo = window.innerHeight - caja.bottom;
    setChat({ row, ancho, izq, arriba: abajo < 300, y: abajo < 300 ? window.innerHeight - caja.top + 8 : caja.bottom + 8 });
    setMenuNota(null); setEditando(null); setNuevaEtiqueta(null);
  };
  const [copiado, setCopiado] = useState("");
  const copiar = async row => {
    const texto = mensajeCadete(row);
    // Copia con textarea + execCommand: sirve donde la API moderna esta bloqueada.
    const conTextarea = () => {
      try {
        const area = document.createElement("textarea");
        area.value = texto;
        area.setAttribute("readonly", "");
        area.style.position = "fixed"; area.style.top = "0"; area.style.left = "0"; area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus(); area.select();
        area.setSelectionRange(0, texto.length);
        const hecho = document.execCommand("copy");
        area.remove();
        return hecho;
      } catch { return false; }
    };
    let hecho = false;
    // Antes, si writeText existia pero fallaba, se saltaba el respaldo y se abria
    // el detalle. Ahora un rechazo cae en el respaldo y el usuario no sale de la tabla.
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(texto); hecho = true; }
    } catch { hecho = false; }
    if (!hecho) hecho = conTextarea();
    if (hecho) {
      setCopiado(row.id_interno);
      setTimeout(() => setCopiado(actual => actual === row.id_interno ? "" : actual), 1800);
      return;
    }
    // Ultimo recurso, solo si los dos caminos fallan: el texto a mano en el detalle.
    setCopiado("error:" + row.id_interno);
    abrirPanel(row);
  };
  const loadingRef = useRef(false);
  const [service, setService] = useState("Todos"), [state, setState] = useState([...OPEN_STATES]), [query, setQuery] = useState(""), [selected, setSelected] = useState(null);
  // El chat y las etiquetas viven aparte de los envios: se recargan solos tras escribir,
  // sin volver a pedir las 30k filas de envios_busqueda.
  const cargarEquipo = async () => {
    try {
      const [resNotas, resTags] = await Promise.all([
        authedFetch(URL + '/rest/v1/envio_notas?select=id,envio_id,autor,texto,created_at&order=created_at', { headers:{ apikey:KEY } }),
        authedFetch(URL + '/rest/v1/envio_etiquetas?select=envio_id,etiqueta', { headers:{ apikey:KEY } }),
      ]);
      if (resNotas.ok) {
        const lista = await resNotas.json();
        const mapa = {};
        for (const nota of lista) (mapa[nota.envio_id] = mapa[nota.envio_id] || []).push(nota);
        setNotas(mapa);
      }
      if (resTags.ok) {
        const lista = await resTags.json();
        const mapa = {};
        for (const fila of lista) (mapa[fila.envio_id] = mapa[fila.envio_id] || []).push(fila.etiqueta);
        setEtiquetas(mapa);
      }
    } catch { /* el chat no puede romper la pantalla de pendientes */ }
  };
  const agregarNota = async row => {
    const texto = (borradores[row.id_interno] || "").trim();
    if (!texto || guardando) return;
    setGuardando(true);
    try {
      const res = await authedFetch(URL + '/rest/v1/envio_notas', { method:"POST",
        headers:{ apikey:KEY, "Content-Type":"application/json", Prefer:"return=minimal" },
        body: JSON.stringify({ envio_id: row.id_interno, autor: autorActual(), texto }) });
      if (!res.ok) throw new Error("No se pudo guardar la nota (" + res.status + ")");
      setBorradores(previos => ({ ...previos, [row.id_interno]: "" }));
      await cargarEquipo();
    } catch (e) { setError(e.message); } finally { setGuardando(false); }
  };
  const esMio = nota => nota.autor === autorActual();
  const guardarEdicion = async () => {
    const texto = (editando?.texto || "").trim();
    if (!texto || !editando) return;
    try {
      const res = await authedFetch(URL + '/rest/v1/envio_notas?id=eq.' + editando.id, { method:"PATCH",
        headers:{ apikey:KEY, "Content-Type":"application/json", Prefer:"return=minimal" },
        body: JSON.stringify({ texto }) });
      if (!res.ok) throw new Error("No se pudo editar el mensaje (" + res.status + ")");
      setEditando(null);
      await cargarEquipo();
    } catch (e) { setError(e.message); }
  };
  const borrarNota = async id => {
    try {
      const res = await authedFetch(URL + '/rest/v1/envio_notas?id=eq.' + id, { method:"DELETE", headers:{ apikey:KEY } });
      if (!res.ok) throw new Error("No se pudo borrar el mensaje (" + res.status + ")");
      setMenuNota(null);
      await cargarEquipo();
    } catch (e) { setError(e.message); }
  };
  const crearEtiqueta = async row => {
    const texto = normalizarEtiqueta(nuevaEtiqueta);
    if (!texto) { setNuevaEtiqueta(null); return; }
    const yaEsta = catalogo.find(c => c.toLowerCase() === texto.toLowerCase());
    setNuevaEtiqueta(null);
    // Si ya existe con otra grafia, se usa la que estaba, para no partir la lista.
    const puestas = etiquetas[row.id_interno] || [];
    const clave = yaEsta || texto;
    if (!puestas.includes(clave)) await alternarEtiqueta(row, clave);
  };
  const alternarEtiqueta = async (row, clave) => {
    const puestas = etiquetas[row.id_interno] || [];
    const saca = puestas.includes(clave);
    try {
      const filtro = '?envio_id=eq.' + encodeURIComponent(row.id_interno) + '&etiqueta=eq.' + encodeURIComponent(clave);
      const res = saca
        ? await authedFetch(URL + '/rest/v1/envio_etiquetas' + filtro, { method:"DELETE", headers:{ apikey:KEY } })
        : await authedFetch(URL + '/rest/v1/envio_etiquetas', { method:"POST",
            headers:{ apikey:KEY, "Content-Type":"application/json", Prefer:"resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify({ envio_id: row.id_interno, etiqueta: clave, autor: autorActual() }) });
      if (!res.ok) throw new Error("No se pudo cambiar la etiqueta (" + res.status + ")");
      await cargarEquipo();
    } catch (e) { setError(e.message); }
  };
  const load = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true); setError("");
    try {
      if (!getSession()) throw new Error("Iniciá sesión desde Inicio para consultar los pendientes.");
      const data = [];
      for (let offset = 0; ; offset += 1000) {
        const res = await authedFetch(URL + '/rest/v1/envios_busqueda?select=id_interno,id_venta_ml,tracking,estado,fecha_estado,fecha_flexit,cadete,razon_social,direccion,localidad,origen,fecha_a_planta,actualizado_at&order=id_interno&limit=1000&offset=' + offset, { headers:{ apikey:KEY } });
        if (!res.ok) throw new Error('No se pudieron cargar los pendientes (' + res.status + ')');
        const page = await res.json(); data.push(...page);
        if (page.length < 1000) break;
      }
      setRows(data.filter(r => !resolved.test(String(r.estado || '').trim())).map(r => ({ ...r, service:serviceOf(r), origin:isoDate(r.fecha_a_planta) || isoDate(r.fecha_flexit) || isoDate(r.fecha_estado) })));
      let ultimo = 0;
      for (const row of data) { const at = Date.parse(row.actualizado_at); if (Number.isFinite(at) && at > ultimo) ultimo = at; }
      setDataAt(ultimo ? new Date(ultimo) : null);
      await cargarEquipo();
      return ultimo;
    } catch(e) { setError(e.message); return 0; } finally { setLoading(false); loadingRef.current=false; }
  };

  // El boton releia Supabase, que es lo que ya hace solo cada minuto: no traia
  // nada nuevo. Ahora pide la corrida real contra LightData (funcion
  // refrescar-envios, que dispara el workflow) y espera a que lleguen los datos.
  const refrescar = async () => {
    if (sincRef.current || loadingRef.current) return;
    sincRef.current = true;
    const previo = dataAt ? dataAt.getTime() : 0;
    setSinc("Pidiendo datos nuevos a LightData…");
    try {
      let respuesta = {};
      try {
        const res = await authedFetch(URL + "/functions/v1/refrescar-envios", { method: "POST", headers: { apikey: KEY } });
        respuesta = await res.json().catch(() => ({}));
      } catch { respuesta = { ok: false, motivo: "red" }; }

      if (!respuesta.ok) {
        await load();
        setSinc(respuesta.motivo === "reciente"
          ? `Los datos ya son de hace ${respuesta.minutos} min. Se recargó la pantalla, no se pidió una corrida nueva.`
          : "No se pudo pedir una corrida nueva. Se recargó lo que ya había en la base.");
        setTimeout(() => setSinc(null), 8000);
        return;
      }

      setSinc("Bajando de LightData. Tarda un par de minutos.");
      for (let intento = 0; intento < 15; intento++) {
        await new Promise(fin => setTimeout(fin, 20000));
        const ahora = await load();
        if (ahora && ahora > previo) {
          setSinc("Datos actualizados.");
          setTimeout(() => setSinc(null), 5000);
          return;
        }
      }
      setSinc("La corrida se pidió pero todavía no llegó. Probá de nuevo en un minuto.");
      setTimeout(() => setSinc(null), 10000);
    } finally { sincRef.current = false; }
  };
  useEffect(() => {
    if (!chat) return undefined;
    const fuera = e => { if (!e.target.closest?.("[data-chat]")) cerrarChat(); };
    const escape = e => { if (e.key === "Escape") cerrarChat(); };
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", escape);
    // Con capture, este handler ve TAMBIEN el scroll de cualquier elemento, y un
    // input al que se le acaba el ancho scrollea su contenido: escribir largo
    // cerraba el globo solo. Solo cierra el scroll de afuera del globo.
    const scrolleo = e => {
      if (!e.target?.closest?.("[data-chat]")) { cerrarChat(); return; }
      setMenuNota(null); // el menu esta anclado a la ventana y no acompana al hilo
    };
    window.addEventListener("scroll", scrolleo, true);
    window.addEventListener("resize", cerrarChat);
    return () => { document.removeEventListener("pointerdown", fuera); document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scrolleo, true); window.removeEventListener("resize", cerrarChat); };
  }, [chat]);
  useEffect(() => { load(); const timer=setInterval(() => { if (!document.hidden) load(); },60000); return () => clearInterval(timer); }, []);
  const states = useMemo(() => [...new Set(rows.map(r => String(r.estado || "Sin estado").trim()))].sort(), [rows]);
  // Las etiquetas propias son globales: una vez que alguien la escribe, aparece en
  // todos los envios. Se derivan de lo ya guardado, sin tabla de catalogo aparte.
  const catalogo = useMemo(() => {
    const fijas = ETIQUETAS.map(e => e.clave);
    const propias = [];
    for (const lista of Object.values(etiquetas)) for (const clave of lista) {
      if (fijas.includes(clave)) continue;
      if (!propias.some(p => p.toLowerCase() === clave.toLowerCase())) propias.push(clave);
    }
    propias.sort((a, b) => a.localeCompare(b));
    return [...fijas, ...propias];
  }, [etiquetas]);
  const couriers = useMemo(() => [...new Set(rows.map(r => r.cadete || "Sin asignar"))].sort((a,b) => a.localeCompare(b)), [rows]);
  const visible = useMemo(() => rows.filter(r => (!day || r.origin === day) && (!criticalOnly || pendingPriority(r).rank === 3) && (service === "Todos" || r.service === service) && (!courier || (r.cadete || "Sin asignar") === courier) && matchesSelection(r, state) && `${r.id_venta_ml} ${r.tracking} ${r.razon_social} ${r.cadete} ${r.direccion} ${r.localidad}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => pendingPriority(b).rank - pendingPriority(a).rank || String(a.origin).localeCompare(String(b.origin)) || Number(b.service === "Flex") - Number(a.service === "Flex")), [rows,day,service,state,query,criticalOnly,courier]);
  const calendarDays = useMemo(() => {
    // El calendario es histórico: termina en hoy y nunca adelanta fechas futuras.
    const base = parseDate(argentinaToday()) || new Date(); const start = new Date(base); start.setDate(start.getDate() - 6 + semana * 7);
    return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); const key = d.toISOString().slice(0, 10); const rs = rows.filter(r => r.origin === key && isOpenShipment(r)); const flex = rs.filter(r => r.service === "Flex").length; return { key, d, rs, flex, part: rs.length - flex }; });
  }, [rows, semana]);

  // Todo lo abierto anterior a la semana que termina hoy. Es la puerta al resto
  // del historial: hoy la tira lo esconde entero.
  const anteriores = useMemo(() => {
    const base = parseDate(argentinaToday()) || new Date();
    const corte = new Date(base); corte.setDate(corte.getDate() - 6);
    const clave = corte.toISOString().slice(0, 10);
    const rs = rows.filter(r => isOpenShipment(r) && r.origin && r.origin < clave);
    const flex = rs.filter(r => r.service === "Flex").length;
    const viejo = rs.reduce((min, r) => (!min || r.origin < min ? r.origin : min), "");
    return { total: rs.length, flex, part: rs.length - flex, viejo };
  }, [rows]);

  const mesDe = clave => clave.slice(0, 7);
  const moverMes = paso => { const [a, m] = mesAbierto.split("-").map(Number); const d = new Date(a, m - 1 + paso, 1); setMesAbierto(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); };
  const diasDelMes = useMemo(() => {
    if (!mesAbierto) return null;
    const [anio, mes] = mesAbierto.split("-").map(Number);
    const primero = new Date(anio, mes - 1, 1);
    const largo = new Date(anio, mes, 0).getDate();
    const hoy = argentinaToday();
    const celdas = Array.from({ length: primero.getDay() }, () => null);
    for (let n = 1; n <= largo; n++) {
      const key = `${anio}-${String(mes).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
      const rs = rows.filter(r => r.origin === key && isOpenShipment(r));
      const flex = rs.filter(r => r.service === "Flex").length;
      celdas.push({ key, n, total: rs.length, flex, part: rs.length - flex, esHoy: key === hoy, futuro: key > hoy });
    }
    return {
      celdas,
      flex: celdas.reduce((t, c) => t + (c ? c.flex : 0), 0),
      part: celdas.reduce((t, c) => t + (c ? c.part : 0), 0),
      titulo: primero.toLocaleDateString("es-AR", { month: "long", year: "numeric" }),
    };
  }, [rows, mesAbierto]);
  return <div style={{ color:"#fff" }}>
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:16, flexWrap:"wrap", marginBottom:16 }}><div><h2 style={{ margin:0, fontSize:22 }}>Pendientes históricos</h2><div style={{ color:"rgba(255,255,255,.62)", fontSize:12, marginTop:5 }}>Cada envío pendiente, hasta su resolución.</div></div><div style={{ display:"flex", alignItems:"center", gap:12 }}><div style={{ textAlign:"right", color:"rgba(255,255,255,.55)", fontSize:11 }}>Última actualización de datos<br/><b style={{ color:"#fff" }}>{dataAt ? dataAt.toLocaleString("es-AR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }) : "sin dato"}</b>{sinc ? <div style={{ marginTop:4, color:"rgba(255,255,255,.72)", fontSize:11, maxWidth:260 }}>{sinc}</div> : null}</div><button onClick={refrescar} disabled={loading || !!sinc} style={button}>{sinc ? "Actualizando…" : "↻ Actualizar"}</button></div></div>
    <div style={urgentHero}><div style={{display:"flex",alignItems:"center",gap:18}}><strong style={{ fontSize:34, lineHeight:1 }}>{rows.filter(r => pendingPriority(r).rank === 3).length}</strong><div><b>Flex abiertos con más de 48 horas</b><small style={{display:"block",marginTop:5,color:"#bfc7d8"}}>Estos envíos necesitan seguimiento prioritario.</small></div></div><button onClick={() => { setCriticalOnly(true); setDay(""); setService("Flex"); setState([...OPEN_STATES]); setCourier(""); setQuery(""); }} style={urgentButton}>Revisar urgentes →</button></div>
    {error && <div style={{ ...banner, borderColor:"rgba(226,75,74,.45)", color:"#ffadb4" }}>{error}</div>}
    <div style={calendar}><div style={{ width:"100%", display:"flex", flexWrap:"wrap", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:10 }}><div><b style={{ fontSize:15 }}>Flex abiertos por día</b><small style={muted}>Fecha de origen · ingreso A planta</small></div><div style={{ display:"flex", alignItems:"center", gap:6 }}><span style={muted}>Semana seleccionada</span><button onClick={() => setSemana(v => v - 1)} title="Semana anterior" style={button}>←</button><button onClick={() => setSemana(0)} disabled={semana === 0} style={{ ...button, opacity: semana === 0 ? .45 : 1 }}>Semana actual</button><button onClick={() => setSemana(v => Math.min(0, v + 1))} disabled={semana === 0} title="Semana siguiente" style={{ ...button, opacity: semana === 0 ? .45 : 1 }}>→</button></div></div><div style={{ display:"flex", gap:8, width:"100%", alignItems:"stretch" }}><div style={{ ...daysGrid, flex:1, minWidth:0 }}>{calendarDays.map(({key,d,rs,flex,part}) => <div key={key} style={{ position:"relative" }}><button onClick={() => { setDay(key); setMesAbierto(null); }} style={{ ...dayCard, ...(day===key?dayActive:{}) }}><small style={{ textTransform:"capitalize", fontSize:11, lineHeight:1.1 }}>{d.toLocaleDateString("es-AR", { weekday:"long" })}</small><b style={{ fontSize:12, lineHeight:1.1 }}>{d.getDate()}</b><strong style={{ ...dayFlexCount, ...(rs.length && flex ? {} : dayFlexZero) }}>{rs.length ? flex : "—"}</strong><small>{rs.length ? "Flex" : "sin cobertura"}</small>{rs.length > 0 && <small style={dayPart}>+ {part} {part === 1 ? "particular" : "particulares"}</small>}</button></div>)}</div>
      {anteriores.total > 0 && <button onClick={() => setMesAbierto(mesAbierto ? null : mesDe(argentinaToday()))} style={{ ...tarjetaAtras, ...(mesAbierto ? tarjetaAtrasAbierta : {}) }}>
        <small style={atrasTitulo}>Antes de esta semana</small>
        <strong style={atrasNumero}>{anteriores.total}</strong>
        <small style={dayPart}>{anteriores.flex} Flex · {anteriores.part} {anteriores.part === 1 ? "particular" : "particulares"}</small>
        {anteriores.viejo && <small style={dayPart}>El más viejo, del {labelDate(anteriores.viejo)}</small>}
        <small style={{ ...dayPart, color:FLEX_ACCENT, marginTop:6 }}>{mesAbierto ? "Cerrar calendario ▲" : "Ver por mes ▼"}</small>
      </button>}</div>
      {diasDelMes && <div style={mesPanel}>
        <div style={mesCabecera}>
          <div><b style={{ fontSize:14, textTransform:"capitalize" }}>{diasDelMes.titulo}</b><small style={muted}>{diasDelMes.flex} Flex · {diasDelMes.part} particulares · {diasDelMes.flex + diasDelMes.part} pendientes</small></div>
          <div style={{ display:"flex", gap:6 }}>
            <button onClick={() => moverMes(-1)} title="Mes anterior" style={button}>←</button>
            <button onClick={() => setMesAbierto(mesDe(argentinaToday()))} style={button}>Este mes</button>
            <button onClick={() => moverMes(1)} title="Mes siguiente" style={button}>→</button>
          </div>
        </div>
        <div style={mesGrid}>
          {["Do","Lu","Ma","Mi","Ju","Vi","Sa"].map(n => <div key={n} style={mesDow}>{n}</div>)}
          {diasDelMes.celdas.map((c, i) => c === null
            ? <div key={"v" + i} />
            : <button key={c.key} onClick={() => { setDay(c.key); setCriticalOnly(false); }} disabled={c.futuro}
                style={{ ...mesDia, ...(c.total ? {} : mesDiaVacio), ...(c.futuro ? mesDiaFuturo : {}), ...(day === c.key ? mesDiaElegido : {}) }}>
                <small style={{ ...mesDiaNumero, ...(c.esHoy ? { color:"#6de4c3", fontWeight:700 } : {}) }}>{c.n}{c.esHoy ? " · hoy" : ""}</small>
                <strong style={{ ...mesDiaFlex, ...(c.flex ? {} : mesDiaFlexCero) }}>{c.total ? c.flex : "0"}</strong>
                {c.part > 0 && <small style={mesDiaPart}>+{c.part} part.</small>}
              </button>)}
        </div>
      </div>}</div>
    <PendingFilters title={day ? 'Pendientes del ' + parseDate(day).toLocaleDateString("es-AR", {weekday:"long",day:"numeric",month:"long"}) : "Pendientes de todo el historial"} count={visible.length} service={service} setService={setService} query={query} setQuery={setQuery} courier={courier} setCourier={setCourier} couriers={couriers} sinAsignar={rows.filter(r => isOpenShipment(r) && !String(r.cadete || "").trim()).length} states={states} selectedStates={state} setSelectedStates={value => {setState(value);setCriticalOnly(false);}} showHistory={() => {setDay("");setCriticalOnly(false);}} showYesterday={() => {setDay(argentinaYesterday());setCriticalOnly(false);}} criticalOnly={criticalOnly} clearCritical={() => setCriticalOnly(false)} />
    <div style={{ ...card, borderTop:0, borderRadius:"0 0 10px 10px", overflowX:"auto" }}><table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}><thead><tr>{["Fecha de origen","Servicio / envío","Asignado a","Cliente / dirección","Equipo","Estado",""].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead><tbody>{loading && rows.length === 0 ? <tr><td colSpan="7" style={empty}>Cargando pendientes…</td></tr> : rows.length===0 ? <tr><td colSpan="7" style={empty}><b>No hay datos históricos cargados.</b><br/><small>La consulta respondió correctamente, pero la caché de envíos está vacía. Hay que ejecutar la sincronización de LightData.</small></td></tr> : visible.length===0 ? <tr><td colSpan="7" style={empty}>No hay pendientes para estos filtros.</td></tr> : visible.map(r => <tr key={r.id_interno} onClick={()=>abrirPanel(r)} style={{ borderTop:"1px solid rgba(255,255,255,.08)", cursor:"pointer" }}><td style={td}><b>{labelDate(r.origin)}</b></td><td style={td}><span style={{ ...pill, ...(r.service==="Flex"?flexPill:{}) }}>{r.service}</span><small style={muted}>{r.id_venta_ml || r.tracking || r.id_interno}</small></td><td style={td}><b>{r.cadete || "Sin asignar"}</b><small style={muted}>Último movimiento: {labelDate(r.fecha_estado)}</small></td><td style={td}><b>{r.razon_social || "Cliente sin nombre"}</b><small style={muted}>{[r.direccion,r.localidad].filter(Boolean).join(" · ") || "Dirección no informada"}</small></td><td style={{ ...td, maxWidth:230 }}>{(etiquetas[r.id_interno] || []).length > 0 && <div style={{ ...burbujas, marginTop:0 }}>{(etiquetas[r.id_interno] || []).map(clave => { const e = estiloEtiqueta(clave); return <span key={clave} style={{ ...burbuja, color:e.color, background:e.fondo, borderColor:e.borde }}>{e.texto}</span>; })}</div>}{ultimoMensaje(notas[r.id_interno])
        ? <div title={resumenChat(notas[r.id_interno], etiquetas[r.id_interno])} style={{ ...ultimoTexto, marginTop:(etiquetas[r.id_interno] || []).length ? 6 : 0 }}><span style={ultimoAutor}>{ultimoMensaje(notas[r.id_interno]).autor}</span>{(() => { const c = cuandoMensaje(ultimoMensaje(notas[r.id_interno]).created_at); return c ? <span style={{ ...ultimoCuando, ...(c.viejo ? { color:FLEX_ACCENT } : {}) }}> · {c.texto}</span> : null; })()} — {recortar(ultimoMensaje(notas[r.id_interno]).texto)}</div>
        : (etiquetas[r.id_interno] || []).length ? null : <span style={sinMensaje}>—</span>}</td><td style={td}>{r.estado || "Sin estado"}<small style={{...muted,color:pendingPriority(r).color,fontWeight:700}}>● {pendingPriority(r).label}</small></td><td style={{ ...td, textAlign:"right" }}><button onClick={e => { e.stopPropagation(); copiar(r); }} title="Copiar mensaje para el cadete" aria-label="Copiar mensaje para el cadete" style={{ ...copyIcon, ...(copiado === r.id_interno ? copyButtonOk : {}) }}>{copiado === r.id_interno ? "✓" : "⧉"}</button><span style={{ position:"relative", display:"inline-flex", marginLeft:6 }}><button data-chat onClick={e => { e.stopPropagation(); chat && chat.row.id_interno === r.id_interno ? cerrarChat() : abrirChat(r, e.currentTarget); }} title={resumenChat(notas[r.id_interno], etiquetas[r.id_interno])} aria-label="Chat interno del equipo" style={{ ...copyIcon, ...((notas[r.id_interno] || []).length || (etiquetas[r.id_interno] || []).length ? copyButtonOk : {}) }}><IconoMensaje /></button>{(notas[r.id_interno] || []).length > 0 && <span style={contador}>{(notas[r.id_interno] || []).length}</span>}</span></td></tr>)}</tbody></table></div>
    {chat && <div data-chat style={{ ...globo, width:chat.ancho, left:chat.izq, ...(chat.arriba ? { bottom:chat.y } : { top:chat.y }) }}>
      <div style={globoCabeza}>{chat.row.cadete || "Sin asignar"} · {chat.row.id_venta_ml || chat.row.tracking || chat.row.id_interno}</div>
      <div style={globoTags}>
        {catalogo.map(clave => { const e = estiloEtiqueta(clave); const puesta = (etiquetas[chat.row.id_interno] || []).includes(clave); return <button key={clave} onClick={() => alternarEtiqueta(chat.row, clave)} style={{ ...globoTag, ...(puesta ? { color:e.color, background:e.fondo, borderColor:e.borde } : {}) }}>{e.texto}</button>; })}
        {nuevaEtiqueta === null
          ? <button onClick={() => setNuevaEtiqueta("")} title="Crear una etiqueta propia" style={globoTagNueva}>+ Otra</button>
          : <input value={nuevaEtiqueta} autoFocus maxLength={28} onChange={e => setNuevaEtiqueta(e.target.value)} onKeyDown={e => { if (e.key === "Enter") crearEtiqueta(chat.row); if (e.key === "Escape") setNuevaEtiqueta(null); }} onBlur={() => setNuevaEtiqueta(null)} placeholder="Nombre…" style={globoTagInput} />}
      </div>
      <div style={globoHilo}>
        {(notas[chat.row.id_interno] || []).length === 0 && <div style={globoVacio}>Sin mensajes todavía.</div>}
        {(notas[chat.row.id_interno] || []).map(nota => editando?.id === nota.id
          ? <div key={nota.id} style={globoLinea}>
              <input value={editando.texto} autoFocus onChange={ev => setEditando({ ...editando, texto:ev.target.value })} onKeyDown={ev => { if (ev.key === "Enter") guardarEdicion(); if (ev.key === "Escape") setEditando(null); }} style={globoEdit} />
              <button onClick={guardarEdicion} style={globoAccion}>Guardar</button>
              <button onClick={() => setEditando(null)} style={{ ...globoAccion, color:"rgba(255,255,255,.55)" }}>Cancelar</button>
            </div>
          : <div key={nota.id} style={globoLinea}>
              <span style={globoAutor}>{nota.autor}</span>
              <span style={globoTexto}>{nota.texto}</span>
              <span style={globoHora}>{horaCorta(nota.created_at).split(",").pop().trim()}</span>
              {esMio(nota) && <button onClick={e => abrirMenuNota(nota, e.currentTarget)} title="Editar o borrar" aria-label="Editar o borrar" style={globoPuntos}>⋯</button>}
            </div>)}
      </div>
      <div style={globoPie}>
        <input value={borradores[chat.row.id_interno] || ""} onChange={e => { const v = e.target.value; setBorradores(previos => ({ ...previos, [chat.row.id_interno]: v })); }} onKeyDown={e => { if (e.key === "Enter") agregarNota(chat.row); }} placeholder="Escribí algo…" style={globoInput} />
        <button onClick={() => agregarNota(chat.row)} disabled={guardando || !(borradores[chat.row.id_interno] || "").trim()} title="Enviar" aria-label="Enviar" style={{ ...globoEnviar, opacity: guardando || !(borradores[chat.row.id_interno] || "").trim() ? .45 : 1 }}>↑</button>
      </div>
      {menuNota && <div style={{ ...globoMenu, right:menuNota.derecha, ...(menuNota.arriba ? { bottom:menuNota.abajo } : { top:menuNota.y }) }}>
        <button onClick={() => { setEditando({ id:menuNota.id, texto:menuNota.texto }); setMenuNota(null); }} style={globoMenuItem}>Editar</button>
        <button onClick={() => borrarNota(menuNota.id)} style={{ ...globoMenuItem, color:"#ff9aa4" }}>Borrar</button>
      </div>}
    </div>}
    {selected && <div role="dialog" onClick={()=>setSelected(null)} style={overlay}><div onClick={e=>e.stopPropagation()} style={drawer}><button onClick={()=>setSelected(null)} style={{ ...button, float:"right" }}>×</button><div style={muted}>DETALLE DEL ENVÍO</div><h2>{selected.id_venta_ml || selected.tracking || selected.id_interno}</h2><p><b>{selected.service}</b> · {selected.estado || "Sin estado"}</p><hr/><p><b>Fecha de origen</b><br/>{labelDate(selected.origin)}</p><p><b>Asignado a</b><br/>{selected.cadete || "Sin asignar"}</p><p><b>Cliente</b><br/>{selected.razon_social || "Sin nombre"}</p><p><b>Dirección</b><br/>{[selected.direccion,selected.localidad].filter(Boolean).join(" · ") || "No informada"}</p><hr/><div style={muted}>MENSAJE PARA EL CADETE</div>{copiado === "error:" + selected.id_interno
        ? <><textarea readOnly value={mensajeCadete(selected)} ref={el => { if (el) { try { el.focus({ preventScroll:true }); el.setSelectionRange(0, el.value.length); } catch {} } }} onFocus={e => e.target.select()} onClick={e => e.target.select()} style={mensajeCampo} /><small style={{ ...muted, marginBottom:10 }}>Este navegador no deja copiar solo. Tocá el texto para seleccionarlo y copialo a mano.</small></>
        : <pre style={mensajePreview}>{mensajeCadete(selected)}</pre>}<button onClick={() => copiar(selected)} style={{ ...copyButton, ...(copiado === selected.id_interno ? copyButtonOk : {}) }}>{copiado === selected.id_interno ? "Copiado ✓" : "Copiar mensaje"}</button></div></div>}
  </div>;
}
const button={border:"1px solid rgba(255,255,255,.16)",background:"rgba(255,255,255,.06)",color:"#fff",borderRadius:8,padding:"8px 12px",cursor:"pointer"};const banner={padding:"10px 13px",border:"1px solid rgba(239,159,39,.35)",background:"rgba(239,159,39,.08)",borderRadius:8,color:"#f1d39b",fontSize:12,marginBottom:12};const calendar={display:"flex",alignItems:"end",justifyContent:"space-between",gap:12,flexWrap:"wrap",background:"rgba(13,31,55,.86)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:14};const card={background:"rgba(13,31,55,.86)",border:"1px solid rgba(255,255,255,.1)",borderRadius:10,padding:14};const th={textAlign:"left",color:"rgba(255,255,255,.55)",fontSize:10,textTransform:"uppercase",padding:"9px 8px"};const td={padding:"12px 8px",verticalAlign:"top"};const muted={display:"block",color:"rgba(255,255,255,.55)",fontSize:11,marginTop:4};const pill={display:"inline-block",padding:"3px 7px",borderRadius:5,background:"rgba(255,255,255,.1)",fontSize:10,marginBottom:4};const flexPill={background:"rgba(46,207,170,.16)",color:"#6de4c3"};const empty={padding:30,textAlign:"center",color:"rgba(255,255,255,.6)"};const copyButton={border:"1px solid rgba(255,255,255,.18)",background:"rgba(255,255,255,.06)",color:"#fff",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",minWidth:118};
const globo={position:"fixed",zIndex:1100,background:"#11233c",border:"1px solid rgba(255,255,255,.16)",borderRadius:12,boxShadow:"0 18px 44px #000a",padding:12,boxSizing:"border-box"};
const globoCabeza={fontSize:10,color:"rgba(255,255,255,.52)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:8};
const globoTags={display:"flex",gap:5,flexWrap:"wrap"};
const globoTag={fontSize:10.5,fontWeight:700,padding:"3px 9px",borderRadius:999,cursor:"pointer",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.14)",color:"rgba(255,255,255,.58)"};
const globoTagNueva={fontSize:10.5,fontWeight:700,padding:"3px 9px",borderRadius:999,cursor:"pointer",background:"transparent",border:"1px dashed rgba(46,207,170,.5)",color:"#6de4c3"};
const globoTagInput={fontSize:10.5,fontWeight:700,padding:"3px 9px",borderRadius:999,width:104,background:"rgba(255,255,255,.08)",border:"1px solid rgba(46,207,170,.6)",color:"#fff",fontFamily:"inherit"};
const globoHilo={margin:"10px 0",borderTop:"1px solid rgba(255,255,255,.08)",borderBottom:"1px solid rgba(255,255,255,.08)",padding:"6px 0",maxHeight:230,overflowY:"auto"};
const globoVacio={fontSize:11.5,color:"rgba(255,255,255,.45)",padding:"8px 2px"};
const globoLinea={display:"flex",gap:8,alignItems:"flex-start",padding:"5px 0"};
const globoAutor={fontSize:11,fontWeight:700,color:"#6de4c3",flexShrink:0,minWidth:52};
const globoTexto={fontSize:12.5,lineHeight:1.45,color:"#e9eef6",flex:1,wordBreak:"break-word",whiteSpace:"pre-wrap"};
const globoHora={fontSize:10,color:"rgba(255,255,255,.4)",flexShrink:0};
const globoPuntos={width:20,height:20,borderRadius:5,border:"1px solid rgba(255,255,255,.14)",background:"rgba(255,255,255,.05)",color:"rgba(255,255,255,.6)",fontSize:12,lineHeight:1,cursor:"pointer",padding:0};
const globoMenu={position:"fixed",zIndex:1200,background:"#12253f",border:"1px solid rgba(255,255,255,.18)",borderRadius:8,padding:4,minWidth:104,boxShadow:"0 10px 26px #0009",display:"flex",flexDirection:"column"};
const globoMenuItem={textAlign:"left",padding:"6px 9px",borderRadius:5,fontSize:11.5,border:0,background:"none",color:"#fff",cursor:"pointer"};
const globoEdit={flex:1,background:"rgba(255,255,255,.07)",border:"1px solid rgba(46,207,170,.5)",borderRadius:7,padding:"6px 9px",fontSize:12.5,color:"#fff",fontFamily:"inherit",minWidth:0};
const globoAccion={border:0,background:"none",color:"#6de4c3",fontSize:11,fontWeight:700,cursor:"pointer",padding:"0 2px",flexShrink:0};
const globoPie={display:"flex",gap:7,alignItems:"center"};
const globoInput={flex:1,background:"rgba(255,255,255,.06)",border:"1px solid rgba(255,255,255,.14)",borderRadius:999,padding:"7px 13px",color:"#fff",fontSize:12.5,fontFamily:"inherit",minWidth:0};
const globoEnviar={width:30,height:30,borderRadius:999,background:"#2ECFAA",color:"#06231c",fontSize:14,fontWeight:800,border:0,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,padding:0};
const ultimoTexto={fontSize:11.5,lineHeight:1.45,color:"#e9eef6"};
const ultimoCuando={fontSize:10.5,color:"rgba(255,255,255,.42)"};
const ultimoAutor={color:"#6de4c3",fontWeight:700};
const sinMensaje={color:"rgba(255,255,255,.28)",fontSize:11.5};
const burbujas={display:"flex",gap:4,flexWrap:"wrap",marginTop:6};
const burbuja={display:"inline-block",padding:"2px 8px",borderRadius:999,fontSize:10,fontWeight:700,borderWidth:1,borderStyle:"solid"};
const contador={position:"absolute",top:-6,right:-6,minWidth:17,height:17,padding:"0 4px",borderRadius:999,background:"#ff6874",color:"#1d1420",fontSize:10,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",border:"2px solid #0d1f37",pointerEvents:"none"};
const copyIcon={width:30,height:30,display:"inline-flex",alignItems:"center",justifyContent:"center",padding:0,border:"1px solid rgba(255,255,255,.18)",background:"rgba(255,255,255,.06)",color:"#fff",borderRadius:7,fontSize:14,lineHeight:1,cursor:"pointer"};
const copyButtonOk={borderColor:"#2ECFAA",background:"rgba(46,207,170,.16)",color:"#6de4c3"};
const mensajeCampo={width:"100%",minHeight:132,boxSizing:"border-box",resize:"vertical",fontFamily:"inherit",fontSize:12,lineHeight:1.5,margin:"8px 0 6px",padding:12,borderRadius:8,background:"rgba(255,255,255,.05)",border:"1px solid rgba(46,207,170,.45)",color:"#fff"};
const mensajePreview={whiteSpace:"pre-wrap",fontFamily:"inherit",fontSize:12,lineHeight:1.5,margin:"8px 0 12px",padding:12,borderRadius:8,background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.1)",color:"#dbe3ef"};
const overlay={position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:1000,display:"flex",justifyContent:"flex-end"};const drawer={height:"100%",width:"min(430px,100%)",background:"#0d1f37",padding:24,boxSizing:"border-box",overflowY:"auto"};








const urgentHero={display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,flexWrap:"wrap",padding:"14px 18px",margin:"0 0 14px",border:"1px solid rgba(255,102,112,.4)",borderLeft:"6px solid #ff6874",borderRadius:9,background:"rgba(90,30,45,.35)"};
const urgentButton={border:0,borderRadius:7,padding:"10px 16px",background:"#ff6874",color:"#1d1420",fontWeight:800,cursor:"pointer"};
