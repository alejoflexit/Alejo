import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { authedFetch, getSession } from "./auth";
import { sbFetch } from "./colectasShared";
import {
  armarCasos, resumen, ordenar, MARCAS, LIMITE_CALLE, LIMITE_DEPOSITO,
  QR_PREFIJO, codigoDeQR, agruparParaRemitos, reclamosPorCadete, mensajeReclamo, CHOFER_FICTICIO,
  progresoDelDia, metaCumplida, metaDevolver, racha, inicioSemana, trajoPorCadete, diaAR, calidadDeImagen, textoCalidad, coincideBusqueda, casoDeEtiqueta, listosParaDevolver, MAX_POR_REMITO,
} from "./devolucionesShared";

// Devoluciones — seguimiento de cancelados y cambios (logística inversa) + remitos con QR.
// Datos: tabla devoluciones (sync de LightData cada hora, workflow devoluciones.yml) + marcas del equipo
// (devoluciones_gestion) + remitos_devolucion. Al subir la foto del remito firmado, el workflow lee la
// lista de envíos del remito y los pasa a "Devuelto al cliente" en LightData.
// Reglas de etapa y días: devolucionesShared.js. Estética: la de Monitoreo (vidrio, grises, un acento).

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const REFRESH_MS = 2 * 60 * 1000;

const C = {
  ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e",
  glass: "rgba(27,28,46,0.72)", line: "rgba(255,255,255,0.06)", soft: "rgba(255,255,255,0.05)",
  teal: "#2ee6b6", ambar: "#F5C044",
  grotesk: "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
};
const card = { background: C.glass, border: `1px solid ${C.line}`, borderRadius: 16, WebkitBackdropFilter: "blur(18px)", backdropFilter: "blur(18px)" };
const num = (n) => new Intl.NumberFormat("es-AR").format(Math.round(n || 0));
const plata = (n) => (n ? "$" + num(n) : "—");
const fecha = (iso) => (iso ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—");
const hace = (iso) => {
  if (!iso) return "nunca";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};
const fechaCorta = (iso) => { const d = diaAR(iso); return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—"; };
const yo = () => { const s = getSession(); return (s && (s.nombre || s.email)) || "equipo"; };

async function traerTodo(path) {
  const out = [];
  for (let o = 0; ; o += 1000) {
    const rows = await sbFetch(`${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${o}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const guardarGestion = (filas) => sbFetch("devoluciones_gestion?on_conflict=did", {
  method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(filas.map((f) => ({ ...f, actualizado_at: new Date().toISOString() }))),
});
// Registro de acciones (quién hizo qué): alimenta el progreso y la semana. Si falla, no frena el trabajo.
const registrar = (tipo, cantidad = 1, cadete = null, detalle = null) => sbFetch("devoluciones_eventos", {
  method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ tipo, cantidad, cadete, por: yo(), detalle }),
}).catch(() => {});
const pedirAccion = (accion) => authedFetch(`${SUPABASE_URL}/functions/v1/devoluciones-accion`, { method: "POST", body: JSON.stringify({ accion }) })
  .then((r) => r.json()).catch(() => ({ ok: false, motivo: "red" }));

const AYUDA = {
  calle: "Todavía no volvieron al depósito. Cancelados: el cadete no los devolvió (no están asignados a “devuelto deposito” en LightData). Cambios: el cadete ya retiró el producto al comprador y no se marcó el ingreso. Los días cuentan desde la cancelación (cambios: desde el retiro).",
  deposito: "Ya están en el depósito y falta devolvérselos al cliente. Cancelados: chofer “devuelto deposito” en LightData, o pasados a depósito acá. Cambios: pasados a depósito acá. Los días cuentan desde que ingresaron. Se cierran con un remito firmado.",
  calleVenc: `En la calle hace más de ${LIMITE_CALLE} días. Son los primeros a reclamar.`,
  depositoVenc: `En el depósito hace más de ${LIMITE_DEPOSITO} días sin devolverse al cliente.`,
  retiro: "Cambios que el cadete todavía no retiró al comprador. No suman en “En la calle” hasta que se retiran.",
  devuelto: "Ya figuran “Devuelto al cliente” en LightData (por remito firmado o cargado a mano). Caso cerrado.",
  marcados: "Tienen etiqueta: reclamado al cadete, extraviado o descartado. Extraviados y descartados no suman en los totales.",
};
const COL_FECHA = { calle: "Cancelados: cuándo se cancelaron. Cambios: cuándo se retiró el producto al comprador.", deposito: "Cuándo ingresó al depósito.", retiro: "Cuándo se cargó el cambio en LightData.", devuelto: "Cuándo se devolvió al cliente.", marcados: "La fecha de la etapa en la que está cada envío." };
const NOMBRE_ETAPA = { calle: "En la calle", deposito: "En depósito", retiro: "Cambios por retirar", devuelto: "Devueltos al cliente", marcados: "Etiquetados" };
const TIPOS = [["todos", "Todo"], ["CANCELADO", "Cancelados"], ["CAMBIO", "Cambios"]];

export default function Devoluciones({ abrirEnvio = null }) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("seguimiento");
  const [etapa, setEtapa] = useState("calle");
  const [tipo, setTipo] = useState("todos");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [busca, setBusca] = useState("");
  const [fCadete, setFCadete] = useState(null); // filtro por cadete (tocando su nombre en la lista); la búsqueda corre dentro
  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [orden, setOrden] = useState({ col: "auto", dir: -1 });
  const [soloSel, setSoloSel] = useState(false);
  const [abierto, setAbierto] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [armando, setArmando] = useState(null); // { libres, previa, yaEnRemito }
  const [escIngreso, setEscIngreso] = useState(false);
  const [verListos, setVerListos] = useState(false);
  const esCelu = useEsCelu();
  const [pedidoEscaner, setPedidoEscaner] = useState(0); // celu: abrir el escáner de remitos desde arriba
  const [verReclamos, setVerReclamos] = useState(false);
  const enCurso = useRef(false);

  const cargar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      const hace21 = new Date(Date.now() - 21 * 864e5).toISOString();
      const [dev, gest, rem, sync, diario, eventos, fallidos] = await Promise.all([
        traerTodo("devoluciones?select=*&order=did"),
        traerTodo("devoluciones_gestion?select=*"),
        sbFetch("remitos_devolucion?select=*&order=id.desc&limit=300"),
        sbFetch("devoluciones_sync?select=*&id=eq.1"),
        sbFetch("devoluciones_diario?select=*&order=fecha.desc&limit=60").catch(() => []),
        sbFetch(`devoluciones_eventos?select=*&at=gte.${hace21}&order=at.desc&limit=2000`).catch(() => []),
        sbFetch("remitos_fallidos?estado=eq.pendiente&select=*&order=at.desc&limit=100").catch(() => []),
      ]);
      setDatos({ dev, gest, rem, sync: sync[0] || null, diario, eventos, fallidos });
      setError(null);
    } catch (e) { setError(String(e.message || e).slice(0, 200)); }
    finally { enCurso.current = false; }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    const vis = () => { if (document.visibilityState === "visible") cargar(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [cargar]);

  // Mientras haya un remito procesándose, mirar más seguido
  const hayProcesando = !!datos && datos.rem.some((r) => r.estado === "procesando");
  useEffect(() => {
    if (!hayProcesando) return;
    const t = setInterval(cargar, 20000);
    return () => clearInterval(t);
  }, [hayProcesando, cargar]);

  const casos = useMemo(() => (datos ? armarCasos(datos.dev, datos.gest) : []), [datos]);
  const r = useMemo(() => resumen(casos), [casos]);
  const remitoDe = useMemo(() => {
    const m = new Map();
    (datos ? datos.rem : []).filter((x) => ["emitido", "por_confirmar", "procesando", "error"].includes(x.estado))
      .forEach((x) => (x.dids || []).forEach((d) => m.set(Number(d), x)));
    return m;
  }, [datos]);

  const lista = useMemo(() => {
    const q = busca.trim();
    return casos.filter((c) => {
      if (fCadete && (c.cadete || "") !== fCadete) return false;
      if (etapa === "marcados" ? !c.marca : c.etapa !== etapa || (c.cerrado && etapa !== "devuelto")) return false;
      if (tipo !== "todos" && c.tipo !== tipo) return false;
      if (soloSel) return sel.has(c.did);
      if (soloVencidos && !c.vencido) return false;
      if (fDesde || fHasta) {
        const d = diaAR(c.desde);
        if (!d || (fDesde && d < fDesde) || (fHasta && d > fHasta)) return false;
      }
      return !q || coincideBusqueda(c, q);
    }).sort(orden.col === "auto" ? ordenar : (a, b) => {
      const k = { fecha: (x) => x.desde || "", valor: (x) => Number(x.valor) || 0, dias: (x) => x.dias ?? -1, cliente: (x) => (x.cliente || "").toLowerCase(), cadete: (x) => (x.cadete || "").toLowerCase() }[orden.col];
      const va = k(a), vb = k(b);
      return (va < vb ? -1 : va > vb ? 1 : 0) * orden.dir;
    });
  }, [casos, etapa, tipo, soloVencidos, busca, fCadete, fDesde, fHasta, orden, soloSel, sel]);

  const abrirAlLlegar = useRef(null);
  useEffect(() => { setSel(new Set()); setSoloSel(false); setAbierto(abrirAlLlegar.current); abrirAlLlegar.current = null; }, [etapa, tab]);

  // Llegada desde Buscar envío: abrir ese envío en su etapa
  useEffect(() => {
    if (!casos.length) return;
    let did = null;
    try { did = sessionStorage.getItem("fx_dev_buscar"); sessionStorage.removeItem("fx_dev_buscar"); } catch {}
    const c = did && casos.find((x) => String(x.did) === String(did));
    if (!c) return;
    setTab("seguimiento"); setTipo("todos"); setSoloVencidos(false); setFDesde(""); setFHasta("");
    const nueva = c.cerrado && c.etapa !== "devuelto" ? "marcados" : c.etapa;
    setBusca(String(c.did));
    if (nueva === etapa) setAbierto(c.did); else { abrirAlLlegar.current = c.did; setEtapa(nueva); }
  }, [casos]); // eslint-disable-line react-hooks/exhaustive-deps
  const toast = (t) => { setAviso(t); setTimeout(() => setAviso((a) => (a === t ? null : a)), 4500); };

  const irA = (e, vencidos = false) => { setTab("seguimiento"); setEtapa(e); setSoloVencidos(vencidos); };
  // La selección sobrevive a la búsqueda: se arma el remito buscando envío por envío
  const seleccionados = casos.filter((c) => sel.has(c.did));

  async function marcarIngreso(cs, deshacer = false) {
    setOcupado(true);
    try {
      await guardarGestion(cs.map((c) => ({ did: c.did, ingreso_deposito_at: deshacer ? null : new Date().toISOString(), ingreso_por: deshacer ? null : yo() })));
      if (!deshacer) registrar("ingreso", cs.length, null, { dids: cs.map((c) => c.did) });
      toast(deshacer ? "Volvió a “en la calle”" : `${cs.length} envío${cs.length > 1 ? "s" : ""} pasado${cs.length > 1 ? "s" : ""} a depósito`);
      setSel(new Set()); await cargar();
    } catch (e) { toast("No se pudo guardar: " + String(e.message).slice(0, 80)); }
    setOcupado(false);
  }
  async function ingresoEscaneado(c) {
    try {
      await guardarGestion([{ did: c.did, ingreso_deposito_at: new Date().toISOString(), ingreso_por: yo() }]);
      registrar("ingreso", 1, null, { dids: [c.did], via: "escaner" });
      return true;
    } catch { return false; }
  }
  async function etiquetar(cs, marca, nota) {
    setOcupado(true);
    try {
      await guardarGestion(cs.map((c) => ({ did: c.did, marca: marca || null, marca_nota: marca ? nota || null : null, marca_por: marca ? yo() : null, marca_at: marca ? new Date().toISOString() : null })));
      if (marca) registrar("etiqueta", cs.length, null, { marca, dids: cs.map((c) => c.did) });
      toast(marca ? `Etiquetado: ${MARCAS[marca]}` : "Etiqueta quitada");
      setSel(new Set()); await cargar();
    } catch (e) { toast("No se pudo guardar: " + String(e.message).slice(0, 80)); }
    setOcupado(false);
  }
  // Copia el mensaje para WhatsApp y deja registro: último reclamo + etiqueta "Reclamado" (si no tenía otra)
  async function reclamar(cadete, cs, via = "copiar") {
    const texto = mensajeReclamo(cadete, cs);
    if (via === "wa") window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, "_blank", "noopener"); // en el clic, si no el navegador la bloquea
    else {
      try { await navigator.clipboard.writeText(texto); }
      catch { const t = document.createElement("textarea"); t.value = texto; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
    }
    const ahora = new Date().toISOString();
    try {
      await guardarGestion(cs.map((c) => ({
        did: c.did, reclamo_at: ahora, reclamo_por: yo(),
        marca: c.marca || "reclamado", marca_por: c.marca ? c.marca_por || null : yo(), marca_at: c.marca ? c.marca_at : ahora, marca_nota: c.marca_nota || null,
      })));
      registrar("reclamo", cs.length, cadete, { dids: cs.map((c) => c.did) });
      await cargar();
    } catch { /* el mensaje ya se copió; el registro se reintenta la próxima vez */ }
    toast(via === "wa" ? `Reclamo a ${cadete.split(" ")[0]} registrado` : `Mensaje copiado. Pegalo en el WhatsApp de ${cadete.split(" ")[0]}.`);
  }
  function armarRemitos(cs) {
    const libres = cs.filter((c) => !remitoDe.has(c.did));
    if (!libres.length) { toast("Esos envíos ya están en un remito abierto"); return; }
    setArmando({ libres, previa: agruparParaRemitos(libres), yaEnRemito: cs.length - libres.length });
  }
  async function confirmarArmado(chofer) {
    const { libres } = armando;
    setArmando(null);
    // La ventana se abre YA, en el clic: si se abre después de guardar, el navegador la bloquea
    const w = window.open("", "_blank");
    if (w) w.document.write("<p style='font-family:sans-serif;padding:24px'>Armando remito…</p>");
    setOcupado(true);
    try {
      const grupos = agruparParaRemitos(libres);
      const creados = [];
      for (const g of grupos) {
        const [row] = await sbFetch("remitos_devolucion", { method: "POST", body: JSON.stringify({ cliente: g.cliente, dids: g.casos.map((c) => c.did), creado_por: yo(), chofer: chofer || null }) });
        creados.push({ ...row, casos: g.casos });
      }
      registrar("remito_armado", creados.length, null, { codigos: creados.map((x) => x.codigo), envios: libres.length, chofer: chofer || null });
      await imprimirRemitos(creados, w);
      toast(`${creados.length} remito${creados.length > 1 ? "s" : ""} generado${creados.length > 1 ? "s" : ""} (uno por cliente). También quedan en la pestaña Remitos.`);
      setSel(new Set()); await cargar();
    } catch (e) { if (w) w.close(); toast("No se pudo armar el remito: " + String(e.message).slice(0, 100)); }
    setOcupado(false);
  }
  const choferes = useMemo(() => [...new Set(casos.map((c) => c.cadete).filter((n) => n && !CHOFER_FICTICIO.test(n)))].sort((a, b) => a.localeCompare(b)), [casos]);
  const casosDeRemito = (rem) => { const m = new Map(casos.map((c) => [Number(c.did), c])); return (rem.dids || []).map((d) => m.get(Number(d)) || { did: d }); };

  async function actualizar() {
    const j = await pedirAccion("sync");
    toast(j.ok ? "Pedido enviado: LightData se relee en 1–2 minutos" : j.motivo === "reciente" ? "Ya se pidió hace un momento, esperá un par de minutos" : "No se pudo pedir la actualización");
  }

  if (!datos && !error) return <div style={{ padding: 24, color: C.ink3 }}>Cargando devoluciones…</div>;
  if (!datos && error) return <div style={{ padding: 24, color: C.ink2 }}>No se pudieron leer las devoluciones. {error}</div>;

  const sync = datos.sync || {};
  return (
    <div className="dv-raiz" style={{ display: "flex", flexDirection: "column", gap: 16, color: C.ink, paddingBottom: 24 }}>
      <style>{CSS}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div className="dv-seg">
          <button className={tab === "seguimiento" ? "on" : ""} onClick={() => setTab("seguimiento")}>Seguimiento</button>
          <button className={tab === "remitos" ? "on" : ""} onClick={() => setTab("remitos")}>Remitos{hayProcesando ? " ·" : ""}</button>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: C.ink3 }}>
          <span className="dv-dot" style={{ background: sync.ok === false ? C.ambar : C.teal }} />
          LightData {hace(sync.ultima_at)}{sync.ok === false ? " · falló la última lectura" : ""}
        </span>
        {!esCelu && <button className="dv-btn" onClick={actualizar}>Pedir actualización</button>}
      </div>

      {esCelu && (() => {
        const pc = datos.rem.filter((x) => x.estado === "por_confirmar").length;
        return (
          <div className="dv-celu">
            <button className="dv-celu-btn" onClick={() => setEscIngreso(true)}>
              <IcoScan size={26} /><span><b>Escanear ingreso</b><small>Paquetes que entran al depósito</small></span>
            </button>
            <button className="dv-celu-btn" onClick={() => { setTab("remitos"); setPedidoEscaner((n) => n + 1); }}>
              <IcoCamara size={26} /><span><b>Remitos firmados</b><small>Sacarles foto</small></span>
            </button>
            {pc > 0 && <button className="dv-celu-pc" onClick={() => setTab("remitos")}>{pc} remito{pc > 1 ? "s" : ""} por confirmar →</button>}
          </div>
        );
      })()}

      {!esCelu && <Progreso casos={casos} r={r} diario={datos.diario || []} eventos={datos.eventos || []} remitos={datos.rem}
        onReclamar={() => setVerReclamos(true)} onDevolver={() => irA("deposito", true)} />}

      {/* Celu: resumen compacto (la vista completa es para la compu) */}
      {esCelu ? (tab === "remitos" ? null :
        <div className="dv-celu-stats">
          {[["calle", "En la calle", r.calle, r.calleVencidos, `con +${LIMITE_CALLE} días`], ["deposito", "En depósito", r.deposito, r.depositoVencidos, `con +${LIMITE_DEPOSITO} días`], ["retiro", "Por retirar", r.retiro], ["devuelto", "Devueltos", r.devueltos]].map(([id, n, v, venc, lv]) => (
            <button key={id} className={"dv-celu-stat" + (tab === "seguimiento" && etapa === id ? " on" : "")} onClick={() => irA(id)}>
              <span>{n}</span><b>{num(v)}</b>{venc ? <small>{num(venc)} {lv}</small> : null}
            </button>
          ))}
        </div>
      ) : (
      <div className="dv-etapas">
        <EtapaCard titulo="En la calle" ayuda={AYUDA.calle} valor={r.calle} sub={`${plata(r.calleValor)} declarado`}
          activo={tab === "seguimiento" && etapa === "calle"} venc={soloVencidos}
          vencidos={r.calleVencidos} limite={LIMITE_CALLE} ayudaVenc={AYUDA.calleVenc}
          onElegir={(v) => irA("calle", v)} />
        <EtapaCard titulo="En depósito" ayuda={AYUDA.deposito} valor={r.deposito} sub={`${plata(r.depositoValor)} declarado · falta devolver al cliente`}
          activo={tab === "seguimiento" && etapa === "deposito"} venc={soloVencidos}
          vencidos={r.depositoVencidos} limite={LIMITE_DEPOSITO} ayudaVenc={AYUDA.depositoVenc}
          onElegir={(v) => irA("deposito", v)} />
        <div className="dv-otros" style={card}>
          {[["retiro", r.retiro], ["devuelto", r.devueltos], ["marcados", r.marcados]].map(([id, n]) => (
            <button key={id} className={"dv-otro" + (tab === "seguimiento" && etapa === id ? " on" : "")} onClick={() => irA(id)}>
              <span>{NOMBRE_ETAPA[id]}</span><Info texto={AYUDA[id]} /><span style={{ flex: 1 }} /><b>{num(n)}</b>
            </button>
          ))}
        </div>
      </div>)}

      {tab === "seguimiento" ? (
        <>
          <div className="dv-barra-filtros">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {NOMBRE_ETAPA[etapa]}{soloVencidos && (etapa === "calle" || etapa === "deposito") ? ` · más de ${etapa === "calle" ? LIMITE_CALLE : LIMITE_DEPOSITO} días` : ""}
                {tipo !== "todos" ? ` · ${tipo === "CAMBIO" ? "solo cambios" : "solo cancelados"}` : ""}
                <span style={{ color: C.ink3, fontWeight: 400 }}> — {num(lista.length)} envío{lista.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
            <div style={{ flex: 1 }} />
            <div className="dv-seg sm" title="Tipo de devolución">
              {TIPOS.map(([id, lbl]) => <button key={id} className={tipo === id ? "on" : ""} onClick={() => setTipo(id)}>{lbl}</button>)}
            </div>
            {fCadete && <button className="dv-chip-f" onClick={() => setFCadete(null)} title="Sacar el filtro de cadete">{fCadete} <span aria-hidden="true">✕</span></button>}
            <input className="dv-input" style={{ flex: "0 1 300px" }} placeholder={fCadete ? `Buscar entre los de ${fCadete.split(" ")[0]}: calle, cliente, venta…` : "Buscar dirección, cliente, venta o cadete"} value={busca} onChange={(e) => setBusca(e.target.value)} />
            {!esCelu && <FiltroFecha desde={fDesde} hasta={fHasta} onCambiar={(d, h) => { setFDesde(d); setFHasta(h); }} ayuda={COL_FECHA[etapa]} />}
            {!esCelu && (etapa === "calle" || etapa === "retiro" || etapa === "deposito") && <button className="dv-btn" onClick={() => setEscIngreso(true)} title="Escaneá la etiqueta de cada paquete que entra: pasa a depósito solo">Escanear ingreso</button>}
            {etapa === "deposito" && <button className="dv-btn pri" onClick={() => setVerListos(true)} title="La app arma los remitos de lo que está en depósito, por seller">Listos para devolver</button>}
            {etapa === "calle" && <button className="dv-btn pri" onClick={() => setVerReclamos(true)}>Reclamar a cadetes</button>}
          </div>

          <div style={{ ...card, overflow: "hidden" }}>
            <div className="dv-head">
              <label className="dv-cb"><input type="checkbox" title="Seleccionar los que se ven" checked={lista.length > 0 && lista.every((c) => sel.has(c.did))} onChange={(e) => setSel((s0) => { const n = new Set(s0); lista.forEach((c) => (e.target.checked ? n.add(c.did) : n.delete(c.did))); return n; })} /></label>
              <Orden col="cliente" orden={orden} set={setOrden}>Envío</Orden>
              <Orden col="cadete" orden={orden} set={setOrden} className="dv-hide-m">Cadete</Orden>
              <span className="dv-hide-m" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Orden col="fecha" orden={orden} set={setOrden}>Fecha</Orden><Info texto={COL_FECHA[etapa]} abajo /></span>
              <Orden col="valor" orden={orden} set={setOrden} className="dv-r">Valor</Orden>
              <Orden col="dias" orden={orden} set={setOrden} className="dv-r">Días</Orden>
            </div>
            {lista.length === 0 && <div style={{ padding: 28, textAlign: "center", color: C.ink3, fontSize: 14 }}>Nada en esta vista.</div>}
            {lista.slice(0, 400).map((c) => (
              <Fila key={c.did} c={c} remito={remitoDe.get(c.did)} abierto={abierto === c.did} marcado={sel.has(c.did)}
                onToggle={() => setAbierto(abierto === c.did ? null : c.did)}
                onSel={(v) => setSel((s) => { const n = new Set(s); v ? n.add(c.did) : n.delete(c.did); return n; })}
                onCadete={(n) => { setFCadete(n); setBusca(""); }} onIngreso={(deshacer) => marcarIngreso([c], deshacer)} onEtiqueta={(m, nota) => etiquetar([c], m, nota)} ocupado={ocupado}
                onReclamar={() => reclamar(c.cadete, [c])} onVerEnvio={abrirEnvio ? () => abrirEnvio(c.did) : null} />
            ))}
            {lista.length > 400 && <div style={{ padding: 12, textAlign: "center", color: C.ink3, fontSize: 12 }}>Mostrando 400 de {num(lista.length)}. Usá el buscador para acotar.</div>}
          </div>

          {seleccionados.length > 0 && (
            <div className="dv-barra">
              <span><b>{seleccionados.length}</b> seleccionado{seleccionados.length > 1 ? "s" : ""}</span>
              <button className={"dv-btn" + (soloSel ? " on" : "")} onClick={() => setSoloSel(!soloSel)} title="Mostrar solo lo seleccionado">{soloSel ? "Ver todos" : "Ver seleccionados"}</button>
              <div style={{ flex: 1 }} />
              {seleccionados.some((c) => c.etapa === "deposito") && <button className="dv-btn pri" disabled={ocupado} onClick={() => armarRemitos(seleccionados.filter((c) => c.etapa === "deposito"))}>Armar remito</button>}
              {seleccionados.some((c) => (c.etapa === "calle" || c.etapa === "retiro") && !c.ingreso_deposito_at) && (
                <button className="dv-btn pri" disabled={ocupado} onClick={() => marcarIngreso(seleccionados.filter((c) => (c.etapa === "calle" || c.etapa === "retiro") && !c.ingreso_deposito_at))}>Pasar a depósito</button>
              )}
              <EtiquetaMenu onElegir={(m) => etiquetar(seleccionados, m)} disabled={ocupado} />
              <button className="dv-btn" onClick={() => { setSel(new Set()); setSoloSel(false); }}>Cancelar</button>
            </div>
          )}
        </>
      ) : (
        <Remitos remitos={datos.rem} fallidos={datos.fallidos || []} casosDe={casosDeRemito} recargar={cargar} toast={toast} pedidoEscaner={pedidoEscaner} esCelu={esCelu} />
      )}

      {escIngreso && <IngresoEscaner casos={casos} onIngresar={ingresoEscaneado} onCerrar={() => { setEscIngreso(false); cargar(); }} />}
      {verListos && <ListosModal grupos={listosParaDevolver(casos, new Set(remitoDe.keys()))} onCerrar={() => setVerListos(false)} onArmar={(cs) => { setVerListos(false); armarRemitos(cs); }} />}
      {armando && <ArmarRemitoModal previa={armando.previa} yaEnRemito={armando.yaEnRemito} choferes={choferes} onConfirmar={confirmarArmado} onCerrar={() => setArmando(null)} />}
      {verReclamos && <ReclamosModal grupos={reclamosPorCadete(casos)} trajo={trajoPorCadete(casos)} onEnviar={reclamar} onCerrar={() => setVerReclamos(false)} />}
      {aviso && <div className="dv-toast">{aviso}</div>}
    </div>
  );
}

const hoyAR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const sumarDias = (d, n) => new Date(Date.parse(d + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const ddmmDe = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
function rangosRapidos() {
  const h = hoyAR(), mes = h.slice(0, 8) + "01";
  const finMesPasado = sumarDias(mes, -1), iniMesPasado = finMesPasado.slice(0, 8) + "01";
  return [
    ["Hoy", h, h], ["Últimos 7 días", sumarDias(h, -6), h], ["Últimos 15 días", sumarDias(h, -14), h],
    ["Este mes", mes, h], ["Mes pasado", iniMesPasado, finMesPasado],
  ];
}

// Un solo botón; las opciones se abren al tocarlo (nada de campos de fecha sueltos en la barra)
function FiltroFecha({ desde, hasta, onCambiar, ayuda }) {
  const [abierto, setAbierto] = useState(false);
  const [d, setD] = useState(desde), [h, setH] = useState(hasta);
  const ref = useRef();
  useEffect(() => {
    if (!abierto) return;
    setD(desde); setH(hasta);
    const fuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto, desde, hasta]);
  const rapidos = rangosRapidos();
  const elegido = rapidos.find(([, a, b]) => a === desde && b === hasta);
  const etiqueta = !desde && !hasta ? "Todas" : elegido ? elegido[0] : `${desde ? ddmmDe(desde) : "…"} – ${hasta ? ddmmDe(hasta) : "hoy"}`;
  const activo = !!(desde || hasta);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className={"dv-btn" + (activo ? " on" : "")} onClick={() => setAbierto(!abierto)} style={activo ? { borderColor: "rgba(46,230,182,.35)", color: C.teal } : null}>
        Fecha: {etiqueta} <span style={{ opacity: .6, marginLeft: 2 }}>▾</span>
      </button>
      {abierto && (
        <div className="dv-pop">
          <div style={{ fontSize: 11.5, color: C.ink3, padding: "4px 8px 8px", lineHeight: 1.4 }}>{ayuda}</div>
          <button className={!activo ? "on" : ""} onClick={() => { onCambiar("", ""); setAbierto(false); }}>Todas las fechas</button>
          {rapidos.map(([lbl, a, b]) => (
            <button key={lbl} className={elegido && elegido[0] === lbl ? "on" : ""} onClick={() => { onCambiar(a, b); setAbierto(false); }}>{lbl}</button>
          ))}
          <div className="dv-pop-rango">
            <div style={{ fontSize: 11.5, color: C.ink3, marginBottom: 6 }}>Personalizado</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="date" value={d} max={h || undefined} onChange={(e) => setD(e.target.value)} aria-label="Desde" />
              <span style={{ color: C.ink3, fontSize: 12 }}>a</span>
              <input type="date" value={h} min={d || undefined} onChange={(e) => setH(e.target.value)} aria-label="Hasta" />
            </div>
            <button className="dv-btn pri" style={{ marginTop: 8, width: "100%" }} disabled={!d && !h} onClick={() => { onCambiar(d, h); setAbierto(false); }}>Aplicar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Orden({ col, orden, set, className = "", children }) {
  const on = orden.col === col;
  return (
    <button className={"dv-ord " + className + (on ? " on" : "")} title="Ordenar"
      onClick={() => set(on ? (orden.dir === -1 ? { col, dir: 1 } : { col: "auto", dir: -1 }) : { col, dir: col === "cliente" || col === "cadete" ? 1 : -1 })}>
      {children}{on ? (orden.dir === 1 ? " ↑" : " ↓") : ""}
    </button>
  );
}

function Info({ texto, abajo = false }) {
  // Ayuda al pasar el mouse o al tocar: flota encima, no mueve nada de lugar
  return (
    <span className={"dv-info" + (abajo ? " abajo" : "")} tabIndex={0} role="note" aria-label={texto} onClick={(e) => e.stopPropagation()}>
      i<span className="dv-tip">{texto}</span>
    </span>
  );
}

function EtapaCard({ titulo, ayuda, valor, sub, activo, venc, vencidos, limite, ayudaVenc, onElegir }) {
  return (
    <div className={"dv-etapa" + (activo ? " on" : "")} style={card} role="button" tabIndex={0}
      onClick={() => onElegir(false)} onKeyDown={(e) => { if (e.key === "Enter") onElegir(false); }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13, color: activo ? C.ink : C.ink2, fontWeight: 600 }}>{titulo}</span>
        <Info texto={ayuda} />
        <span style={{ flex: 1 }} />
      </div>
      <div style={{ fontFamily: C.grotesk, fontSize: 34, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 6, lineHeight: 1 }}>{num(valor)}</div>
      <div style={{ fontSize: 12, color: C.ink3, marginTop: 6 }}>{sub}</div>
      <div className="dv-etapa-sub" onClick={(e) => e.stopPropagation()}>
        <button className={activo && !venc ? "on" : ""} onClick={() => onElegir(false)}>Todos <b>{num(valor)}</b></button>
        <button className={"v" + (activo && venc ? " on" : "")} onClick={() => onElegir(true)}>
          {vencidos > 0 && <span className="dv-dot" style={{ background: C.ambar, margin: 0 }} />}Más de {limite} días <b>{num(vencidos)}</b>
        </button>
        <Info texto={ayudaVenc} />
      </div>
    </div>
  );
}

function Fila({ c, remito, abierto, marcado, onToggle, onSel, onCadete, onIngreso, onEtiqueta, onReclamar, onVerEnvio, ocupado }) {
  const [nota, setNota] = useState(c.marca_nota || "");
  useEffect(() => { setNota(c.marca_nota || ""); }, [c.marca_nota]);
  return (
    <div className={"dv-fila" + (abierto ? " ab" : "")}>
      <div className="dv-linea" onClick={onToggle}>
        <label className="dv-cb" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={marcado} onChange={(e) => onSel(e.target.checked)} /></label>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{c.cliente || "Sin cliente"}</span>
            <span className="dv-tag">{c.tipo === "CAMBIO" ? "Cambio" : "Cancelado"}</span>
            {c.marca && <span className="dv-tag mk">{MARCAS[c.marca]}</span>}
            {remito && <span className="dv-tag">{remito.codigo}</span>}
          </div>
          <div style={{ fontSize: 13, color: C.ink2, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.direccion ? <>{c.direccion}{c.localidad ? <span style={{ color: C.ink3 }}>, {c.localidad}</span> : null}</> : <span style={{ color: C.ink3 }}>Sin dirección</span>}
          </div>
          <div style={{ fontSize: 11.5, color: C.ink3, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.ml_venta_id ? `Venta ${c.ml_venta_id}` : `Tracking ${c.tracking || "—"}`} · #{c.did}<span className="dv-show-m"> · {c.cadete || "—"}</span>
          </div>
        </div>
        <span className="dv-hide-m" style={{ minWidth: 0, overflow: "hidden" }}>
          {c.cadete && !CHOFER_FICTICIO.test(c.cadete)
            ? <button className="dv-cadete-link" onClick={(e) => { e.stopPropagation(); onCadete(c.cadete); }} title={`Ver solo los de ${c.cadete}`}>{c.cadete}</button>
            : <span style={{ fontSize: 13, color: C.ink2 }}>{c.cadete || "—"}</span>}
        </span>
        <span className="dv-hide-m" style={{ fontSize: 13, color: C.ink2, fontVariantNumeric: "tabular-nums" }}>{fechaCorta(c.desde)}</span>
        <span className="dv-r" style={{ fontSize: 13, color: C.ink2 }}>{plata(c.valor)}</span>
        <span className="dv-r" style={{ fontFamily: C.grotesk, fontWeight: 700, fontSize: 15, color: c.vencido ? C.ambar : C.ink }}>{c.dias ?? "—"}</span>
      </div>
      {abierto && (
        <div className="dv-det">
          <div className="dv-grid">
            <Dato k="Cargado en LightData" v={fecha(c.fecha_alta)} />
            {c.tipo === "CANCELADO" ? <Dato k="Cancelado" v={fecha(c.fecha_cancelado)} /> : <Dato k="Retirado al comprador" v={fecha(c.fecha_retiro)} />}
            <Dato k="Ingresó a depósito" v={c.ingreso_deposito_at ? `${fecha(c.ingreso_deposito_at)} · ${c.ingreso_por}` : fecha(c.fecha_deposito)} />
            <Dato k="Devuelto al cliente" v={fecha(c.fecha_devuelto_cliente || c.fecha_dev_ld)} />
            <Dato k="Tracking" v={c.tracking || "—"} />
            <Dato k="Dirección" v={[c.direccion, c.localidad].filter(Boolean).join(", ") || `CP ${c.cp || "—"}`} />
            <Dato k="Último reclamo" v={c.reclamo_at ? fecha(c.reclamo_at) : "—"} />
          </div>
          {c.tipo === "CAMBIO" && c.li_texto && <div style={{ fontSize: 13, color: C.ink2, marginTop: 10 }}>Logística inversa: “{c.li_texto}”</div>}
          {c.marca && <div style={{ fontSize: 13, color: C.ink2, marginTop: 8 }}>Etiqueta: <b>{MARCAS[c.marca]}</b>{c.marca_por ? ` · ${c.marca_por}` : ""}{c.marca_nota ? ` — ${c.marca_nota}` : ""}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
            {onVerEnvio && <button className="dv-btn" onClick={onVerEnvio}>Ver envío e historial</button>}
            {c.etapa === "calle" && c.cadete && !CHOFER_FICTICIO.test(c.cadete) && <button className="dv-btn" disabled={ocupado} onClick={onReclamar}>Copiar reclamo</button>}
            {c.etapa === "deposito" && c.ingreso_deposito_at && !c.en_deposito_ld && <button className="dv-btn" disabled={ocupado} onClick={() => onIngreso(true)}>Volver a “en la calle”</button>}
            {(c.etapa === "calle" || c.etapa === "retiro") && <button className="dv-btn pri" disabled={ocupado} onClick={() => onIngreso(false)}>Pasar a depósito</button>}
            <input className="dv-input" style={{ flex: "1 1 180px" }} placeholder="Nota (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} />
            {Object.entries(MARCAS).map(([k, lbl]) => (
              <button key={k} className={"dv-btn" + (c.marca === k ? " on" : "")} disabled={ocupado} onClick={() => onEtiqueta(c.marca === k ? null : k, nota)}>{c.marca === k ? `Quitar “${lbl}”` : lbl}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
const Dato = ({ k, v }) => <div><div style={{ fontSize: 11, color: C.ink3 }}>{k}</div><div style={{ fontSize: 13, marginTop: 2 }}>{v}</div></div>;

function EtiquetaMenu({ onElegir, disabled }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <button className="dv-btn" disabled={disabled} onClick={() => setAbierto(!abierto)}>Etiquetar</button>
      {abierto && (
        <div className="dv-menu">
          {Object.entries(MARCAS).map(([k, lbl]) => <button key={k} onClick={() => { setAbierto(false); onElegir(k); }}>{lbl}</button>)}
          <button onClick={() => { setAbierto(false); onElegir(null); }}>Quitar etiqueta</button>
        </div>
      )}
    </div>
  );
}

// ---------------- Progreso: meta de hoy + racha · plata parada · semana ----------------
const millones = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1).replace(".", ",")} M` : plata(n));
function Barra({ n, de, ok }) {
  const pct = de > 0 ? Math.min(100, Math.round((n / de) * 100)) : 100;
  return <div className="dv-bar"><div style={{ width: `${pct}%`, background: ok ? C.teal : "rgba(46,230,182,.55)" }} /></div>;
}
function Llama({ on }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={on ? C.ambar : C.ink3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}
const flecha = (a, b) => (a > b ? <span style={{ color: C.teal }}>↑ {num(a - b)}</span> : a < b ? <span style={{ color: C.ink3 }}>↓ {num(b - a)}</span> : <span style={{ color: C.ink3 }}>=</span>);

function Progreso({ casos, r, diario, eventos, remitos, onReclamar, onDevolver }) {
  const [abierto, setAbierto] = useState(() => { try { return localStorage.getItem("fx_dev_prog_abierto") === "1"; } catch { return false; } });
  const alternar = () => setAbierto((v) => { try { localStorage.setItem("fx_dev_prog_abierto", v ? "0" : "1"); } catch {} return !v; });
  const p = progresoDelDia(casos);
  const filaHoy = diario.find((d) => String(d.fecha).slice(0, 10) === p.hoy);
  const meta = filaHoy && filaHoy.meta_devolver != null ? filaHoy.meta_devolver : metaDevolver(r.depositoVencidos);
  const cumplida = metaCumplida(p, meta);
  const dias = racha(diario, cumplida);
  const okReclamo = p.cadetesReclamados >= p.cadetesAReclamar;
  const okDevolver = p.devueltos >= meta;

  // Semana actual vs anterior
  const ini = inicioSemana(p.hoy);
  const iniAnt = new Date(Date.parse(ini + "T12:00:00Z") - 7 * 864e5).toISOString().slice(0, 10);
  const enSem = (f, a, b) => { const d = diaAR(f); return !!d && d >= a && (!b || d < b); };
  const sem = (a, b) => ({
    devueltos: casos.filter((c) => c.etapa === "devuelto" && enSem(c.fecha_devuelto_cliente || c.fecha_dev_ld, a, b)),
    ingresos: casos.filter((c) => c.tipo === "CAMBIO" && enSem(c.ingreso_deposito_at, a, b)).length,
    reclamos: eventos.filter((e) => e.tipo === "reclamo" && enSem(e.at, a, b)).length,
    remitos: remitos.filter((x) => x.firmado_at && enSem(x.firmado_at, a, b)).length,
  });
  const esta = sem(ini, null), ant = sem(iniAnt, ini);
  const recuperado = esta.devueltos.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  const faltan = [!okReclamo && `faltan ${p.cadetesAReclamar - p.cadetesReclamados} cadete${p.cadetesAReclamar - p.cadetesReclamados > 1 ? "s" : ""} por reclamar`,
    !okDevolver && `faltan ${meta - p.devueltos} envío${meta - p.devueltos > 1 ? "s" : ""} por devolver`].filter(Boolean).join(" · ");

  return (
    <div className={"dv-franja" + (cumplida ? " ok" : "")}>
      <button className="dv-franja-linea" onClick={alternar} aria-expanded={abierto}>
        <b style={{ color: C.ink }}>Meta de hoy</b>
        <span className="dv-fr-item">Reclamos <b className={okReclamo ? "ok" : ""}>{p.cadetesAReclamar ? `${p.cadetesReclamados}/${p.cadetesAReclamar}` : "—"}{okReclamo ? " ✓" : ""}</b>
          <span className="dv-mini"><span style={{ width: `${p.cadetesAReclamar ? Math.min(100, (p.cadetesReclamados / p.cadetesAReclamar) * 100) : 100}%` }} /></span></span>
        <span className="dv-fr-item">Devolver al cliente <b className={okDevolver ? "ok" : ""}>{okDevolver ? `${p.devueltos} ✓` : `${p.devueltos}/${meta}`}</b>{okDevolver && <span style={{ color: C.ink3 }}>(meta {meta})</span>}</span>
        <span className="dv-fr-sep">·</span>
        <span className="dv-fr-item"><Llama on={dias > 0} /> Racha <b>{dias} día{dias !== 1 ? "s" : ""}</b></span>
        <span className="dv-fr-sep dv-fr-semana">·</span>
        <span className="dv-fr-item dv-fr-semana">Semana: <b>{num(esta.devueltos.length)} devueltos</b> {flecha(esta.devueltos.length, ant.devueltos.length)}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: C.teal, whiteSpace: "nowrap" }}>{abierto ? "Ocultar ▴" : "Ver detalle ▾"}</span>
      </button>

      {abierto && (
        <div className="dv-franja-det">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>Meta de hoy</span>
              <Info texto={`Dos cosas por día: reclamarle a cada cadete que tiene paquetes con más de ${LIMITE_CALLE} días en la calle, y devolver al cliente ${meta} envíos (la meta sale de lo vencido en depósito y queda fija en el día). Cumplir las dos suma un día a la racha. Los domingos no cuentan.`} />
            </div>
            <button className="dv-meta" onClick={onReclamar}>
              <div className="dv-meta-t"><span>Reclamar a cadetes con +{LIMITE_CALLE} días</span><b>{p.cadetesAReclamar ? `${p.cadetesReclamados}/${p.cadetesAReclamar}` : "—"}</b></div>
              <Barra n={p.cadetesReclamados} de={p.cadetesAReclamar} ok={okReclamo} />
            </button>
            <button className="dv-meta" onClick={onDevolver}>
              <div className="dv-meta-t"><span>Devolver al cliente</span><b>{okDevolver ? `${p.devueltos} ✓ (meta ${meta})` : `${p.devueltos}/${meta}`}</b></div>
              <Barra n={p.devueltos} de={meta} ok={okDevolver} />
            </button>
            <div style={{ fontSize: 12, marginTop: 8, color: cumplida ? C.teal : C.ink3 }}>
              {cumplida ? "¡Meta cumplida! Mañana sigue la racha." : faltan.replace(/^./, (x) => x.toUpperCase())}
            </div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>Esta semana</span>
              <Info texto="Lo que se hizo de lunes a hoy, comparado con la semana pasada completa." />
            </div>
            <div className="dv-sem">
              <div><span>Devueltos al cliente</span><b>{num(esta.devueltos.length)}</b>{flecha(esta.devueltos.length, ant.devueltos.length)}</div>
              <div><span>Plata recuperada</span><b>{millones(recuperado)}</b><span /></div>
              <div><span>Remitos firmados</span><b>{num(esta.remitos)}</b>{flecha(esta.remitos, ant.remitos)}</div>
              <div><span>Cambios ingresados</span><b>{num(esta.ingresos)}</b>{flecha(esta.ingresos, ant.ingresos)}</div>
              <div><span>Reclamos enviados</span><b>{num(esta.reclamos)}</b>{flecha(esta.reclamos, ant.reclamos)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReclamosModal({ grupos, trajo, onEnviar, onCerrar }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [abierto, setAbierto] = useState(null);
  const [enviados, setEnviados] = useState(() => new Map());
  const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const reales = grupos.filter((g) => g.cadete).map((g) => {
    const ult = g.casos.map((c) => c.reclamo_at).filter(Boolean).sort().pop() || null;
    return {
      ...g, ultimo: ult, hoy: diaAR(ult) === hoy,
      canc: g.casos.filter((c) => c.tipo === "CANCELADO").length,
      camb: g.casos.filter((c) => c.tipo === "CAMBIO").length,
      recl: g.casos.filter((c) => c.reclamo_at || c.marca === "reclamado").length,
      trajo: trajo.get(g.cadete) || 0,
    };
  }).sort((a, b) => b.casos.length - a.casos.length || b.vencidos - a.vencidos || b.valor - a.valor);
  const sinCadete = grupos.find((g) => !g.cadete);
  const q = busca.trim().toLowerCase();
  const lista = reales.filter((g) => (!q || g.cadete.toLowerCase().includes(q))
    && (filtro === "vencidos" ? g.vencidos > 0 : filtro === "pendientes" ? !g.hoy && !enviados.has(g.cadete) : true));
  const tot = reales.reduce((a, g) => ({ p: a.p + g.casos.length, v: a.v + g.valor }), { p: 0, v: 0 });
  const enviar = async (g) => { await onEnviar(g.cadete, g.casos, "copiar"); setEnviados((m) => new Map(m).set(g.cadete, new Date().toISOString())); };

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onCerrar]);

  const Lista = ({ titulo, items }) => items.length ? (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: C.ink3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 4 }}>{titulo} · {items.length}</div>
      {items.map((c) => (
        <div key={c.did} className="dv-rec-item">
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.cliente} · {[c.direccion, c.localidad].filter(Boolean).join(", ") || `CP ${c.cp || "—"}`}</span>
          <span style={{ color: c.vencido ? C.ambar : C.ink2, fontWeight: 600, whiteSpace: "nowrap" }}>{c.dias ?? "—"} d</span>
        </div>
      ))}
    </div>
  ) : null;

  return (
    <div className="dv-modal-fondo" onClick={onCerrar}>
      <div className="dv-modal ancho" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reclamar a cadetes">
        <div className="dv-modal-cab">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.01em" }}>Reclamar a cadetes</div>
              <div style={{ fontSize: 12.5, color: C.ink3, marginTop: 3 }}>{reales.length} cadetes · {num(tot.p)} paquetes en la calle · {plata(tot.v)}</div>
            </div>
            <button className="dv-x" onClick={onCerrar} aria-label="Cerrar">✕</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <input className="dv-input" placeholder="Buscar cadete" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <div className="dv-seg sm">
              {[["todos", "Todos"], ["vencidos", `+${LIMITE_CALLE} días`], ["pendientes", "Sin reclamar hoy"]].map(([id, l]) => (
                <button key={id} className={filtro === id ? "on" : ""} onClick={() => setFiltro(id)}>{l}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="dv-rt dv-rt-head">
          <span>Cadete</span>
          <span className="n">Debe</span><span className="n">Canc.</span><span className="n">Camb.</span>
          <span className="n dv-rt-x" title="Paquetes que ya se le reclamaron">Recl.</span>
          <span className="n dv-rt-x" title="Paquetes que devolvió al depósito desde septiembre">Trajo</span>
          <span className="n">$</span><span />
        </div>
        <div className="dv-modal-cuerpo" style={{ padding: 0 }}>
          {lista.length === 0 && <div style={{ color: C.ink3, fontSize: 14, padding: "24px 18px", textAlign: "center" }}>{reales.length ? "Nadie en este filtro." : "No hay nada en la calle para reclamar."}</div>}
          {lista.map((g) => {
            const env = enviados.get(g.cadete);
            const ab = abierto === g.cadete;
            return (
              <div key={g.cadete} className={"dv-rt-fila" + (env ? " hecho" : "") + (ab ? " ab" : "")}>
                <div className="dv-rt" onClick={() => setAbierto(ab ? null : g.cadete)}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {g.vencidos > 0 && <span className="dv-dot" style={{ background: C.ambar, margin: 0 }} title={`${g.vencidos} con +${LIMITE_CALLE} días`} />}
                      <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.cadete}</span>
                    </span>
                    <span style={{ display: "block", fontSize: 11.5, color: C.ink3, marginTop: 2 }}>
                      {env ? "copiado recién" : g.ultimo ? `reclamado ${hace(g.ultimo)}` : "nunca reclamado"}{g.vencidos ? ` · ${g.vencidos} con +${LIMITE_CALLE} d` : ""}
                    </span>
                  </span>
                  <b className="n" style={{ color: C.ambar }}>{g.casos.length}</b>
                  <span className="n">{g.canc}</span>
                  <span className="n">{g.camb}</span>
                  <span className="n dv-rt-x">{g.recl}</span>
                  <span className="n dv-rt-x" style={{ color: g.trajo ? C.teal : C.ink3 }}>{g.trajo}</span>
                  <span className="n" style={{ color: C.ink2, fontSize: 12.5 }}>{millones(g.valor)}</span>
                  <span className="n" onClick={(e) => e.stopPropagation()}>
                    <button className={"dv-btn" + (env ? "" : " pri")} onClick={() => enviar(g)}>{env ? "Copiado ✓" : "Copiar"}</button>
                  </span>
                </div>
                {ab && (
                  <div style={{ padding: "0 18px 12px" }}>
                    <Lista titulo="Cancelados" items={g.casos.filter((c) => c.tipo === "CANCELADO")} />
                    <Lista titulo="Cambios" items={g.casos.filter((c) => c.tipo === "CAMBIO")} />
                    <pre className="dv-prev">{mensajeReclamo(g.cadete, g.casos)}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="dv-modal-pie">
          “Copiar” deja el mensaje listo para pegar en el WhatsApp del cadete y marca esos paquetes como reclamados. Tocá un cadete para ver el detalle.
          {sinCadete ? ` ${sinCadete.casos.length} paquete(s) sin cadete real (sin asignar, “Repro gramar”, “Desasignado”) no se pueden reclamar: revisalos en LightData.` : ""}
        </div>
      </div>
    </div>
  );
}

// ---------------- Remitos ----------------
const ESTADO_REMITO = { emitido: "Esperando firma", por_confirmar: "Por confirmar", procesando: "Procesando en LightData", devuelto: "Devuelto al cliente", error: "Con error", anulado: "Anulado" };

// ---------------- Archivo de remitos devueltos: cliente → mes → remitos ----------------
// Las carpetas se arman con los datos de cada remito (cliente + mes de la firma): las fotos no se
// mueven ni se duplican en el storage, y un remito nuevo aparece solo en su carpeta.
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const mesDe = (iso) => { const d = diaAR(iso); return d ? d.slice(0, 7) : "sin-fecha"; };
const nombreMes = (k) => (k === "sin-fecha" ? "Sin fecha" : `${MESES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`);
function IconoCarpeta({ abierta }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={abierta ? C.teal : C.ink2} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}
async function firmarFotos(paths) {
  if (!paths.length) return {};
  const r = await authedFetch(`${SUPABASE_URL}/storage/v1/object/sign/remitos-firmados`, { method: "POST", body: JSON.stringify({ expiresIn: 3600, paths }) });
  const j = await r.json().catch(() => []);
  const out = {};
  (Array.isArray(j) ? j : []).forEach((x) => { if (x.signedURL && x.path) out[x.path] = `${SUPABASE_URL}/storage/v1${x.signedURL}`; });
  return out;
}

// Acciones poco frecuentes de un remito devuelto, escondidas en "⋯". Reemplazar la foto pide confirmación primero.
function MasAcciones({ rem, onReemplazar, subiendo, onImprimir }) {
  const [menu, setMenu] = useState(null); // posición en pantalla del menú abierto (fixed: no lo recorta ninguna tarjeta)
  const [confirma, setConfirma] = useState(false);
  const input = useRef();
  const caja = useRef();
  const pop = useRef();
  useEffect(() => {
    if (!menu) return;
    const fuera = (e) => { if (caja.current && !caja.current.contains(e.target) && !(pop.current && pop.current.contains(e.target))) setMenu(null); };
    const cerrar = () => setMenu(null);
    document.addEventListener("mousedown", fuera);
    window.addEventListener("scroll", cerrar, true);
    return () => { document.removeEventListener("mousedown", fuera); window.removeEventListener("scroll", cerrar, true); };
  }, [menu]);
  return (
    <div ref={caja} style={{ position: "relative" }}>
      <button className="dv-btn" aria-label="Más acciones" title="Más acciones" disabled={subiendo} style={{ padding: "7px 11px", letterSpacing: ".1em" }}
        onClick={(e) => { if (menu) { setMenu(null); return; } const b = e.currentTarget.getBoundingClientRect(); const abajo = window.innerHeight - b.bottom > 80; setMenu({ left: Math.max(8, b.right - 200), top: abajo ? b.bottom + 6 : b.top - (onImprimir ? 96 : 52) }); }}>{subiendo ? "…" : "⋯"}</button>
      {menu && createPortal(
        // Va al body: el vidrio (backdrop-filter) de las tarjetas encierra a los position:fixed y los recorta
        <div className="dv-menu" ref={pop} style={{ position: "fixed", left: menu.left, top: menu.top, bottom: "auto", right: "auto", zIndex: 75, minWidth: 200 }}>
          {onImprimir && <button onClick={() => { setMenu(null); onImprimir(); }}>Reimprimir</button>}
          <button onClick={() => { setMenu(null); setConfirma(true); }}>Reemplazar foto…</button>
        </div>, document.body)}
      <input ref={input} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { onReemplazar(e.target.files[0]); e.target.value = ""; }} />
      {confirma && createPortal(
        <div className="dv-modal-fondo" onClick={() => setConfirma(false)}>
          <div className="dv-modal" style={{ width: "min(440px,100%)" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reemplazar foto">
            <div className="dv-modal-cab">
              <div style={{ fontWeight: 700, fontSize: 16 }}>¿Reemplazar la foto de {rem.codigo}?</div>
              <div style={{ fontSize: 13, color: C.ink2, marginTop: 6, lineHeight: 1.5 }}>Se cambia solo la imagen del remito firmado de <b>{rem.cliente}</b>. La foto actual queda guardada como registro y en LightData no cambia nada.</div>
            </div>
            <div className="dv-modal-pie" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="dv-btn" onClick={() => setConfirma(false)}>Cancelar</button>
              <button className="dv-btn pri" onClick={() => { setConfirma(false); input.current && input.current.click(); }}>Sí, elegir foto nueva</button>
            </div>
          </div>
        </div>, document.body)}
    </div>
  );
}

// ---------------- Ingreso a depósito escaneando la etiqueta del paquete ----------------
// Continuo (acá no hace falta foto de prueba): lee el QR/código de barras de la etiqueta de ML o de LightData,
// busca la devolución y la pasa a depósito al toque. Se puede tipear la venta/tracking si la etiqueta está rota.
function IngresoEscaner({ casos, onIngresar, onCerrar }) {
  const video = useRef();
  const casosRef = useRef(casos); casosRef.current = casos;
  const ultimo = useRef({ t: "", at: 0 });
  const hechos = useRef(new Set());
  const [lecturas, setLecturas] = useState([]); // { id, tipo: ok|ya|no, titulo, sub }
  const [error, setError] = useState(null);
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState(null);

  async function procesar(texto) {
    const ahora = Date.now();
    if (texto === ultimo.current.t && ahora - ultimo.current.at < 4000) return; // la misma etiqueta sigue en cuadro
    ultimo.current = { t: texto, at: ahora };
    const c = casoDeEtiqueta(casosRef.current, texto);
    let l;
    if (!c) l = { tipo: "no", titulo: "No es una devolución abierta", sub: `Leído: ${String(texto).slice(0, 40)}. Si se canceló hace menos de 1 hora, todavía no llegó de LightData.` };
    else if (hechos.current.has(c.did) || c.etapa === "deposito") l = { tipo: "ya", titulo: `${c.cliente} · ya estaba en depósito`, sub: [c.direccion, c.ml_venta_id || c.tracking].filter(Boolean).join(" · ") };
    else if (c.etapa === "devuelto" || c.cerrado) l = { tipo: "ya", titulo: `${c.cliente} · ${c.etapa === "devuelto" ? "ya fue devuelto al seller" : "está cerrado"}`, sub: [c.direccion, c.ml_venta_id || c.tracking].filter(Boolean).join(" · ") };
    else {
      hechos.current.add(c.did);
      const ok = await onIngresar(c);
      l = ok ? { tipo: "ok", titulo: `${c.cliente} · ${c.tipo === "CAMBIO" ? "cambio" : "cancelado"}`, sub: [c.direccion, c.cadete ? `lo trajo ${c.cadete}` : null].filter(Boolean).join(" · ") }
        : { tipo: "no", titulo: "No se pudo guardar", sub: "Probá de nuevo" };
      if (!ok) hechos.current.delete(c.did);
    }
    try { navigator.vibrate && navigator.vibrate(l.tipo === "ok" ? 60 : [40, 60, 40]); } catch {}
    setFlash(l); setTimeout(() => setFlash((f) => (f === l ? null : f)), 2200);
    setLecturas((x) => [{ ...l, id: ahora }, ...x].slice(0, 60));
  }

  useEffect(() => {
    let stream, timer, vivo = true;
    const cv = document.createElement("canvas");
    const det = "BarcodeDetector" in window ? new window.BarcodeDetector({ formats: ["qr_code", "code_128", "ean_13", "data_matrix"] }) : null;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream; await video.current.play();
      } catch { setError("No se pudo abrir la cámara. Podés tipear la venta o el tracking abajo."); return; }
      let ocupado = false;
      timer = setInterval(async () => {
        const v = video.current;
        if (ocupado || !v || !v.videoWidth) return;
        ocupado = true;
        try {
          let texto = null;
          if (det) { const r = await det.detect(v).catch(() => []); if (r && r[0]) texto = r[0].rawValue; }
          if (!texto) {
            const e = 800 / v.videoWidth; cv.width = 800; cv.height = Math.round(v.videoHeight * e);
            const cx = cv.getContext("2d"); cx.drawImage(v, 0, 0, cv.width, cv.height);
            const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: "dontInvert" });
            if (r) texto = r.data;
          }
          if (texto && !codigoDeQR(texto)) await procesar(texto); // un QR de remito no es una etiqueta
        } finally { ocupado = false; }
      }, 280);
    })();
    return () => { vivo = false; clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nOk = lecturas.filter((l) => l.tipo === "ok").length;
  return createPortal(
    <div className="dv-escaner">
      <video ref={video} playsInline muted className="dv-escaner-video" />
      <div className={"dv-escaner-marco" + (flash && flash.tipo === "ok" ? " ok" : flash ? " aviso" : "")} />
      <div className="dv-escaner-arriba">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700 }}>Ingreso a depósito</div>
          <div style={{ fontSize: 12.5, opacity: .8, marginTop: 2 }}>Apuntá a la etiqueta del paquete (QR o código de barras). Entra solo.</div>
        </div>
        <button className="dv-btn" onClick={onCerrar} style={{ background: "rgba(0,0,0,.5)" }}>Terminar ({nOk})</button>
      </div>
      {flash && <div className={"dv-escaner-flash " + (flash.tipo === "ok" ? "" : flash.tipo === "ya" ? "info" : "aviso")}><b>{flash.tipo === "ok" ? "✓ " : ""}{flash.titulo}</b>{flash.sub && <div style={{ fontSize: 12.5, opacity: .85, marginTop: 2 }}>{flash.sub}</div>}</div>}
      {error && !flash && <div className="dv-escaner-flash aviso">{error}</div>}
      <div className="dv-ing-abajo">
        <form onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { ultimo.current = { t: "", at: 0 }; procesar(manual.trim()); setManual(""); } }} style={{ display: "flex", gap: 8 }}>
          <input className="dv-input" style={{ flex: 1, background: "rgba(0,0,0,.55)" }} inputMode="text" placeholder="Etiqueta rota: tipeá venta, tracking o #envío" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="dv-btn pri" type="submit">Ingresar</button>
        </form>
        {lecturas.length > 0 && (
          <div className="dv-ing-lista">
            {lecturas.slice(0, 6).map((l) => (
              <div key={l.id} className="dv-ing-fila">
                <span className={"dv-tanda-ico " + (l.tipo === "ok" ? "ok" : l.tipo === "no" ? "mal" : "")}>{l.tipo === "ok" ? "✓" : l.tipo === "no" ? "✕" : "·"}</span>
                <span style={{ minWidth: 0 }}><b style={{ fontSize: 13 }}>{l.titulo}</b><span style={{ display: "block", fontSize: 11.5, opacity: .7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.sub}</span></span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>, document.body);
}

// ---------------- Listos para devolver: la app propone los remitos ----------------
function ListosModal({ grupos, onArmar, onCerrar }) {
  const [tildes, setTildes] = useState(() => Object.fromEntries(grupos.map((g) => [g.cliente, g.vencidos > 0])));
  const elegidos = grupos.filter((g) => tildes[g.cliente]);
  const envios = elegidos.reduce((s, g) => s + g.casos.length, 0);
  const remitos = elegidos.reduce((s, g) => s + Math.ceil(g.casos.length / MAX_POR_REMITO), 0);
  return createPortal(
    <div className="dv-modal-fondo" onClick={onCerrar}>
      <div className="dv-modal" style={{ width: "min(620px,100%)" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Listos para devolver">
        <div className="dv-modal-cab">
          <div style={{ fontWeight: 700, fontSize: 16 }}>Listos para devolver</div>
          <div style={{ fontSize: 13, color: C.ink2, marginTop: 4 }}>Todo lo que está en depósito y todavía no tiene remito, por seller, el más viejo arriba. Vienen tildados los que tienen paquetes de más de {LIMITE_DEPOSITO} días.</div>
        </div>
        <div className="dv-modal-cuerpo" style={{ padding: "6px 12px" }}>
          {!grupos.length && <div style={{ padding: 24, textAlign: "center", color: C.ink3 }}>No hay nada en depósito sin remito.</div>}
          {grupos.map((g) => (
            <label key={g.cliente} className="dv-listo">
              <input type="checkbox" checked={!!tildes[g.cliente]} onChange={(e) => setTildes((t) => ({ ...t, [g.cliente]: e.target.checked }))} style={{ width: 18, height: 18, accentColor: C.teal }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <b>{g.cliente}</b>
                <span style={{ display: "block", fontSize: 12, color: C.ink3 }}>{g.casos.length} paquete{g.casos.length !== 1 ? "s" : ""} · {plata(g.valor)}{g.casos.length > MAX_POR_REMITO ? ` · ${Math.ceil(g.casos.length / MAX_POR_REMITO)} remitos (de a ${MAX_POR_REMITO})` : ""}</span>
              </span>
              <span style={{ textAlign: "right", fontSize: 12.5 }}>
                <b style={{ fontFamily: C.grotesk, fontSize: 15, color: g.vencidos ? C.ambar : C.ink }}>{g.maxDias} d</b>
                <span style={{ display: "block", fontSize: 11.5, color: g.vencidos ? C.ambar : C.ink3 }}>{g.vencidos ? `${g.vencidos} vencido${g.vencidos > 1 ? "s" : ""}` : "el más viejo"}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="dv-modal-pie" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button className="dv-btn" onClick={() => setTildes(Object.fromEntries(grupos.map((g) => [g.cliente, elegidos.length !== grupos.length])))}>{elegidos.length === grupos.length ? "Destildar todos" : "Tildar todos"}</button>
          <span style={{ flex: 1 }} />
          <button className="dv-btn" onClick={onCerrar}>Cancelar</button>
          <button className="dv-btn pri" disabled={!elegidos.length} onClick={() => onArmar(elegidos.flatMap((g) => g.casos))}>{elegidos.length ? `Armar ${remitos} remito${remitos !== 1 ? "s" : ""} · ${envios} paquetes` : "Elegí al menos un seller"}</button>
        </div>
      </div>
    </div>, document.body);
}

// Celular: la sección se usa sobre todo en la compu; en el celu lo importante es la cámara (ingreso y remitos)
function useEsCelu() {
  const q = "(max-width: 700px)";
  const [es, setEs] = useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia(q).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(q); const f = () => setEs(m.matches);
    m.addEventListener ? m.addEventListener("change", f) : m.addListener(f);
    return () => (m.removeEventListener ? m.removeEventListener("change", f) : m.removeListener(f));
  }, []);
  return es;
}
const IcoCamara = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 7h1a2 2 0 0 0 2-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2" /><circle cx="12" cy="13" r="3" /></svg>
);
const IcoScan = ({ size = 22 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7V6a2 2 0 0 1 2-2h2M4 17v1a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v1M16 20h2a2 2 0 0 0 2-2v-1M5 12h14" /></svg>
);

// ---------------- Armar remito: confirmación + chofer que lo lleva ----------------
function ArmarRemitoModal({ previa, yaEnRemito, choferes, onConfirmar, onCerrar }) {
  const [chofer, setChofer] = useState("");
  return createPortal(
    <div className="dv-modal-fondo" onClick={onCerrar}>
      <div className="dv-modal" style={{ width: "min(480px,100%)" }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Armar remito">
        <div className="dv-modal-cab">
          <div style={{ fontWeight: 700, fontSize: 16 }}>{previa.length === 1 ? "Armar 1 remito" : `Armar ${previa.length} remitos (uno por cliente)`}</div>
          <div style={{ fontSize: 13, color: C.ink2, marginTop: 4 }}>Se imprimen dos hojas por remito: el <b>remito chofer</b> (lo firma el chofer al retirar) y el <b>remito seller</b> (lo firman el chofer y quien recibe; vuelve y se fotografía).</div>
        </div>
        <div className="dv-modal-cuerpo" style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {previa.map((g, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5 }}><span>{g.cliente}</span><b>{g.casos.length} envío{g.casos.length !== 1 ? "s" : ""}</b></div>)}
            {yaEnRemito > 0 && <div style={{ fontSize: 12, color: C.ambar }}>{yaEnRemito} envío(s) ya estaban en otro remito y no se incluyen.</div>}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
            <span>Chofer que lo lleva <span style={{ color: C.ink3 }}>(opcional)</span></span>
            <input className="dv-input" list="dv-choferes" placeholder="Elegí o escribí el nombre" value={chofer} onChange={(e) => setChofer(e.target.value)} autoFocus />
            <datalist id="dv-choferes">{choferes.map((n) => <option key={n} value={n} />)}</datalist>
            <span style={{ fontSize: 12, color: C.ink3 }}>Sale impreso en las dos hojas. Si después lo lleva otro, se tacha y se escribe a mano. Vacío = línea en blanco.</span>
          </label>
        </div>
        <div className="dv-modal-pie" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="dv-btn" onClick={onCerrar}>Cancelar</button>
          <button className="dv-btn pri" onClick={() => onConfirmar(chofer.trim())}>Armar e imprimir</button>
        </div>
      </div>
    </div>, document.body);
}

// ---------------- Visor de fotos dentro de la página (en vez de abrir otra pestaña) ----------------
// items: [{ path, titulo, sub }]. Flechas / teclado para pasar entre las fotos de la vista; tocar la foto = zoom.
function Visor({ items, inicio = 0, onCerrar, acciones, digital, vistaInicial = "foto" }) {
  const [i, setI] = useState(inicio);
  const [vista, setVista] = useState(vistaInicial);
  const [urls, setUrls] = useState({});
  const [zoom, setZoom] = useState(false);
  const it = items[i] || {};
  useEffect(() => {
    const faltan = [items[i - 1], items[i], items[i + 1]].filter((x) => x && x.path && !urls[x.path]).map((x) => x.path);
    if (faltan.length) firmarFotos(faltan).then((m) => setUrls((u) => ({ ...u, ...m }))).catch(() => {});
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tecla = (e) => {
      if (e.key === "Escape") onCerrar();
      else if (e.key === "ArrowRight") { setI((x) => Math.min(items.length - 1, x + 1)); setZoom(false); }
      else if (e.key === "ArrowLeft") { setI((x) => Math.max(0, x - 1)); setZoom(false); }
    };
    window.addEventListener("keydown", tecla);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = prev; };
  }, [items.length, onCerrar]);
  const url = urls[it.path];
  const ir = (d) => { setI((x) => Math.min(items.length - 1, Math.max(0, x + d))); setZoom(false); };
  return createPortal(
    <div className="dv-visor" onClick={onCerrar} role="dialog" aria-label={it.titulo || "Foto del remito"}>
      <div className="dv-visor-cab" onClick={(e) => e.stopPropagation()}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.titulo}</div>
          {it.sub && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,.65)", marginTop: 2 }}>{it.sub}</div>}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          {digital && (
            <div className="dv-seg sm" style={{ marginRight: 4 }}>
              <button className={vista === "foto" ? "on" : ""} onClick={() => setVista("foto")}>Foto firmada</button>
              <button className={vista === "digital" ? "on" : ""} onClick={() => setVista("digital")}>Remito digital</button>
            </div>
          )}
          {items.length > 1 && <span style={{ fontSize: 12.5, color: "rgba(255,255,255,.6)", marginRight: 4 }}>{i + 1} de {items.length}</span>}
          {acciones && acciones(it)}
          {url && vista === "foto" && <a className="dv-btn" href={url} download={`${(it.titulo || "remito").split(" ")[0]}.jpg`}>Descargar</a>}
          <button className="dv-btn" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>
      </div>
      {digital && vista === "digital" ? <div className="dv-visor-img" style={{ alignItems: "flex-start" }} onClick={(e) => e.stopPropagation()}>{digital(it)}</div> :
      <div className={"dv-visor-img" + (zoom ? " zoom" : "")} onClick={(e) => e.stopPropagation()}>
        {url ? <img src={url} alt={it.titulo || "Foto"} onClick={() => setZoom((z) => !z)} /> : <span style={{ color: "rgba(255,255,255,.6)" }}>{it.path ? "Cargando…" : "Sin foto"}</span>}
      </div>}
      {items.length > 1 && (
        <>
          <button className="dv-visor-flecha izq" disabled={i === 0} onClick={(e) => { e.stopPropagation(); ir(-1); }} aria-label="Anterior">‹</button>
          <button className="dv-visor-flecha der" disabled={i === items.length - 1} onClick={(e) => { e.stopPropagation(); ir(1); }} aria-label="Siguiente">›</button>
        </>
      )}
      <div className="dv-visor-pie">{vista === "foto" ? "Tocá la foto para acercar · Esc para cerrar" : "Esc para cerrar"}</div>
    </div>, document.body);
}

// ---------------- Remito digital: el remito original con sus envíos, buscable ----------------
function RemitoDigital({ rem, casos, resaltar = "" }) {
  const [q, setQ] = useState(resaltar);
  const filas = casos.map((c, n) => ({ c, n: n + 1 })).filter(({ c }) => !q.trim() || coincideBusqueda(c, q));
  const total = casos.reduce((s, c) => s + (Number(c.valor) || 0), 0);
  return (
    <div className="dv-rd" onClick={(e) => e.stopPropagation()}>
      <div className="dv-rd-cab">
        <div>
          <div style={{ fontSize: 12, color: C.ink3, letterSpacing: ".06em" }}>REMITO DE DEVOLUCIÓN</div>
          <div style={{ fontFamily: C.grotesk, fontWeight: 700, fontSize: 22 }}>{rem.codigo}</div>
        </div>
        <span className="dv-tag" style={rem.estado === "devuelto" ? { color: C.teal, borderColor: "rgba(46,230,182,.3)" } : null}>{ESTADO_REMITO[rem.estado]}</span>
      </div>
      <div className="dv-rd-meta">
        <div><span>Cliente</span><b>{rem.cliente}</b></div>
        <div><span>Emitido</span><b>{fecha(rem.creado_at)}</b><small>{rem.creado_por || "—"}</small></div>
        <div><span>Chofer</span><b>{rem.chofer || "—"}</b></div>
        <div><span>Firma subida</span><b>{rem.firmado_at ? fecha(rem.firmado_at) : "—"}</b><small>{rem.firmado_por || ""}</small></div>
        <div><span>Confirmado</span><b>{rem.confirmado_at ? fecha(rem.confirmado_at) : rem.procesado_at ? fecha(rem.procesado_at) : "—"}</b><small>{rem.confirmado_por || ""}</small></div>
        <div><span>Envíos</span><b>{casos.length}</b></div>
        <div><span>Valor declarado</span><b>{plata(total)}</b></div>
      </div>
      <input className="dv-input" style={{ width: "100%", margin: "4px 0 10px" }} placeholder="Buscar en este remito: venta, dirección, tracking…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="dv-rd-tabla">
        <div className="dv-rd-f dv-rd-th"><span>#</span><span>Venta / tracking</span><span>Dirección</span><span>Tipo</span><span className="dv-r">Valor</span></div>
        {filas.map(({ c, n }) => (
          <div key={c.did} className="dv-rd-f">
            <span style={{ color: C.ink3 }}>{n}</span>
            <span style={{ minWidth: 0 }}><b style={{ fontWeight: 600 }}>{c.ml_venta_id || c.tracking || "—"}</b><small>#{c.did}{c.ml_venta_id && c.tracking ? ` · ${c.tracking}` : ""}</small></span>
            <span style={{ minWidth: 0 }}>{c.direccion || "—"}<small>{c.localidad || ""}</small></span>
            <span>{c.tipo === "CAMBIO" ? "Cambio" : c.tipo ? "Cancelado" : "—"}</span>
            <span className="dv-r">{c.valor ? plata(c.valor) : "—"}</span>
          </div>
        ))}
        {!filas.length && <div style={{ padding: 16, color: C.ink3, fontSize: 13, textAlign: "center" }}>Ningún envío de este remito coincide.</div>}
      </div>
    </div>
  );
}

function Carpetas({ remitos, casosDe, onImprimir, toast, subiendo, onReemplazar }) {
  const [cliente, setCliente] = useState(null);
  const [mes, setMes] = useState(null);
  const [busca, setBusca] = useState("");
  const [fotos, setFotos] = useState({});
  const [bajando, setBajando] = useState(false);
  const [visor, setVisor] = useState(null); // índice en enVista
  const [visorVista, setVisorVista] = useState("foto");
  const devueltos = remitos.filter((r) => r.estado === "devuelto");
  const fechaRem = (r) => r.firmado_at || r.procesado_at || r.creado_at;

  const porCliente = useMemo(() => {
    const m = new Map();
    for (const r of devueltos) {
      const k = r.cliente || "(sin cliente)";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return [...m.entries()].map(([nombre, rs]) => ({
      nombre, remitos: rs, envios: rs.reduce((s, r) => s + (r.dids || []).length, 0),
      ultimo: rs.map(fechaRem).filter(Boolean).sort().pop(),
    })).sort((a, b) => String(b.ultimo).localeCompare(String(a.ultimo)));
  }, [remitos]); // eslint-disable-line react-hooks/exhaustive-deps

  const carpeta = cliente ? porCliente.find((c) => c.nombre === cliente) : null;
  const meses = useMemo(() => {
    if (!carpeta) return [];
    const m = new Map();
    for (const r of carpeta.remitos) { const k = mesDe(fechaRem(r)); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, rs]) => ({ k, remitos: rs.sort((a, b) => String(fechaRem(b)).localeCompare(String(fechaRem(a)))) }));
  }, [carpeta]); // eslint-disable-line react-hooks/exhaustive-deps
  const delMes = mes ? (meses.find((m) => m.k === mes) || { remitos: [] }).remitos : [];
  const q = busca.trim().toLowerCase();
  // Búsqueda directa de remitos: por número (RD-00012 o 12), cliente, número de venta, tracking o envío
  const encontrados = useMemo(() => {
    if (cliente || q.length < 2) return [];
    const qn = q.replace(/^rd-?0*/, "");
    return devueltos.filter((r) => {
      if (String(r.codigo || "").toLowerCase().includes(q) || (qn && /^\d+$/.test(qn) && String(r.codigo || "").replace(/^RD-0*/, "") === qn)) return true;
      if (String(r.cliente || "").toLowerCase().includes(q)) return true;
      return casosDe(r).some((c) => coincideBusqueda(c, busca));
    }).sort((a, b) => String(fechaRem(b)).localeCompare(String(fechaRem(a)))).slice(0, 60);
  }, [q, cliente, remitos]); // eslint-disable-line react-hooks/exhaustive-deps
  const enVista = mes ? delMes : encontrados;

  // Miniaturas de las fotos firmadas del mes abierto
  useEffect(() => {
    const paths = enVista.map((r) => r.foto_path).filter((p) => p && !fotos[p]);
    if (!paths.length) return;
    firmarFotos(paths).then((m) => setFotos((f) => ({ ...f, ...m }))).catch(() => {});
  }, [mes, cliente, encontrados]); // eslint-disable-line react-hooks/exhaustive-deps

  async function bajarZip() {
    setBajando(true);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const urls = await firmarFotos(delMes.map((r) => r.foto_path).filter(Boolean));
      for (const r of delMes) {
        const u = urls[r.foto_path];
        if (!u) continue;
        const b = await (await fetch(u)).blob();
        zip.file(`${r.codigo} - ${diaAR(fechaRem(r))}.jpg`, b);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `Remitos ${cliente} - ${nombreMes(mes)}.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { toast("No se pudo armar el .zip: " + String(e.message || e).slice(0, 80)); }
    setBajando(false);
  }

  const miga = (
    <div className="dv-miga">
      <button onClick={() => { setCliente(null); setMes(null); }} className={!cliente ? "on" : ""}>Remitos devueltos</button>
      {cliente && <><span>›</span><button onClick={() => setMes(null)} className={!mes ? "on" : ""}>{cliente}</button></>}
      {mes && <><span>›</span><button className="on">{nombreMes(mes)}</button></>}
    </div>
  );

  const visorItems = enVista.map((r) => ({ path: r.foto_path, rem: r, titulo: `${r.codigo} · ${r.cliente}`, sub: `${(r.dids || []).length} envíos · ${fecha(fechaRem(r))} · subido por ${r.firmado_por || "—"}${r.confirmado_por ? ` · confirmado por ${r.confirmado_por}` : ""}` }));
  if (!devueltos.length) return <div style={{ ...card, padding: 28, textAlign: "center", color: C.ink3, fontSize: 14 }}>Todavía no hay remitos devueltos. Cuando se sube la foto de un remito firmado y se procesa, queda guardado acá en la carpeta de su cliente.</div>;

  return (
    <div style={{ ...card, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        {miga}
        <span style={{ flex: 1 }} />
        {!cliente && <input className="dv-input" style={{ flex: "0 1 260px" }} placeholder="Buscar remito, cliente, venta o dirección" value={busca} onChange={(e) => setBusca(e.target.value)} />}
        {mes && <button className="dv-btn pri" disabled={bajando || !delMes.some((r) => r.foto_path)} onClick={bajarZip}>{bajando ? "Armando .zip…" : `Descargar carpeta (${delMes.length})`}</button>}
      </div>

      {!cliente && (
        <div className="dv-carpetas">
          {porCliente.filter((c) => !q || c.nombre.toLowerCase().includes(q) || encontrados.some((r) => (r.cliente || "(sin cliente)") === c.nombre)).map((c) => (
            <button key={c.nombre} className="dv-carpeta" onClick={() => { setCliente(c.nombre); setMes(null); }}>
              <IconoCarpeta />
              <span style={{ minWidth: 0 }}>
                <span className="dv-carpeta-n">{c.nombre}</span>
                <span className="dv-carpeta-s">{c.remitos.length} remito{c.remitos.length > 1 ? "s" : ""} · {num(c.envios)} envíos · último {fecha(c.ultimo).split(",")[0]}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {cliente && !mes && (
        <div className="dv-carpetas">
          {meses.map((m) => (
            <button key={m.k} className="dv-carpeta" onClick={() => setMes(m.k)}>
              <IconoCarpeta />
              <span style={{ minWidth: 0 }}>
                <span className="dv-carpeta-n">{nombreMes(m.k)}</span>
                <span className="dv-carpeta-s">{m.remitos.length} remito{m.remitos.length > 1 ? "s" : ""} · {num(m.remitos.reduce((s, r) => s + (r.dids || []).length, 0))} envíos</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!cliente && q.length >= 2 && (
        <div style={{ fontSize: 13, color: C.ink3, margin: "18px 0 10px" }}>
          {encontrados.length ? `${encontrados.length} remito${encontrados.length > 1 ? "s" : ""} encontrado${encontrados.length > 1 ? "s" : ""}` : "Ningún remito devuelto coincide con la búsqueda."}
        </div>
      )}
      {visor != null && <Visor items={visorItems} inicio={visor} onCerrar={() => setVisor(null)} acciones={(it) => <button className="dv-btn" onClick={() => onImprimir(it.rem)}>Reimprimir</button>}
        digital={(it) => <RemitoDigital key={it.rem.id} rem={it.rem} casos={casosDe(it.rem)} resaltar={!cliente && q.length >= 2 && !String(it.rem.codigo).toLowerCase().includes(q) && !String(it.rem.cliente || "").toLowerCase().includes(q) ? busca.trim() : ""} />}
        vistaInicial={visorVista} />}
      {(mes || (!cliente && encontrados.length > 0)) && (
        <div className="dv-fotos">
          {enVista.map((r) => (
            <div key={r.id} className="dv-foto">
              <button className="dv-foto-img" style={{ border: 0, width: "100%", cursor: r.foto_path ? "zoom-in" : "default" }} onClick={() => { setVisorVista(r.foto_path ? "foto" : "digital"); setVisor(enVista.indexOf(r)); }} aria-label={`Ver la foto del remito ${r.codigo}`}>
                {fotos[r.foto_path] ? <img src={fotos[r.foto_path]} alt={`Remito ${r.codigo} firmado`} loading="lazy" /> : <span style={{ color: C.ink3, fontSize: 12 }}>{r.foto_path ? "Cargando…" : "Sin foto"}</span>}
              </button>
              <div style={{ padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <b style={{ fontFamily: C.grotesk }}>{r.codigo}{!mes && <span style={{ fontWeight: 400, color: C.ink3, fontFamily: "inherit" }}> · {r.cliente}</span>}</b>
                  <span style={{ fontSize: 12, color: C.ink3 }}>{fecha(fechaRem(r))}</span>
                </div>
                <div style={{ fontSize: 12, color: C.ink3, marginTop: 3 }}>{(r.dids || []).length} envíos · firmado subido por {r.firmado_por || "—"}</div>
                {!mes && q.length >= 2 && (() => {
                  const m = casosDe(r).filter((c) => coincideBusqueda(c, busca));
                  if (!m.length || m.length === (r.dids || []).length) return null;
                  const c = m[0];
                  return <div style={{ fontSize: 12, color: C.teal, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Contiene: {c.ml_venta_id || c.tracking || `#${c.did}`}{c.direccion ? ` · ${c.direccion}` : ""}{m.length > 1 ? ` y ${m.length - 1} más` : ""}</div>;
                })()}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button className="dv-btn" style={{ flex: 1 }} onClick={() => { setVisorVista("digital"); setVisor(enVista.indexOf(r)); }}>Ver remito</button>
                  <MasAcciones rem={r} subiendo={subiendo === r.codigo} onReemplazar={(f) => onReemplazar(r, f)} onImprimir={() => onImprimir(r)} />
                </div>
                {r.calidad && r.calidad.problemas && r.calidad.problemas.length > 0 && <div style={{ fontSize: 11.5, color: C.ambar, marginTop: 6 }}>{textoCalidad(r.calidad)} · revisar</div>}
                {(r.fotos_anteriores || []).length > 0 && <div style={{ fontSize: 11, color: C.ink3, marginTop: 6 }}>Foto reemplazada ({r.fotos_anteriores.length} anterior{r.fotos_anteriores.length > 1 ? "es" : ""} guardada{r.fotos_anteriores.length > 1 ? "s" : ""})</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- Por confirmar: revisión de las fotos antes de tocar LightData ----------------
// Doble verificación (pedido de Alejo 22/10): la foto deja el remito "por_confirmar". Acá se revisa la tanda
// de un vistazo y recién al confirmar pasa a "procesando" (el sync lo marca Devuelto al cliente en LightData).
// Las fotos con problemas de calidad arrancan destildadas para que la atención vaya ahí.
function PorConfirmar({ remitos, casosDe, onConfirmar, onRepetir, subiendo, refPanel }) {
  const pend = useMemo(() => remitos.filter((r) => r.estado === "por_confirmar").sort((a, b) => String(b.firmado_at).localeCompare(String(a.firmado_at))), [remitos]);
  const dudosa = (r) => !!(r.calidad && r.calidad.problemas && r.calidad.problemas.length);
  const [tildes, setTildes] = useState({});
  const [fotos, setFotos] = useState({});
  const [grande, setGrande] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const inputs = useRef({});
  useEffect(() => {
    const paths = pend.map((r) => r.foto_path).filter((p) => p && !fotos[p]);
    if (paths.length) firmarFotos(paths).then((m) => setFotos((f) => ({ ...f, ...m }))).catch(() => {});
  }, [pend]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pend.length) return null;
  const tildado = (r) => (tildes[r.id + ":" + r.foto_path] ?? !dudosa(r));
  const elegidos = pend.filter(tildado);
  const envios = elegidos.reduce((s, r) => s + (r.dids || []).length, 0);
  async function confirmar() {
    setEnviando(true);
    await onConfirmar(elegidos);
    setEnviando(false);
  }
  return (
    <div ref={refPanel} style={{ ...card, padding: 16, borderColor: "rgba(46,230,182,.35)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px" }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Por confirmar · {pend.length} remito{pend.length > 1 ? "s" : ""}</div>
          <div style={{ fontSize: 13, color: C.ink3, marginTop: 2 }}>Mirá que en cada foto se vea la hoja entera con la firma. Lo que confirmes pasa a “Devuelto al cliente” en LightData; lo destildado queda acá esperando.</div>
        </div>
        <button className="dv-btn" onClick={() => setTildes(Object.fromEntries(pend.map((r) => [r.id + ":" + r.foto_path, elegidos.length !== pend.length])))}>{elegidos.length === pend.length ? "Destildar todas" : "Tildar todas"}</button>
        <button className="dv-btn pri dv-btn-grande" disabled={!elegidos.length || enviando} onClick={confirmar}>
          {enviando ? "Confirmando…" : `Confirmar ${elegidos.length} remito${elegidos.length !== 1 ? "s" : ""} · ${num(envios)} envíos`}
        </button>
      </div>
      <div className="dv-fotos" style={{ marginTop: 14 }}>
        {pend.map((r) => {
          const on = tildado(r);
          const casos = casosDe(r);
          return (
            <div key={r.id} className={"dv-foto dv-pc" + (on ? " on" : "") + (dudosa(r) ? " dudosa" : "")}>
              <button className="dv-foto-img" style={{ height: 230, border: 0, cursor: "zoom-in", width: "100%" }} onClick={() => r.foto_path && setGrande(pend.indexOf(r))} aria-label={`Ver grande la foto del remito ${r.codigo}`}>
                {fotos[r.foto_path] ? <img src={fotos[r.foto_path]} alt={`Remito ${r.codigo} firmado`} /> : <span style={{ color: C.ink3, fontSize: 12 }}>Cargando…</span>}
              </button>
              <div style={{ padding: "10px 12px" }}>
                <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                  <input type="checkbox" checked={on} onChange={(e) => setTildes((t) => ({ ...t, [r.id + ":" + r.foto_path]: e.target.checked }))} style={{ width: 20, height: 20, marginTop: 1, accentColor: C.teal, flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <b style={{ fontFamily: C.grotesk }}>{r.codigo}</b> · {r.cliente}
                    <span style={{ display: "block", fontSize: 12, color: C.ink3 }}>{casos.length} envío{casos.length !== 1 ? "s" : ""} · {r.firmado_por || "—"} · {fecha(r.firmado_at)}</span>
                    {dudosa(r) && <span style={{ display: "block", fontSize: 12, color: C.ambar }}>{textoCalidad(r.calidad)}: revisala antes de confirmar</span>}
                  </span>
                </label>
                <input ref={(el) => (inputs.current[r.id] = el)} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { onRepetir(r, e.target.files[0]); e.target.value = ""; }} />
                <button className="dv-btn" style={{ width: "100%", marginTop: 8 }} disabled={subiendo === r.codigo} onClick={() => inputs.current[r.id].click()}>{subiendo === r.codigo ? "Subiendo…" : "Repetir foto"}</button>
              </div>
            </div>
          );
        })}
      </div>
      {grande != null && <Visor items={pend.map((r) => ({ path: r.foto_path, titulo: `${r.codigo} · ${r.cliente}`, sub: `${(r.dids || []).length} envíos · subido por ${r.firmado_por || "—"} · ${fecha(r.firmado_at)}` }))} inicio={grande} onCerrar={() => setGrande(null)} />}
    </div>
  );
}

// ---------------- Fotos que no se pudieron reconocer ----------------
function NoReconocidas({ fallidos, remitos, onAsignar, onDescartar }) {
  const [fotos, setFotos] = useState({});
  const [elegido, setElegido] = useState({});
  const [visor, setVisor] = useState(null);
  useEffect(() => {
    const paths = fallidos.map((f) => f.foto_path).filter((p) => !fotos[p]);
    if (paths.length) firmarFotos(paths).then((m) => setFotos((x) => ({ ...x, ...m }))).catch(() => {});
  }, [fallidos]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!fallidos.length) return null;
  const abiertos = remitos.filter((r) => ["emitido", "error"].includes(r.estado));
  return (
    <div style={{ ...card, padding: 16, borderColor: "rgba(245,192,68,.3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="dv-dot" style={{ background: C.ambar, margin: 0 }} />
        <span style={{ fontWeight: 600 }}>No reconocidas · {fallidos.length}</span>
        <Info texto="Fotos subidas que la app no pudo asignar a un remito (no se leyó el QR o el QR no corresponde a un remito). Elegí a qué remito corresponde cada una viendo la foto, o descartala si no sirve." />
      </div>
      {visor != null && <Visor items={fallidos.map((f) => ({ path: f.foto_path, titulo: "Foto no reconocida", sub: `${f.motivo} · ${fecha(f.at)} · ${f.por || "—"}` }))} inicio={visor} onCerrar={() => setVisor(null)} />}
      <div className="dv-fotos" style={{ marginTop: 12 }}>
        {fallidos.map((f) => (
          <div key={f.id} className="dv-foto">
            <button className="dv-foto-img" style={{ height: 180, border: 0, width: "100%", cursor: "zoom-in" }} onClick={() => setVisor(fallidos.indexOf(f))} aria-label="Ver la foto">
              {fotos[f.foto_path] ? <img src={fotos[f.foto_path]} alt="Foto no reconocida" loading="lazy" /> : <span style={{ color: C.ink3, fontSize: 12 }}>Cargando…</span>}
            </button>
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ fontSize: 12, color: C.ambar }}>{f.motivo}{f.calidad && f.calidad.problemas && f.calidad.problemas.length ? ` · ${textoCalidad(f.calidad).toLowerCase()}` : ""}</div>
              <div style={{ fontSize: 11.5, color: C.ink3 }}>{fecha(f.at)} · {f.por || "—"}</div>
              <select className="dv-input" value={elegido[f.id] || ""} onChange={(e) => setElegido((x) => ({ ...x, [f.id]: e.target.value }))} aria-label="Remito al que corresponde">
                <option value="">¿De qué remito es?</option>
                {abiertos.map((r) => <option key={r.id} value={r.codigo}>{r.codigo} · {r.cliente} ({(r.dids || []).length})</option>)}
              </select>
              <div style={{ display: "flex", gap: 6 }}>
                <button className="dv-btn pri" style={{ flex: 1 }} disabled={!elegido[f.id]} onClick={() => onAsignar(f, abiertos.find((r) => r.codigo === elegido[f.id]))}>Asignar</button>
                <button className="dv-btn" onClick={() => onDescartar(f)}>Descartar</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Modo escáner: varios remitos seguidos con la cámara ----------------
// Semi-automático (pedido de Alejo 22/10): la cámara RECONOCE el QR sola, pero la foto la saca la persona
// con el botón, encuadrando la hoja entera con la firma del cliente. Abajo queda la última foto para
// controlar de un vistazo que se vea la firma, con "Repetir" (reemplaza la foto de ese remito).
function Escaner({ remitos, onLectura, onRepetir, onCerrar }) {
  const video = useRef();
  const [detectado, setDetectado] = useState(null); // { codigo, cliente, estado, qr }
  const [ultima, setUltima] = useState(null);       // { url, codigo, cliente, aviso, lectura }
  const [tomados, setTomados] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [disparo, setDisparo] = useState(false);
  const [aviso, setAviso] = useState(null);
  const visto = useRef({ codigo: null, at: 0 });
  useEffect(() => {
    let stream, timer, vivo = true;
    const chico = document.createElement("canvas");
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream;
        await video.current.play();
      } catch (e) { setError("No se pudo abrir la cámara. Revisá el permiso de cámara del navegador para esta página."); return; }
      timer = setInterval(() => {
        const v = video.current;
        if (!v || !v.videoWidth) return;
        const esc = 640 / v.videoWidth;
        chico.width = 640; chico.height = Math.round(v.videoHeight * esc);
        const cx = chico.getContext("2d");
        cx.drawImage(v, 0, 0, chico.width, chico.height);
        const r = jsQR(cx.getImageData(0, 0, chico.width, chico.height).data, chico.width, chico.height, { inversionAttempts: "dontInvert" });
        const codigo = r && codigoDeQR(r.data);
        const ahora = Date.now();
        if (codigo) {
          visto.current = { codigo, at: ahora };
          const rem = remitos.find((x) => x.codigo === codigo);
          setDetectado((d) => (d && d.codigo === codigo ? d : { codigo, qr: r.data, cliente: rem ? rem.cliente : null, estado: rem ? rem.estado : "inexistente" }));
        } else if (ahora - visto.current.at > 900) {
          setDetectado(null);
        }
      }, 300);
    })();
    return () => { vivo = false; clearInterval(timer); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (ultima) URL.revokeObjectURL(ultima.url); }, [ultima]);

  async function capturar() {
    const v = video.current;
    if (!v || !v.videoWidth || !detectado) return;
    setDisparo(true); setTimeout(() => setDisparo(false), 180);
    const grande = document.createElement("canvas");
    const e2 = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
    grande.width = Math.round(v.videoWidth * e2); grande.height = Math.round(v.videoHeight * e2);
    grande.getContext("2d").drawImage(v, 0, 0, grande.width, grande.height);
    // Confirmar el remito con la foto misma (no con lo último que vio la cámara): evita que, sacando
    // seguido, la foto del remito nuevo quede asignada al anterior.
    const gx = grande.getContext("2d");
    const rq = jsQR(gx.getImageData(0, 0, grande.width, grande.height).data, grande.width, grande.height, { inversionAttempts: "dontInvert" });
    const enFoto = rq && codigoDeQR(rq.data);
    const fresco = Date.now() - visto.current.at < 450;
    let det = detectado;
    if (enFoto && enFoto !== detectado.codigo) {
      const rem = remitos.find((x) => x.codigo === enFoto);
      if (!rem || !["emitido", "error", "por_confirmar"].includes(rem.estado) && !tomados.has(enFoto)) { setAviso(`${enFoto} no está para devolver`); return; }
      det = { codigo: enFoto, qr: rq.data, cliente: rem.cliente, estado: rem.estado };
    } else if (!enFoto && !(fresco && visto.current.codigo === detectado.codigo)) {
      setAviso("No se vio el QR en la foto. Volvé a apuntar y sacá de nuevo."); return;
    }
    const blob = await new Promise((ok) => grande.toBlob(ok, "image/jpeg", 0.75));
    const ch = document.createElement("canvas"); ch.width = 400; ch.height = Math.round(grande.height * 400 / grande.width);
    ch.getContext("2d").drawImage(grande, 0, 0, ch.width, ch.height);
    const calidad = medirCalidad(ch);
    try { navigator.vibrate && navigator.vibrate(60); } catch {}
    const lectura = { blob, qr: det.qr, calidad };
    const yaTomado = tomados.has(det.codigo);
    setAviso(null);
    setUltima({ url: URL.createObjectURL(blob), codigo: det.codigo, cliente: det.cliente, aviso: textoCalidad(calidad), lectura });
    if (yaTomado) onRepetir(det.codigo, lectura);
    else { setTomados((t) => new Set(t).add(det.codigo)); onLectura(lectura); }
  }

  const yaTomado = detectado && tomados.has(detectado.codigo);
  const listo = detectado && (yaTomado || ["emitido", "error", "por_confirmar"].includes(detectado.estado));
  const texto = !detectado ? "Buscando el QR del remito…"
    : detectado.estado === "inexistente" ? `${detectado.codigo}: ese remito no existe`
    : detectado.estado === "devuelto" && !yaTomado ? `${detectado.codigo} ya está devuelto`
    : detectado.estado === "anulado" ? `${detectado.codigo} está anulado`
    : detectado.estado === "procesando" && !yaTomado ? `${detectado.codigo} ya está confirmado`
    : `${detectado.codigo} · ${detectado.cliente}${yaTomado ? " · ya tomado (repetir)" : ""}`;

  return createPortal(
    <div className="dv-escaner">
      <video ref={video} playsInline muted className="dv-escaner-video" />
      <div className={"dv-escaner-marco" + (listo ? " ok" : "") + (disparo ? " flash" : "")} />
      <div className="dv-escaner-arriba">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color: listo ? "#2ee6b6" : "#fff" }}>{listo ? "✓ " : ""}{texto}</div>
          <div style={{ fontSize: 12.5, opacity: .8, marginTop: 2 }}>{listo ? "Encuadrá la hoja entera, con la firma del cliente, y sacá la foto." : "Apuntá al QR del remito firmado."}</div>
        </div>
        <button className="dv-btn" onClick={onCerrar} style={{ background: "rgba(0,0,0,.5)" }}>Terminar ({tomados.size})</button>
      </div>
      <div className="dv-escaner-abajo">
        <div className="dv-escaner-ultima">
          {ultima ? (
            <>
              <img src={ultima.url} alt={`Última foto, remito ${ultima.codigo}`} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{ultima.codigo}</div>
                <div style={{ fontSize: 11.5, color: ultima.aviso ? "#F5C044" : "rgba(255,255,255,.7)" }}>{ultima.aviso || "¿Se ve la firma?"}</div>
                <div style={{ fontSize: 11, opacity: .7, marginTop: 2 }}>Para repetirla, apuntá a ese QR y sacá otra</div>
              </div>
            </>
          ) : <span style={{ fontSize: 12, opacity: .7 }}>Acá vas a ver la última foto</span>}
        </div>
        <button className={"dv-escaner-disparo" + (listo ? " on" : "")} disabled={!listo} onClick={capturar} aria-label="Sacar foto" />
        <div style={{ width: 120 }} />
      </div>
      {(error || aviso) && <div className="dv-escaner-flash aviso" onClick={() => setAviso(null)}>{error || aviso}</div>}
    </div>, document.body);
}

function Remitos({ remitos, fallidos = [], casosDe, recargar, toast, pedidoEscaner = 0, esCelu = false }) {
  const [filtro, setFiltro] = useState("abiertos");
  const [subiendo, setSubiendo] = useState(null); // codigo en curso
  // Confirmación CON la foto a la vista cuando el QR no se lee (antes era un confirm a ciegas y se coló una captura de pantalla)
  const [confirmar, setConfirmar] = useState(null); // { url, rem, resolver }
  const confirmarConFoto = (blob, rem) => new Promise((resolver) => setConfirmar({ url: URL.createObjectURL(blob), rem, resolver }));
  const cerrarConfirmar = (ok) => { if (!confirmar) return; URL.revokeObjectURL(confirmar.url); confirmar.resolver(ok); setConfirmar(null); };
  const inputGeneral = useRef();
  const lista = remitos.filter((r) => (filtro === "abiertos" ? ["emitido", "por_confirmar", "procesando", "error"].includes(r.estado) : filtro === "devueltos" ? r.estado === "devuelto" : true));

  // ---- Subida de fotos firmadas ----
  // Una foto que no se puede asignar (QR ilegible o de un remito que no existe) NO se pierde: queda en
  // remitos_fallidos ("No reconocidas") para asignarla a mano viendo la foto, o descartarla.
  async function guardarNoReconocida(blob, motivo, calidad) {
    const path = `pendientes/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
    const up = await authedFetch(`${SUPABASE_URL}/storage/v1/object/remitos-firmados/${path}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
    if (!up.ok) return false;
    await sbFetch("remitos_fallidos", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ por: yo(), foto_path: path, motivo, calidad }) }).catch(() => {});
    return true;
  }
  // La foto ya se sabe de qué remito es: subir y dejarlo "por confirmar" (LightData se toca recién al confirmar)
  async function procesarFoto(rem, blob, calidad, pathExistente = null) {
    setSubiendo(rem.codigo);
    const path = pathExistente || `${rem.codigo}/${Date.now()}.jpg`;
    if (!pathExistente) {
      const up = await authedFetch(`${SUPABASE_URL}/storage/v1/object/remitos-firmados/${path}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!up.ok) throw new Error("No se pudo subir la foto (" + up.status + ")");
    }
    await sbFetch(`remitos_devolucion?id=eq.${rem.id}`, { method: "PATCH", body: JSON.stringify({ estado: "por_confirmar", foto_path: path, firmado_por: yo(), firmado_at: new Date().toISOString(), error: null, calidad: calidad || null, fotos_anteriores: rem.estado === "por_confirmar" && rem.foto_path ? [...(rem.fotos_anteriores || []), rem.foto_path] : (rem.fotos_anteriores || []) }) });
    return { ok: true, codigo: rem.codigo, cliente: rem.cliente, aviso: textoCalidad(calidad), msg: "Foto guardada · falta confirmarla abajo" };
  }
  // Decide a qué remito va una foto ya leída. remitoEsperado = se subió desde la fila de ese remito.
  async function resolverFoto({ blob, qr, calidad }, remitoEsperado, silencioso) {
    const codigo = codigoDeQR(qr);
    let rem = codigo ? remitos.find((r) => r.codigo === codigo) : null;
    if (remitoEsperado && codigo && codigo !== remitoEsperado.codigo) throw new Error(`La foto es del remito ${codigo}, no del ${remitoEsperado.codigo}`);
    if (!rem && remitoEsperado && !codigo) {
      if (!(await confirmarConFoto(blob, remitoEsperado))) throw new Error("Cancelado. Probá otra foto con el QR bien visible.");
      rem = remitoEsperado;
    }
    if (!rem) {
      const motivo = codigo ? `El QR dice ${codigo}, pero ese remito no existe` : "No se pudo leer el QR";
      const ok = await guardarNoReconocida(blob, motivo, calidad);
      throw new Error(ok ? `${motivo}. La foto quedó en “No reconocidas” para asignarla a mano.` : motivo);
    }
    if (rem.estado === "devuelto") throw new Error(`${rem.codigo} ya estaba devuelto: no se subió de nuevo`);
    if (rem.estado === "anulado") throw new Error(`${rem.codigo} está anulado`);
    if (rem.estado === "procesando") throw new Error(`${rem.codigo} ya está confirmado y procesándose en LightData`);
    const res = await procesarFoto(rem, blob, calidad);
    if (!silencioso) toast(`${rem.codigo}: foto guardada. Revisala y confirmala en “Por confirmar”.${res.aviso ? ` Ojo: ${res.aviso.toLowerCase()}.` : ""}`);
    return res;
  }

  // Devuelve { ok, codigo, cliente, msg, aviso }. silencioso = modo tanda (el resultado va a la lista, no al toast)
  async function subirFirmado(file, remitoEsperado, silencioso = false) {
    if (!file) return null;
    setSubiendo(remitoEsperado ? remitoEsperado.codigo : "…");
    let res;
    try { res = await resolverFoto(await leerFoto(file), remitoEsperado, silencioso); await recargar(); }
    catch (e) { res = { ok: false, msg: String(e.message || e) }; if (!silencioso) toast(res.msg); await recargar(); }
    setSubiendo(null);
    return res;
  }

  // Tanda: fotos de la cámara (de a una, "Sacar otra"), varias de la galería o el escáner continuo.
  const [tanda, setTanda] = useState([]); // [{ id, nombre, estado: 'subiendo'|'ok'|'error', codigo, cliente, msg, aviso }]
  const [escaner, setEscaner] = useState(false);
  useEffect(() => { if (pedidoEscaner) setEscaner(true); }, [pedidoEscaner]);
  const inputGaleria = useRef();
  async function subirTanda(files) {
    const lista = [...(files || [])];
    if (!lista.length) return;
    const base = Date.now();
    const items = lista.map((f, i) => ({ id: base + i, nombre: lista.length > 1 ? `Foto ${i + 1}` : "Foto", estado: "subiendo" }));
    setTanda((t) => [...items, ...t].slice(0, 40));
    for (let i = 0; i < lista.length; i++) {
      const r = await subirFirmado(lista[i], null, true);
      setTanda((t) => t.map((x) => (x.id === items[i].id ? { ...x, ...(r || {}), estado: r && r.ok ? "ok" : "error" } : x)));
    }
  }
  // El escáner ya leyó el QR y sacó la foto: va directo a la tanda
  async function desdeEscaner(lectura) {
    const id = Date.now() + Math.random();
    const codigo = codigoDeQR(lectura.qr);
    const rem = codigo ? remitos.find((r) => r.codigo === codigo) : null;
    setTanda((t) => [{ id, nombre: codigo || "Foto", codigo: rem ? rem.codigo : undefined, cliente: rem ? rem.cliente : undefined, estado: "subiendo" }, ...t].slice(0, 40));
    let r;
    try { r = await resolverFoto(lectura, null, true); } catch (e) { r = { ok: false, msg: String(e.message || e) }; }
    setSubiendo(null);
    setTanda((t) => t.map((x) => (x.id === id ? { ...x, ...r, estado: r.ok ? "ok" : "error" } : x)));
    recargar();
    return r;
  }

  // "Repetir" en el escáner: la foto nueva reemplaza a la recién subida de ese remito (la anterior queda guardada)
  async function repetirDesdeEscaner(codigo, { blob, calidad }) {
    const rem = remitos.find((r) => r.codigo === codigo);
    if (!rem) return;
    try {
      const fresco = (await sbFetch(`remitos_devolucion?id=eq.${rem.id}&select=foto_path,fotos_anteriores,estado`))[0] || rem;
      const path = `${rem.codigo}/${Date.now()}.jpg`;
      const up = await authedFetch(`${SUPABASE_URL}/storage/v1/object/remitos-firmados/${path}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!up.ok) throw new Error("No se pudo subir la foto");
      await sbFetch(`remitos_devolucion?id=eq.${rem.id}`, { method: "PATCH", body: JSON.stringify({ foto_path: path, calidad: calidad || null, fotos_anteriores: [...(fresco.fotos_anteriores || []), fresco.foto_path].filter(Boolean) }) });
      setTanda((t) => t.map((x) => (x.codigo === codigo ? { ...x, aviso: textoCalidad(calidad), msg: (x.msg || "") + " · foto repetida" } : x)));
      recargar();
    } catch (e) { toast(`No se pudo repetir la foto de ${codigo}: ${String(e.message || e).slice(0, 60)}`); }
  }

  // No reconocidas: asignar a mano (viendo la foto) o descartar
  async function asignarFallida(f, rem) {
    try {
      const resp = await fetch((await firmarFotos([f.foto_path]))[f.foto_path]);
      const blob = await resp.blob();
      if (!(await confirmarConFoto(blob, rem))) return;
      await procesarFoto(rem, null, f.calidad, f.foto_path);
      await sbFetch(`remitos_fallidos?id=eq.${f.id}`, { method: "PATCH", body: JSON.stringify({ estado: "asignado", remito_codigo: rem.codigo, resuelto_por: yo(), resuelto_at: new Date().toISOString() }) });
      toast(`Foto asignada a ${rem.codigo}. Falta confirmarla en “Por confirmar”.`);
    } catch (e) { toast("No se pudo asignar: " + String(e.message || e).slice(0, 80)); }
    setSubiendo(null);
    await recargar();
  }
  async function descartarFallida(f) {
    try {
      await sbFetch(`remitos_fallidos?id=eq.${f.id}`, { method: "PATCH", body: JSON.stringify({ estado: "descartado", resuelto_por: yo(), resuelto_at: new Date().toISOString() }) });
      await recargar();
    } catch { toast("No se pudo descartar"); }
  }

  const [visorRem, setVisorRem] = useState(null);
  const verFoto = (rem) => setVisorRem(rem);
  // Remito ya devuelto con la foto equivocada: cambia SOLO la imagen (LightData no se vuelve a tocar).
  // La foto anterior queda en fotos_anteriores como registro.
  async function reemplazarFoto(rem, file) {
    if (!file) return;
    setSubiendo(rem.codigo);
    try {
      const { blob, qr } = await leerFoto(file);
      const codigo = codigoDeQR(qr);
      if (codigo && codigo !== rem.codigo) throw new Error(`La foto es del remito ${codigo}, no del ${rem.codigo}`);
      if (!codigo && !(await confirmarConFoto(blob, rem))) throw new Error("Cancelado. Probá otra foto con el QR bien visible.");
      const path = `${rem.codigo}/${Date.now()}.jpg`;
      const up = await authedFetch(`${SUPABASE_URL}/storage/v1/object/remitos-firmados/${path}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!up.ok) throw new Error("No se pudo subir la foto (" + up.status + ")");
      await sbFetch(`remitos_devolucion?id=eq.${rem.id}`, { method: "PATCH", body: JSON.stringify({ foto_path: path, fotos_anteriores: [...(rem.fotos_anteriores || []), rem.foto_path].filter(Boolean) }) });
      registrar("remito_firmado", 0, null, { codigo: rem.codigo, reemplazo_foto: true });
      toast(`Foto de ${rem.codigo} reemplazada. En LightData no cambia nada.`);
      await recargar();
    } catch (e) { toast(String(e.message || e)); }
    setSubiendo(null);
  }
  // Confirmación: recién acá el remito pasa a "procesando" y se le avisa al sync de LightData
  async function confirmarRemitos(rems) {
    if (!rems.length) return;
    try {
      const ahora = new Date().toISOString();
      await sbFetch(`remitos_devolucion?id=in.(${rems.map((r) => r.id).join(",")})&estado=eq.por_confirmar`, { method: "PATCH", body: JSON.stringify({ estado: "procesando", confirmado_por: yo(), confirmado_at: ahora }) });
      rems.forEach((r) => registrar("remito_firmado", (r.dids || []).length, null, { codigo: r.codigo, cliente: r.cliente }));
      const j = await pedirAccion("procesar");
      toast(`${rems.length} remito${rems.length > 1 ? "s" : ""} confirmado${rems.length > 1 ? "s" : ""}. ${j.ok ? "Pasan a “Devuelto al cliente” en LightData en 1–2 minutos." : "Se procesan en la próxima corrida horaria."}`);
    } catch (e) { toast("No se pudo confirmar: " + String(e.message || e).slice(0, 80)); }
    await recargar();
  }
  async function repetirPorConfirmar(rem, file) {
    if (!file) return;
    setSubiendo(rem.codigo);
    try {
      const { blob, qr, calidad } = await leerFoto(file);
      const codigo = codigoDeQR(qr);
      if (codigo && codigo !== rem.codigo) throw new Error(`La foto es del remito ${codigo}, no del ${rem.codigo}`);
      if (!codigo && !(await confirmarConFoto(blob, rem))) throw new Error("Cancelado.");
      await procesarFoto(rem, blob, calidad);
      toast(`Foto de ${rem.codigo} cambiada.`);
    } catch (e) { toast(String(e.message || e)); }
    setSubiendo(null);
    await recargar();
  }
  const panelPC = useRef();
  async function anular(rem) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Anular ${rem.codigo}? Los envíos vuelven a quedar libres para otro remito.`)) return;
    try { await sbFetch(`remitos_devolucion?id=eq.${rem.id}`, { method: "PATCH", body: JSON.stringify({ estado: "anulado" }) }); await recargar(); }
    catch (e) { toast("No se pudo anular"); }
  }

  return (
    <>
      {confirmar && (
        <div className="dv-modal-fondo" onClick={() => cerrarConfirmar(false)}>
          <div className="dv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Confirmar foto del remito">
            <div className="dv-modal-cab">
              <div style={{ fontWeight: 700, fontSize: 16 }}>No pude leer el QR de la foto</div>
              <div style={{ fontSize: 13, color: C.ink2, marginTop: 4 }}>Mirala bien: ¿es el remito <b>{confirmar.rem.codigo}</b> de <b>{confirmar.rem.cliente}</b>, firmado por el cliente?</div>
            </div>
            <div className="dv-modal-cuerpo" style={{ padding: 12 }}>
              <img src={confirmar.url} alt="Foto a subir" style={{ width: "100%", borderRadius: 10, display: "block", background: "#0d0e1c" }} />
            </div>
            <div className="dv-modal-pie" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="dv-btn" onClick={() => cerrarConfirmar(false)}>No, saco otra</button>
              <button className="dv-btn pri" onClick={() => cerrarConfirmar(true)}>Sí, es el remito firmado</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ ...card, padding: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontWeight: 600 }}>Subir remitos firmados</div>
          <div style={{ fontSize: 13, color: C.ink3, marginTop: 2 }}>Sacale una foto con el QR visible. La app reconoce cuál es y la deja “Por confirmar”: cuando terminás, revisás las fotos y confirmás, y recién ahí pasan a “Devuelto al cliente” en LightData.</div>
        </div>
        <input ref={inputGeneral} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { subirTanda(e.target.files); e.target.value = ""; }} />
        <input ref={inputGaleria} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { subirTanda(e.target.files); e.target.value = ""; }} />
        <div className="dv-subir-btns">
          {esCelu && <button className="dv-btn pri dv-btn-grande" disabled={!!subiendo} onClick={() => setEscaner(true)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}><IcoCamara size={18} /> Escanear remitos</button>}
          <button className={"dv-btn dv-btn-grande" + (esCelu ? "" : " pri")} disabled={!!subiendo} onClick={() => inputGeneral.current.click()}>
            {subiendo ? `Subiendo ${subiendo}…` : tanda.length ? "📷 Sacar otra foto" : "📷 Sacar foto"}
          </button>
          {!esCelu && <button className="dv-btn" disabled={!!subiendo} onClick={() => setEscaner(true)} title="Pasá los remitos uno atrás de otro: la cámara reconoce el QR y vos sacás la foto">Modo escáner (varios)</button>}
          <button className="dv-btn" disabled={!!subiendo} onClick={() => inputGaleria.current.click()}>Elegir de la galería</button>
        </div>
        {tanda.length > 0 && (
          <div className="dv-tanda">
            {tanda.map((t) => {
              const rem = t.codigo ? remitos.find((x) => x.codigo === t.codigo) : null;
              const listo = rem && rem.estado === "devuelto";
              const porConf = rem && rem.estado === "por_confirmar";
              const fallo = rem && rem.estado === "error";
              return (
                <div key={t.id} className="dv-tanda-fila">
                  <span className={"dv-tanda-ico " + (t.estado === "error" || fallo ? "mal" : listo ? "ok" : "")}>{t.estado === "subiendo" ? "…" : t.estado === "error" || fallo ? "✕" : listo ? "✓" : "↻"}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <b>{t.codigo ? `${t.codigo} · ${t.cliente}` : t.nombre}</b>
                    <span style={{ display: "block", fontSize: 12, color: t.estado === "error" || fallo ? C.ambar : C.ink3 }}>
                      {t.estado === "subiendo" ? "Leyendo el QR y subiendo…" : fallo ? (rem.error || "LightData no lo pudo procesar") : listo ? "Devuelto al cliente en LightData ✓" : porConf ? "Foto guardada · falta confirmarla abajo" : rem && rem.estado === "procesando" ? "Confirmado · procesando en LightData" : t.msg}
                    </span>
                    {t.aviso && t.estado !== "error" && <span style={{ display: "block", fontSize: 12, color: C.ambar }}>{t.aviso}: revisala antes de confirmar</span>}
                  </span>
                </div>
              );
            })}
            <button className="dv-btn" style={{ alignSelf: "flex-start" }} onClick={() => setTanda([])}>Limpiar lista</button>
          </div>
        )}
      </div>

      {visorRem && <Visor items={[{ path: visorRem.foto_path, titulo: `${visorRem.codigo} · ${visorRem.cliente}`, sub: `${(visorRem.dids || []).length} envíos · ${ESTADO_REMITO[visorRem.estado]} · subido por ${visorRem.firmado_por || "—"}` }]} onCerrar={() => setVisorRem(null)} />}
      <PorConfirmar remitos={remitos} casosDe={casosDe} onConfirmar={confirmarRemitos} onRepetir={repetirPorConfirmar} subiendo={subiendo} refPanel={panelPC} />
      <NoReconocidas fallidos={fallidos} remitos={remitos} onAsignar={asignarFallida} onDescartar={descartarFallida} />
      {escaner && <Escaner remitos={remitos} onLectura={desdeEscaner} onRepetir={repetirDesdeEscaner} onCerrar={() => { setEscaner(false); setTimeout(() => panelPC.current && panelPC.current.scrollIntoView({ behavior: "smooth", block: "start" }), 400); }} />}

      <div className="dv-seg sm" style={{ alignSelf: "flex-start" }}>
        {[["abiertos", "Abiertos"], ["devueltos", "Devueltos · carpetas"]].map(([id, l]) => <button key={id} className={filtro === id ? "on" : ""} onClick={() => setFiltro(id)}>{l}</button>)}
      </div>

      {filtro === "devueltos" ? <Carpetas remitos={remitos} casosDe={casosDe} toast={toast} subiendo={subiendo} onReemplazar={reemplazarFoto} onImprimir={(r) => imprimirRemitos([{ ...r, casos: casosDe(r) }])} /> : <div style={{ ...card, overflow: "hidden" }}>
        {lista.length === 0 && <div style={{ padding: 28, textAlign: "center", color: C.ink3, fontSize: 14 }}>No hay remitos en esta vista. Se arman desde Seguimiento → En depósito, seleccionando envíos.</div>}
        {lista.map((rem) => (
          <RemitoFila key={rem.id} rem={rem} casos={casosDe(rem)} subiendo={subiendo === rem.codigo}
            onSubir={(f) => subirFirmado(f, rem)} onImprimir={() => imprimirRemitos([{ ...rem, casos: casosDe(rem) }])}
            onFoto={() => verFoto(rem)} onAnular={() => anular(rem)} onReemplazar={(f) => reemplazarFoto(rem, f)} />
        ))}
      </div>}
    </>
  );
}

function RemitoFila({ rem, casos, subiendo, onSubir, onImprimir, onFoto, onAnular, onReemplazar }) {
  const input = useRef();
  const res = rem.resultado || {};
  return (
    <div className="dv-fila" style={{ padding: "12px 16px" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: C.grotesk, fontWeight: 700 }}>{rem.codigo}</span>
            <span style={{ fontWeight: 600 }}>{rem.cliente}</span>
          </div>
          <div style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>
            {casos.length} envío{casos.length !== 1 ? "s" : ""} · {fecha(rem.creado_at)} · {rem.creado_por || "—"}{rem.chofer ? ` · chofer ${rem.chofer}` : ""}
            {rem.firmado_at ? ` · firmado subido ${fecha(rem.firmado_at)}` : ""}
          </div>
        </div>
        <span className="dv-tag" style={rem.estado === "devuelto" ? { color: C.teal, borderColor: "rgba(46,230,182,.3)" } : rem.estado === "error" || rem.estado === "por_confirmar" ? { color: C.ambar, borderColor: "rgba(245,192,68,.3)" } : null}>{ESTADO_REMITO[rem.estado]}</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rem.estado !== "anulado" && <button className="dv-btn" onClick={onImprimir}>Imprimir</button>}
          {["emitido", "error"].includes(rem.estado) && (
            <>
              <input ref={input} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { onSubir(e.target.files[0]); e.target.value = ""; }} />
              <button className="dv-btn pri" disabled={subiendo} onClick={() => input.current.click()}>{subiendo ? "Subiendo…" : "Subir firmado"}</button>
            </>
          )}
          {rem.foto_path && <button className="dv-btn" onClick={onFoto}>Ver firma</button>}
          {rem.estado === "devuelto" && <MasAcciones rem={rem} subiendo={subiendo} onReemplazar={onReemplazar} />}
          {rem.estado === "emitido" && <button className="dv-btn" onClick={onAnular}>Anular</button>}
        </div>
      </div>
      {rem.calidad && rem.calidad.problemas && rem.calidad.problemas.length > 0 && <div style={{ fontSize: 12, color: C.ambar, marginTop: 6 }}>{textoCalidad(rem.calidad)}: conviene reemplazarla (⋯ → Reemplazar foto)</div>}
      {rem.estado === "error" && rem.error && <div style={{ fontSize: 12, color: C.ambar, marginTop: 8 }}>{rem.error}. Podés volver a subir la foto para reintentar.</div>}
      {rem.estado === "devuelto" && (res.ok || res.ya_estaban) && <div style={{ fontSize: 12, color: C.ink3, marginTop: 6 }}>{(res.ok || []).length} pasados a devuelto{(res.ya_estaban || []).length ? ` · ${res.ya_estaban.length} ya lo estaban` : ""}{rem.procesado_at ? ` · ${fecha(rem.procesado_at)}` : ""}</div>}
    </div>
  );
}

// Foto → JPEG liviano para guardar + texto del QR (si se pudo leer)
async function leerFoto(file) {
  const bmp = await createImageBitmap(file);
  const lienzo = (lado) => {
    const esc = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.round(bmp.width * esc); cv.height = Math.round(bmp.height * esc);
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    return cv;
  };
  let qr = null;
  if ("BarcodeDetector" in window) {
    try { const d = await new window.BarcodeDetector({ formats: ["qr_code"] }).detect(bmp); qr = (d.find((x) => codigoDeQR(x.rawValue)) || {}).rawValue || null; } catch { /* sigue con jsQR */ }
  }
  for (const lado of [1600, 1000, 2400]) {
    if (qr) break;
    const cv = lienzo(lado);
    const img = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    const r = jsQR(img.data, cv.width, cv.height, { inversionAttempts: "attemptBoth" });
    if (r && codigoDeQR(r.data)) qr = r.data;
  }
  const cv = lienzo(1600);
  const blob = await new Promise((ok) => cv.toBlob(ok, "image/jpeg", 0.72));
  return { blob, qr, calidad: medirCalidad(lienzo(400)) };
}
function medirCalidad(cv) {
  try {
    const { data } = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height);
    const gray = new Float32Array(cv.width * cv.height);
    for (let i = 0, k = 0; k < gray.length; i += 4, k++) gray[k] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return calidadDeImagen(gray, cv.width, cv.height);
  } catch { return null; }
}

// ---------------- Impresión del remito ----------------
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
async function imprimirRemitos(remitos, ventana) {
  const w = ventana || window.open("", "_blank");
  if (!w) { window.alert("El navegador bloqueó la ventana del remito. El remito quedó guardado: imprimilo desde la pestaña Remitos o permití ventanas emergentes para este sitio."); return; }
  w.document.open();
  const fmtDia = (d) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric" }).format(d ? new Date(d) : new Date());
  const hojas = [];
  for (const rem of remitos) {
    const qr = await QRCode.toDataURL(QR_PREFIJO + rem.codigo, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    const filas = rem.casos.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.ml_venta_id || c.tracking || "—")}</td><td>${esc([c.direccion, c.localidad].filter(Boolean).join(", ") || "—")}</td><td>${c.tipo === "CAMBIO" ? "Cambio" : "Cancelado"}${c.tipo === "CAMBIO" && c.li_texto ? `<small>${esc(c.li_texto)}</small>` : ""}</td></tr>`).join("");
    const tabla = `<table><thead><tr><th>#</th><th>Venta / tracking</th><th>Dirección</th><th>Tipo</th></tr></thead><tbody>${filas}</tbody></table>`;
    const chofer = rem.chofer ? `<b>${esc(rem.chofer)}</b>` : `<b class="vacio"></b>`;
    const meta = `<div class="meta"><div><span>Seller</span><b>${esc(rem.cliente)}</b></div><div><span>Fecha</span><b>${fmtDia(rem.creado_at)}</b></div><div><span>Paquetes</span><b>${rem.casos.length}</b></div><div class="ch"><span>Chofer</span>${chofer}</div></div>`;
    const cab = (tipo, der) => `<header><div><div class="marca">FLEXIT</div><div class="tit">${tipo}</div><div class="cod">${esc(rem.codigo)}</div></div>${der}</header>`;
    // Remito chofer: lo firma el chofer al retirar del depósito. Sin QR (no se sube a la app).
    hojas.push(`<section class="hoja">
      ${cab("Remito chofer", `<div class="copia">REMITO CHOFER</div>`)}
      ${meta}${tabla}
      <p class="leyenda">Retiré del depósito de Flexit los ${rem.casos.length} paquete(s) detallados para entregar a <b>${esc(rem.cliente)}</b>.</p>
      <footer class="f4"><div>Firma del chofer</div><div>Aclaración</div><div>DNI</div><div>Fecha y hora de retiro</div></footer>
    </section>`);
    // Remito seller: lo firman el chofer (entregó) y quien recibe (puede ser un empleado). Vuelve a Flexit y se fotografía: lleva el QR.
    hojas.push(`<section class="hoja">
      ${cab("Remito seller", `<div class="qr"><img src="${qr}" alt=""/><div>REMITO SELLER</div></div>`)}
      ${meta}${tabla}
      <p class="leyenda">Recibí conforme los ${rem.casos.length} paquete(s) detallados.</p>
      <footer class="f2">
        <div class="blq"><div class="t">Entregó (chofer)</div><div class="l">Firma</div><div class="l">Aclaración</div></div>
        <div class="blq"><div class="t">Recibió</div><div class="l">Firma</div><div class="l">Aclaración y DNI</div><div class="l">Fecha y hora</div></div>
      </footer>
    </section>`);
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Remitos ${remitos.map((r) => r.codigo).join(" ")}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:0}
    .hoja{page-break-after:always;min-height:265mm;display:flex;flex-direction:column}.hoja:last-child{page-break-after:auto}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px}
    .marca{font-weight:800;letter-spacing:.12em;font-size:13px}.tit{font-size:22px;font-weight:700;margin-top:6px}.cod{font-size:28px;font-weight:800;margin-top:2px;letter-spacing:.02em}
    .qr{text-align:center;font-size:10px;letter-spacing:.15em;color:#444}.qr img{width:38mm;height:38mm;display:block}
    .meta{display:flex;gap:28px;margin:14px 0}.meta span{display:block;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.08em}.meta b{font-size:15px}
    table{width:100%;border-collapse:collapse;font-size:11.5px}th{text-align:left;border-bottom:1px solid #111;padding:6px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#444}td{border-bottom:1px solid #ddd;padding:6px 4px;vertical-align:top}
    td small{display:block;color:#555;font-size:10px;margin-top:2px}
    .meta .ch b{min-width:60mm;display:inline-block}.meta b.vacio{border-bottom:1px solid #111;height:18px}
    .copia{font-size:11px;letter-spacing:.15em;color:#444;border:1px solid #111;padding:6px 10px;border-radius:4px}
    .leyenda{margin-top:18px;font-size:12px}
    footer{margin-top:auto;padding-top:40px}
    footer.f4{display:grid;grid-template-columns:1.4fr 1.2fr 1fr 1fr;gap:16px;padding-top:56px}
    footer.f4 div{border-top:1px solid #111;padding-top:6px;font-size:11px;text-align:center}
    footer.f2{display:grid;grid-template-columns:1fr 1fr;gap:28px}
    .blq .t{font-size:12px;font-weight:700;margin-bottom:6px}.blq .l{border-top:1px solid #111;margin-top:34px;padding-top:5px;font-size:11px}
  </style></head><body>${hojas.join("")}<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}

const CSS = `
.dv-raiz{container:dv / inline-size}
.dv-etapas{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(220px,.75fr);gap:12px}
@container dv (max-width:820px){.dv-etapas{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.dv-otros{grid-column:1/-1;flex-direction:row!important;flex-wrap:wrap}.dv-otro{flex:1 1 180px}}
@container dv (max-width:520px){.dv-etapas{grid-template-columns:minmax(0,1fr)}}
.dv-etapa{padding:16px 18px 14px;cursor:pointer;transition:border-color .12s,background-color .12s;outline:none}
.dv-etapa.on{border-color:rgba(46,230,182,.45)!important;background:linear-gradient(180deg,rgba(46,230,182,.07),rgba(27,28,46,.72) 70%)!important;box-shadow:0 0 0 1px rgba(46,230,182,.12),0 0 35px rgba(0,255,180,.06)}
.dv-etapa:focus-visible{border-color:rgba(46,230,182,.45)!important}
.dv-etapa-sub{display:flex;gap:6px;align-items:center;margin-top:12px;flex-wrap:wrap}
.dv-etapa-sub button{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#a7adc2;font:inherit;font-size:12.5px;padding:5px 10px;border-radius:8px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.dv-etapa-sub button b{color:#f4f5fa;font-weight:600}
.dv-etapa-sub button.on{background:rgba(46,230,182,.12);border-color:rgba(46,230,182,.35);color:#f4f5fa}
.dv-etapa-sub button.v.on{background:rgba(245,192,68,.1);border-color:rgba(245,192,68,.35)}
.dv-otros{display:flex;flex-direction:column;padding:6px;gap:2px}
.dv-otro{display:flex;align-items:center;gap:6px;background:none;border:1px solid transparent;color:#a7adc2;font:inherit;font-size:13px;padding:10px 12px;border-radius:10px;cursor:pointer;text-align:left}
.dv-otro b{color:#f4f5fa;font-weight:600}
.dv-otro.on{background:rgba(46,230,182,.08);border-color:rgba(46,230,182,.3);color:#f4f5fa}
@media (hover:hover){.dv-otro:hover{background:rgba(255,255,255,.04)}}
.dv-info{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;border:1px solid rgba(255,255,255,.2);color:#a7adc2;font-size:10px;font-weight:700;font-style:italic;font-family:Georgia,serif;cursor:default;flex-shrink:0;outline:none}
.dv-tip{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:max-content;max-width:280px;background:#0d0e1c;border:1px solid rgba(255,255,255,.12);color:#e6e8f2;font:400 12.5px/1.45 -apple-system,'Segoe UI',sans-serif;font-style:normal;padding:9px 11px;border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.45);opacity:0;visibility:hidden;transition:opacity .12s;pointer-events:none;z-index:80;text-align:left;white-space:normal}
.dv-info.abajo .dv-tip{bottom:auto;top:calc(100% + 8px);text-transform:none;letter-spacing:normal}
.dv-info:hover .dv-tip,.dv-info:focus .dv-tip{opacity:1;visibility:visible}
.dv-otros .dv-tip{left:auto;right:-10px;transform:none}
.dv-pop{position:absolute;top:calc(100% + 6px);right:0;z-index:60;width:260px;background:#1b1c2e;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:6px;display:flex;flex-direction:column;box-shadow:0 16px 44px rgba(0,0,0,.45)}
.dv-pop>button{background:none;border:0;color:#f4f5fa;font:inherit;font-size:13px;padding:8px 10px;text-align:left;border-radius:8px;cursor:pointer}
.dv-pop>button.on{background:rgba(46,230,182,.1);color:#2ee6b6}
@media (hover:hover){.dv-pop>button:hover{background:rgba(255,255,255,.06)}}
.dv-pop-rango{border-top:1px solid rgba(255,255,255,.07);margin-top:6px;padding:10px 8px 4px}
.dv-pop-rango input{flex:1;min-width:0;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#f4f5fa;font:inherit;font-size:12px;padding:6px;color-scheme:dark}
.dv-franja{border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(255,255,255,.025)}
.dv-franja.ok{border-color:rgba(46,230,182,.3)}
.dv-franja-linea{display:flex;align-items:center;gap:16px;flex-wrap:wrap;width:100%;background:none;border:0;padding:10px 16px;color:#a7adc2;font:inherit;font-size:13px;cursor:pointer;text-align:left}
.dv-fr-item{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}.dv-fr-item b{color:#f4f5fa}.dv-fr-item b.ok{color:#2ee6b6}
.dv-fr-sep{color:#71768e}
.dv-mini{display:inline-block;width:110px;height:6px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}.dv-mini>span{display:block;height:100%;background:#2ee6b6;border-radius:99px}
.dv-franja-det{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:28px;padding:4px 16px 16px;border-top:1px solid rgba(255,255,255,.05);margin-top:2px;padding-top:14px}
@container dv (max-width:820px){.dv-franja-det{grid-template-columns:minmax(0,1fr)}.dv-fr-semana{display:none}}
.dv-racha{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:#a7adc2;white-space:nowrap}
.dv-meta{display:block;width:100%;background:none;border:0;padding:0;margin-top:12px;color:inherit;font:inherit;text-align:left;cursor:pointer}
.dv-meta-t{display:flex;justify-content:space-between;gap:8px;font-size:13px;color:#a7adc2;margin-bottom:6px}.dv-meta-t b{color:#f4f5fa;font-variant-numeric:tabular-nums}
.dv-bar{height:8px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}.dv-bar>div{height:100%;border-radius:999px;transition:width .4s ease}
.dv-sem{display:flex;flex-direction:column;gap:7px;margin-top:10px}
.dv-sem>div{display:grid;grid-template-columns:1fr auto 56px;gap:8px;align-items:baseline;font-size:13px;color:#a7adc2}
.dv-sem b{color:#f4f5fa;font-variant-numeric:tabular-nums;text-align:right}.dv-sem>div>span:last-child{font-size:12px;text-align:right}
.dv-modal.ancho{width:min(860px,100%)}
.dv-rt{display:grid;grid-template-columns:minmax(0,1fr) 52px 52px 52px 52px 52px 76px 92px;gap:8px;align-items:center;padding:10px 18px;font-size:13.5px}
.dv-rt .n{text-align:right;font-variant-numeric:tabular-nums}
.dv-rt-head{font-size:11px;color:#71768e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid rgba(255,255,255,.06);padding-top:8px;padding-bottom:8px}
.dv-rt-fila{border-bottom:1px solid rgba(255,255,255,.05)}.dv-rt-fila>.dv-rt{cursor:pointer}.dv-rt-fila.ab{background:rgba(255,255,255,.025)}.dv-rt-fila.hecho{opacity:.55}
.dv-rec-item{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;color:#c9cde0;padding:3px 0}
@media (max-width:640px){.dv-rt{grid-template-columns:minmax(0,1fr) 40px 40px 40px 70px;padding:10px 12px}.dv-rt-x,.dv-rt>span:nth-child(7){display:none}}
.dv-miga{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13.5px;color:#71768e}
.dv-miga button{background:none;border:0;padding:2px 0;font:inherit;color:#a7adc2;cursor:pointer}.dv-miga button.on{color:#f4f5fa;font-weight:600}
.dv-carpetas{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.dv-carpeta{display:flex;gap:12px;align-items:center;text-align:left;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:12px 14px;color:inherit;font:inherit;cursor:pointer}
@media (hover:hover){.dv-carpeta:hover{border-color:rgba(46,230,182,.3);background:rgba(46,230,182,.04)}}
.dv-carpeta-n{display:block;font-weight:600;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dv-carpeta-s{display:block;font-size:12px;color:#71768e;margin-top:2px}
.dv-fotos{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.dv-foto{border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.02)}
.dv-foto-img{display:flex;align-items:center;justify-content:center;height:220px;background:#0d0e1c;overflow:hidden}
.dv-foto-img img{width:100%;height:100%;object-fit:cover;object-position:top}
.dv-subir-btns{display:flex;gap:8px;flex-wrap:wrap}
.dv-btn-grande{padding:11px 18px;font-size:14px;font-weight:600}
@media (max-width:640px){.dv-subir-btns{width:100%}.dv-subir-btns .dv-btn{flex:1}.dv-btn-grande{flex-basis:100%!important;padding:14px 18px;font-size:15px}}
.dv-pc{border:2px solid transparent;transition:border-color .15s,opacity .15s;opacity:.6}
.dv-pc.on{border-color:rgba(46,230,182,.55);opacity:1}
.dv-pc.dudosa:not(.on){border-color:rgba(245,192,68,.45);opacity:1}
.dv-cadete-link{background:none;border:0;padding:2px 0;font:inherit;font-size:13px;color:#c9cbe0;cursor:pointer;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;border-bottom:1px dashed rgba(255,255,255,.2)}
.dv-cadete-link:hover{color:#2ee6b6;border-bottom-color:#2ee6b6}
.dv-chip-f{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:999px;border:1px solid rgba(46,230,182,.45);background:rgba(46,230,182,.1);color:#2ee6b6;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.dv-visor{position:fixed;inset:0;z-index:9999;background:rgba(6,7,16,.92);display:flex;flex-direction:column;color:#f4f5fa}
.dv-visor-cab{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;flex-wrap:wrap}
.dv-visor-img{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:0 64px 8px;overflow:auto}
.dv-visor-img img{max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;cursor:zoom-in;background:#fff}
.dv-visor-img.zoom{align-items:flex-start;justify-content:flex-start}
.dv-visor-img.zoom img{max-width:none;max-height:none;width:200%;cursor:zoom-out}
.dv-visor-flecha{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:64px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.45);color:#fff;font-size:32px;line-height:1;cursor:pointer}
.dv-visor-flecha.izq{left:12px}.dv-visor-flecha.der{right:12px}
.dv-visor-flecha:disabled{opacity:.25;cursor:default}
.dv-visor-pie{text-align:center;font-size:12px;color:rgba(255,255,255,.45);padding:6px 0 calc(env(safe-area-inset-bottom) + 10px)}
@media (max-width:560px){.dv-visor-img{padding:0 8px 8px}.dv-visor-flecha{top:auto;bottom:34px;transform:none}}
.dv-rd{width:min(860px,100%);margin:0 auto;background:#16172a;border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:18px 20px;color:#f4f5fa}
.dv-rd-cab{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;border-bottom:1px solid rgba(255,255,255,.08);padding-bottom:12px}
.dv-rd-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px 16px;padding:14px 0}
.dv-rd-meta span{display:block;font-size:11.5px;color:#8a8ca6}.dv-rd-meta b{display:block;font-weight:600;font-size:14px}.dv-rd-meta small{display:block;font-size:11.5px;color:#8a8ca6}
.dv-rd-tabla{border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden}
.dv-rd-f{display:grid;grid-template-columns:32px minmax(0,1.2fr) minmax(0,1.5fr) 80px 96px;gap:10px;padding:9px 12px;font-size:13px;align-items:center;border-top:1px solid rgba(255,255,255,.05)}
.dv-rd-f small{display:block;font-size:11.5px;color:#8a8ca6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dv-rd-th{border-top:0;background:rgba(255,255,255,.03);font-size:11px;color:#8a8ca6;text-transform:uppercase;letter-spacing:.05em}
@media (max-width:620px){.dv-rd-f{grid-template-columns:24px minmax(0,1fr) 84px}.dv-rd-f>:nth-child(3),.dv-rd-f>:nth-child(4){display:none}}
.dv-ing-abajo{position:absolute;left:0;right:0;bottom:0;padding:14px 16px calc(env(safe-area-inset-bottom) + 14px);background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.85) 30%);display:flex;flex-direction:column;gap:10px}
.dv-ing-lista{display:flex;flex-direction:column;gap:6px;max-height:30vh;overflow:auto}
.dv-ing-fila{display:flex;gap:10px;align-items:center;color:#fff}
.dv-listo{display:flex;gap:12px;align-items:center;padding:10px 8px;border-top:1px solid rgba(255,255,255,.06);cursor:pointer}
.dv-listo:first-child{border-top:0}
.dv-celu{display:flex;flex-direction:column;gap:10px;position:sticky;top:8px;z-index:20}
.dv-celu-btn{display:flex;align-items:center;gap:14px;width:100%;min-height:68px;padding:12px 16px;border-radius:16px;border:1px solid rgba(46,230,182,.4);background:rgba(18,40,44,.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#2ee6b6;font:inherit;text-align:left;cursor:pointer}
.dv-celu-btn:nth-child(2){border-color:rgba(255,255,255,.14);background:rgba(27,28,46,.92);color:#f4f5fa}
.dv-celu-btn b{display:block;font-size:16px;color:#f4f5fa}.dv-celu-btn small{display:block;font-size:12.5px;color:#a7adc2;margin-top:2px}
.dv-celu-btn:active{transform:scale(.98)}
.dv-celu-pc{border:1px solid rgba(245,192,68,.4);background:rgba(245,192,68,.1);color:#F5C044;border-radius:12px;padding:11px 14px;font:inherit;font-size:14px;font-weight:600;text-align:left;cursor:pointer}
.dv-celu-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dv-celu-stat{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:12px 14px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(27,28,46,.72);color:#a7adc2;font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.dv-celu-stat b{font-family:'Space Grotesk',sans-serif;font-size:24px;color:#f4f5fa;line-height:1.1}
.dv-celu-stat small{font-size:11.5px;color:#F5C044}
.dv-celu-stat.on{border-color:rgba(46,230,182,.45);background:rgba(46,230,182,.07)}
.dv-tanda{width:100%;display:flex;flex-direction:column;gap:8px;border-top:1px solid rgba(255,255,255,.06);padding-top:12px}
.dv-tanda-fila{display:flex;gap:10px;align-items:center;font-size:13.5px}
.dv-tanda-ico{width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;background:rgba(255,255,255,.07);color:#a7adc2;flex-shrink:0}
.dv-tanda-ico.ok{background:rgba(46,230,182,.15);color:#2ee6b6}.dv-tanda-ico.mal{background:rgba(245,192,68,.15);color:#F5C044}
.dv-escaner{position:fixed;inset:0;z-index:90;background:#000;color:#fff;font-family:-apple-system,'Segoe UI',sans-serif}
.dv-escaner-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.dv-escaner-marco{position:absolute;inset:max(90px,12%) 7% max(130px,16%);border:3px solid rgba(255,255,255,.55);border-radius:18px;transition:border-color .15s,box-shadow .15s;pointer-events:none}
.dv-escaner-marco.ok{border-color:#2ee6b6;box-shadow:0 0 0 9999px rgba(46,230,182,.12)}
.dv-escaner-marco.aviso{border-color:#F5C044}
.dv-escaner-marco.flash{box-shadow:0 0 0 9999px rgba(255,255,255,.35)}
.dv-escaner-abajo{position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 16px calc(env(safe-area-inset-bottom) + 18px);background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.8))}
.dv-escaner-ultima{display:flex;gap:10px;align-items:center;width:150px;min-height:64px}
.dv-escaner-ultima img{width:48px;height:64px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.4);flex-shrink:0}
.dv-escaner-disparo{width:76px;height:76px;border-radius:50%;border:5px solid rgba(255,255,255,.45);background:rgba(255,255,255,.25);cursor:pointer;flex-shrink:0;transition:transform .1s}
.dv-escaner-disparo.on{border-color:#fff;background:#2ee6b6}
.dv-escaner-disparo:active{transform:scale(.92)}
.dv-escaner-disparo:disabled{cursor:default}
.dv-escaner-arriba{position:absolute;top:0;left:0;right:0;display:flex;gap:12px;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top) + 14px) 16px 14px;background:linear-gradient(rgba(0,0,0,.75),rgba(0,0,0,0))}
.dv-escaner-flash{position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom) + 28px);transform:translateX(-50%);background:rgba(10,12,24,.9);border:1px solid rgba(46,230,182,.5);color:#fff;border-radius:12px;padding:12px 16px;font-size:15px;font-weight:600;max-width:calc(100vw - 32px);text-align:center}
.dv-escaner-flash.aviso{border-color:rgba(245,192,68,.6)}.dv-escaner-flash.info{border-color:rgba(255,255,255,.3);font-weight:500}
.dv-barra-filtros{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 14px;border:1px solid rgba(255,255,255,.06);border-radius:14px;background:rgba(255,255,255,.02)}
.dv-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:middle}
.dv-seg{display:inline-flex;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:3px}
.dv-seg button{background:none;border:0;color:#a7adc2;font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;cursor:pointer}
.dv-seg.sm button{padding:5px 11px;font-size:12px}
.dv-seg button.on{background:rgba(255,255,255,.08);color:#f4f5fa}
.dv-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#f4f5fa;font:inherit;font-size:13px;padding:7px 12px;border-radius:9px;cursor:pointer;white-space:nowrap}
.dv-btn.pri{background:rgba(46,230,182,.12);border-color:rgba(46,230,182,.3);color:#2ee6b6}
.dv-btn.on{border-color:rgba(255,255,255,.25)}
.dv-btn:disabled{opacity:.5;cursor:default}
.dv-input{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#f4f5fa;font:inherit;font-size:13px;padding:7px 12px;border-radius:9px;min-width:0;flex:1 1 220px;outline:none}
.dv-input:focus{border-color:rgba(46,230,182,.35)}
.dv-head,.dv-linea{display:grid;grid-template-columns:28px minmax(0,1fr) 170px 120px 100px 56px;gap:12px;align-items:center;padding:10px 16px}
.dv-head{font-size:11px;color:#71768e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid rgba(255,255,255,.06)}
.dv-r{text-align:right}
.dv-ord{background:none;border:0;padding:0;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;cursor:pointer;text-align:left}
.dv-ord.dv-r{text-align:right}.dv-ord.on{color:#f4f5fa}
.dv-fila{border-bottom:1px solid rgba(255,255,255,.05)}.dv-fila:last-child{border-bottom:0}
.dv-linea{cursor:pointer}.dv-fila.ab{background:rgba(255,255,255,.025)}
.dv-cb{display:flex;align-items:center;justify-content:center;cursor:pointer}.dv-cb input{width:16px;height:16px;accent-color:#2ee6b6;cursor:pointer}
.dv-tag{font-size:11px;color:#a7adc2;border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:1px 6px}
.dv-tag.mk{color:#F5C044;border-color:rgba(245,192,68,.3)}
.dv-det{padding:4px 16px 16px 56px}
.dv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px 16px}
.dv-show-m{display:none}
@container dv (max-width:700px){.dv-head,.dv-linea{grid-template-columns:24px minmax(0,1fr) 80px 36px;gap:8px;padding:10px 12px}.dv-hide-m{display:none!important}.dv-show-m{display:inline}.dv-det{padding:4px 12px 14px 12px}}
.dv-barra{position:sticky;bottom:12px;margin:0 auto;z-index:50;display:flex;gap:8px;align-items:center;background:rgba(22,23,38,.96);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:10px 12px;box-shadow:0 20px 60px rgba(0,0,0,.45);width:min(720px,100%);flex-wrap:wrap;color:#f4f5fa;font-size:13px}
.dv-menu{position:absolute;bottom:calc(100% + 6px);right:0;background:#1b1c2e;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:4px;display:flex;flex-direction:column;min-width:190px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
.dv-menu button{background:none;border:0;color:#f4f5fa;font:inherit;font-size:13px;padding:8px 10px;text-align:left;border-radius:7px;cursor:pointer}
@media (hover:hover){.dv-menu button:hover{background:rgba(255,255,255,.06)}}
.dv-modal-fondo{position:fixed;inset:0;z-index:70;background:rgba(5,6,14,.66);display:flex;align-items:center;justify-content:center;padding:16px}
.dv-modal{background:#16172a;border:1px solid rgba(255,255,255,.09);border-radius:18px;width:min(600px,100%);max-height:min(86vh,900px);display:flex;flex-direction:column;color:#f4f5fa;box-shadow:0 30px 90px rgba(0,0,0,.55);overflow:hidden}
.dv-modal-cab{padding:18px 18px 14px;border-bottom:1px solid rgba(255,255,255,.06)}
.dv-modal-cuerpo{overflow-y:auto;padding:4px 18px;flex:1;overscroll-behavior:contain}
.dv-modal-pie{padding:12px 18px;border-top:1px solid rgba(255,255,255,.06);font-size:12px;color:#71768e;line-height:1.45}
.dv-x{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#a7adc2;width:32px;height:32px;border-radius:9px;cursor:pointer;font-size:13px}
.dv-rec{padding:12px 0;border-bottom:1px solid rgba(255,255,255,.05)}.dv-rec:last-child{border-bottom:0}
.dv-rec.hecho{opacity:.55}
.dv-rec-fila{display:flex;align-items:center;gap:10px;cursor:pointer}
.dv-rec-acc{display:flex;gap:8px;margin-top:10px}
.dv-chev{color:#71768e;font-size:16px;transition:transform .15s;line-height:1}
.dv-pill{font-size:11px;color:#F5C044;background:rgba(245,192,68,.08);border:1px solid rgba(245,192,68,.25);border-radius:999px;padding:1px 8px}
.dv-prev{white-space:pre-wrap;font-family:inherit;font-size:12.5px;line-height:1.5;color:#c9cde0;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 12px;margin:10px 0 0;max-height:240px;overflow:auto}
.dv-btn.wa{background:rgba(37,211,102,.1);border-color:rgba(37,211,102,.28);color:#5be38f}
@media (max-width:560px){.dv-modal-fondo{align-items:flex-end;padding:0}.dv-modal{border-radius:18px 18px 0 0;max-height:92vh}.dv-rec-acc .dv-btn{flex:1}}
.dv-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:60;background:#f4f5fa;color:#111;border-radius:10px;padding:10px 14px;font-size:13px;max-width:calc(100vw - 32px);box-shadow:0 12px 40px rgba(0,0,0,.35)}
`;
