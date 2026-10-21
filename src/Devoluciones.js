import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { authedFetch, getSession } from "./auth";
import { sbFetch } from "./colectasShared";
import {
  armarCasos, resumen, ordenar, MARCAS, LIMITE_CALLE, LIMITE_DEPOSITO,
  QR_PREFIJO, codigoDeQR, agruparParaRemitos, reclamosPorCadete, mensajeReclamo, CHOFER_FICTICIO,
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
const pedirAccion = (accion) => authedFetch(`${SUPABASE_URL}/functions/v1/devoluciones-accion`, { method: "POST", body: JSON.stringify({ accion }) })
  .then((r) => r.json()).catch(() => ({ ok: false, motivo: "red" }));

const ETAPAS = [
  ["calle", "En la calle"], ["deposito", "En depósito"], ["retiro", "Cambios por retirar"],
  ["devuelto", "Devueltos al cliente"], ["marcados", "Etiquetados"],
];
const TIPOS = [["todos", "Todos"], ["CANCELADO", "Cancelados"], ["CAMBIO", "Cambios"]];

export default function Devoluciones() {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("seguimiento");
  const [etapa, setEtapa] = useState("calle");
  const [tipo, setTipo] = useState("todos");
  const [soloVencidos, setSoloVencidos] = useState(false);
  const [busca, setBusca] = useState("");
  const [abierto, setAbierto] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [verReclamos, setVerReclamos] = useState(false);
  const enCurso = useRef(false);

  const cargar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      const [dev, gest, rem, sync] = await Promise.all([
        traerTodo("devoluciones?select=*&order=did"),
        traerTodo("devoluciones_gestion?select=*"),
        sbFetch("remitos_devolucion?select=*&order=id.desc&limit=300"),
        sbFetch("devoluciones_sync?select=*&id=eq.1"),
      ]);
      setDatos({ dev, gest, rem, sync: sync[0] || null });
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
    (datos ? datos.rem : []).filter((x) => ["emitido", "procesando", "error"].includes(x.estado))
      .forEach((x) => (x.dids || []).forEach((d) => m.set(Number(d), x)));
    return m;
  }, [datos]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return casos.filter((c) => {
      if (etapa === "marcados" ? !c.marca : c.etapa !== etapa || (c.cerrado && etapa !== "devuelto")) return false;
      if (tipo !== "todos" && c.tipo !== tipo) return false;
      if (soloVencidos && !c.vencido) return false;
      if (!q) return true;
      return [c.cliente, c.ml_venta_id, c.tracking, c.cadete, String(c.did), c.li_texto].some((v) => String(v || "").toLowerCase().includes(q));
    }).sort(ordenar);
  }, [casos, etapa, tipo, soloVencidos, busca]);

  useEffect(() => { setSel(new Set()); setAbierto(null); }, [etapa, tipo, soloVencidos, tab]);
  const toast = (t) => { setAviso(t); setTimeout(() => setAviso((a) => (a === t ? null : a)), 4500); };

  const irA = (e, vencidos = false) => { setTab("seguimiento"); setEtapa(e); setSoloVencidos(vencidos); setTipo("todos"); };
  const seleccionados = lista.filter((c) => sel.has(c.did));

  async function marcarIngreso(cs, deshacer = false) {
    setOcupado(true);
    try {
      await guardarGestion(cs.map((c) => ({ did: c.did, ingreso_deposito_at: deshacer ? null : new Date().toISOString(), ingreso_por: deshacer ? null : yo() })));
      toast(deshacer ? "Ingreso deshecho" : `${cs.length} cambio${cs.length > 1 ? "s" : ""} en depósito`);
      setSel(new Set()); await cargar();
    } catch (e) { toast("No se pudo guardar: " + String(e.message).slice(0, 80)); }
    setOcupado(false);
  }
  async function etiquetar(cs, marca, nota) {
    setOcupado(true);
    try {
      await guardarGestion(cs.map((c) => ({ did: c.did, marca: marca || null, marca_nota: marca ? nota || null : null, marca_por: marca ? yo() : null, marca_at: marca ? new Date().toISOString() : null })));
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
      await cargar();
    } catch { /* el mensaje ya se copió; el registro se reintenta la próxima vez */ }
    toast(via === "wa" ? `Reclamo a ${cadete.split(" ")[0]} registrado` : `Mensaje copiado. Pegalo en el WhatsApp de ${cadete.split(" ")[0]}.`);
  }
  async function armarRemitos(cs) {
    const libres = cs.filter((c) => !remitoDe.has(c.did));
    if (!libres.length) { toast("Esos envíos ya están en un remito abierto"); return; }
    const previa = agruparParaRemitos(libres);
    const yaEnRemito = cs.length - libres.length;
    const texto = previa.length === 1
      ? `Se arma 1 remito para ${previa[0].cliente} con ${previa[0].casos.length} envío(s).`
      : `Se arman ${previa.length} remitos, uno por cliente (cada cliente firma el suyo):\n\n${previa.map((g) => `• ${g.cliente}: ${g.casos.length} envío(s)`).join("\n")}`;
    if (!window.confirm(texto + (yaEnRemito ? `\n\n${yaEnRemito} envío(s) ya estaban en otro remito y no se incluyen.` : "") + "\n\n¿Continuar?")) return;
    // La ventana se abre YA, en el clic: si se abre después de guardar, el navegador la bloquea
    const w = window.open("", "_blank");
    if (w) w.document.write("<p style='font-family:sans-serif;padding:24px'>Armando remito…</p>");
    setOcupado(true);
    try {
      const grupos = agruparParaRemitos(libres);
      const creados = [];
      for (const g of grupos) {
        const [row] = await sbFetch("remitos_devolucion", { method: "POST", body: JSON.stringify({ cliente: g.cliente, dids: g.casos.map((c) => c.did), creado_por: yo() }) });
        creados.push({ ...row, casos: g.casos });
      }
      await imprimirRemitos(creados, w);
      toast(`${creados.length} remito${creados.length > 1 ? "s" : ""} generado${creados.length > 1 ? "s" : ""} (uno por cliente). También quedan en la pestaña Remitos.`);
      setSel(new Set()); await cargar();
    } catch (e) { if (w) w.close(); toast("No se pudo armar el remito: " + String(e.message).slice(0, 100)); }
    setOcupado(false);
  }
  const casosDeRemito = (rem) => { const m = new Map(casos.map((c) => [Number(c.did), c])); return (rem.dids || []).map((d) => m.get(Number(d)) || { did: d }); };

  async function actualizar() {
    const j = await pedirAccion("sync");
    toast(j.ok ? "Pedido enviado: LightData se relee en 1–2 minutos" : j.motivo === "reciente" ? "Ya se pidió hace un momento, esperá un par de minutos" : "No se pudo pedir la actualización");
  }

  if (!datos && !error) return <div style={{ padding: 24, color: C.ink3 }}>Cargando devoluciones…</div>;
  if (!datos && error) return <div style={{ padding: 24, color: C.ink2 }}>No se pudieron leer las devoluciones. {error}</div>;

  const sync = datos.sync || {};
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, color: C.ink, paddingBottom: 90 }}>
      <style>{CSS}</style>

      {/* Totales */}
      <div className="dv-kpis">
        <Kpi titulo="En la calle" valor={r.calle} sub={plata(r.calleValor) + " declarado"} onClick={() => irA("calle")} activo={tab === "seguimiento" && etapa === "calle" && !soloVencidos} />
        <Kpi titulo="En depósito" valor={r.deposito} sub="falta devolver al cliente" onClick={() => irA("deposito")} activo={tab === "seguimiento" && etapa === "deposito" && !soloVencidos} />
        <Kpi titulo={`En la calle +${LIMITE_CALLE} días`} valor={r.calleVencidos} sub="desde la cancelación" alerta={r.calleVencidos > 0} onClick={() => irA("calle", true)} activo={tab === "seguimiento" && etapa === "calle" && soloVencidos} />
        <Kpi titulo={`En depósito +${LIMITE_DEPOSITO} días`} valor={r.depositoVencidos} sub="desde que ingresó" alerta={r.depositoVencidos > 0} onClick={() => irA("deposito", true)} activo={tab === "seguimiento" && etapa === "deposito" && soloVencidos} />
      </div>

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
        <button className="dv-btn" onClick={actualizar}>Pedir actualización</button>
      </div>

      {tab === "seguimiento" ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="dv-chips">
              {ETAPAS.map(([id, lbl]) => {
                const n = id === "marcados" ? r.marcados : id === "devuelto" ? r.devueltos : r[id];
                return <button key={id} className={etapa === id ? "on" : ""} onClick={() => { setEtapa(id); setSoloVencidos(false); }}>{lbl} <b>{num(n)}</b></button>;
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <div className="dv-seg sm">
              {TIPOS.map(([id, lbl]) => <button key={id} className={tipo === id ? "on" : ""} onClick={() => setTipo(id)}>{lbl}</button>)}
            </div>
            {(etapa === "calle" || etapa === "deposito") && (
              <label className="dv-check"><input type="checkbox" checked={soloVencidos} onChange={(e) => setSoloVencidos(e.target.checked)} /> Solo +{etapa === "calle" ? LIMITE_CALLE : LIMITE_DEPOSITO} días</label>
            )}
            <input className="dv-input" placeholder="Buscar cliente, venta, tracking o cadete" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>

          {etapa === "calle" && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: C.ink3 }}>Mandale a cada cadete un solo mensaje con todo lo que tiene que traer.</span>
              <button className="dv-btn pri" onClick={() => setVerReclamos(true)}>Reclamar a cadetes</button>
            </div>
          )}
          <div style={{ ...card, overflow: "hidden" }}>
            <div className="dv-head">
              <label className="dv-cb"><input type="checkbox" checked={lista.length > 0 && lista.every((c) => sel.has(c.did))} onChange={(e) => setSel(e.target.checked ? new Set(lista.map((c) => c.did)) : new Set())} /></label>
              <span>Envío</span><span className="dv-hide-m">Cadete</span><span className="dv-r">Valor</span><span className="dv-r">Días</span>
            </div>
            {lista.length === 0 && <div style={{ padding: 28, textAlign: "center", color: C.ink3, fontSize: 14 }}>Nada en esta vista.</div>}
            {lista.slice(0, 400).map((c) => (
              <Fila key={c.did} c={c} remito={remitoDe.get(c.did)} abierto={abierto === c.did} marcado={sel.has(c.did)}
                onToggle={() => setAbierto(abierto === c.did ? null : c.did)}
                onSel={(v) => setSel((s) => { const n = new Set(s); v ? n.add(c.did) : n.delete(c.did); return n; })}
                onIngreso={(deshacer) => marcarIngreso([c], deshacer)} onEtiqueta={(m, nota) => etiquetar([c], m, nota)} ocupado={ocupado}
                onReclamar={() => reclamar(c.cadete, [c])} />
            ))}
            {lista.length > 400 && <div style={{ padding: 12, textAlign: "center", color: C.ink3, fontSize: 12 }}>Mostrando 400 de {num(lista.length)}. Usá el buscador para acotar.</div>}
          </div>

          {seleccionados.length > 0 && (
            <div className="dv-barra">
              <span><b>{seleccionados.length}</b> seleccionado{seleccionados.length > 1 ? "s" : ""}</span>
              <div style={{ flex: 1 }} />
              {etapa === "deposito" && <button className="dv-btn pri" disabled={ocupado} onClick={() => armarRemitos(seleccionados)}>Armar remito</button>}
              {etapa === "calle" && seleccionados.some((c) => c.tipo === "CAMBIO") && (
                <button className="dv-btn pri" disabled={ocupado} onClick={() => marcarIngreso(seleccionados.filter((c) => c.tipo === "CAMBIO"))}>Ingresó a depósito</button>
              )}
              <EtiquetaMenu onElegir={(m) => etiquetar(seleccionados, m)} disabled={ocupado} />
              <button className="dv-btn" onClick={() => setSel(new Set())}>Cancelar</button>
            </div>
          )}
        </>
      ) : (
        <Remitos remitos={datos.rem} casosDe={casosDeRemito} recargar={cargar} toast={toast} />
      )}

      {verReclamos && <ReclamosModal grupos={reclamosPorCadete(casos)} onEnviar={reclamar} onCerrar={() => setVerReclamos(false)} />}
      {aviso && <div className="dv-toast">{aviso}</div>}
    </div>
  );
}

function Kpi({ titulo, valor, sub, alerta, onClick, activo }) {
  return (
    <button onClick={onClick} className={"dv-kpi" + (activo ? " on" : "")} style={card}>
      <div style={{ fontSize: 12, color: C.ink3, display: "flex", alignItems: "center", gap: 6 }}>
        {alerta && <span className="dv-dot" style={{ background: C.ambar, margin: 0 }} />}{titulo}
      </div>
      <div style={{ fontFamily: C.grotesk, fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", marginTop: 4 }}>{num(valor)}</div>
      <div style={{ fontSize: 12, color: C.ink3, marginTop: 2 }}>{sub}</div>
    </button>
  );
}

function Fila({ c, remito, abierto, marcado, onToggle, onSel, onIngreso, onEtiqueta, onReclamar, ocupado }) {
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
          <div style={{ fontSize: 12, color: C.ink3, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.ml_venta_id ? `Venta ${c.ml_venta_id}` : `Tracking ${c.tracking || "—"}`} · #{c.did}<span className="dv-show-m"> · {c.cadete || "—"}</span>
          </div>
        </div>
        <span className="dv-hide-m" style={{ fontSize: 13, color: C.ink2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.cadete || "—"}</span>
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
            {c.etapa === "calle" && c.cadete && !CHOFER_FICTICIO.test(c.cadete) && <button className="dv-btn" disabled={ocupado} onClick={onReclamar}>Copiar reclamo</button>}
            {c.tipo === "CAMBIO" && c.etapa !== "devuelto" && (c.ingreso_deposito_at
              ? <button className="dv-btn" disabled={ocupado} onClick={() => onIngreso(true)}>Deshacer ingreso</button>
              : <button className="dv-btn pri" disabled={ocupado} onClick={() => onIngreso(false)}>Ingresó a depósito</button>)}
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

function ReclamosModal({ grupos, onEnviar, onCerrar }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [abierto, setAbierto] = useState(null);
  const [enviados, setEnviados] = useState(() => new Map()); // cadete → hora
  const hoyISO = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const reales = grupos.filter((g) => g.cadete).map((g) => {
    const ult = g.casos.map((c) => c.reclamo_at).filter(Boolean).sort().pop() || null;
    return { ...g, ultimo: ult, hoy: !!ult && new Date(Date.parse(ult) - 3 * 3600e3).toISOString().slice(0, 10) === hoyISO };
  }).sort((a, b) => b.casos.length - a.casos.length || b.vencidos - a.vencidos || b.valor - a.valor);
  const sinCadete = grupos.find((g) => !g.cadete);
  const q = busca.trim().toLowerCase();
  const lista = reales.filter((g) => (!q || g.cadete.toLowerCase().includes(q))
    && (filtro === "vencidos" ? g.vencidos > 0 : filtro === "pendientes" ? !g.hoy && !enviados.has(g.cadete) : true));
  const tot = reales.reduce((a, g) => ({ p: a.p + g.casos.length, v: a.v + g.valor }), { p: 0, v: 0 });
  const enviar = async (g, via) => { await onEnviar(g.cadete, g.casos, via); setEnviados((m) => new Map(m).set(g.cadete, new Date().toISOString())); };

  useEffect(() => {
    const esc = (e) => { if (e.key === "Escape") onCerrar(); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onCerrar]);

  return (
    <div className="dv-modal-fondo" onClick={onCerrar}>
      <div className="dv-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reclamar a cadetes">
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

        <div className="dv-modal-cuerpo">
          {lista.length === 0 && <div style={{ color: C.ink3, fontSize: 14, padding: "24px 4px", textAlign: "center" }}>{reales.length ? "Nadie en este filtro." : "No hay nada en la calle para reclamar."}</div>}
          {lista.map((g) => {
            const env = enviados.get(g.cadete);
            const ab = abierto === g.cadete;
            return (
              <div key={g.cadete} className={"dv-rec" + (env ? " hecho" : "")}>
                <div className="dv-rec-fila" onClick={() => setAbierto(ab ? null : g.cadete)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{g.cadete}</span>
                      {g.vencidos > 0 && <span className="dv-pill">{g.vencidos} con +{LIMITE_CALLE} d</span>}
                    </div>
                    <div style={{ fontSize: 12, color: C.ink3, marginTop: 3 }}>
                      {g.casos.length} paquete{g.casos.length > 1 ? "s" : ""} · {plata(g.valor)} · {env ? `copiado ${fecha(env).split(", ")[1] || ""}` : g.ultimo ? `último reclamo ${hace(g.ultimo)}` : "nunca reclamado"}
                    </div>
                  </div>
                  <span className="dv-chev" style={{ transform: ab ? "rotate(180deg)" : "none" }}>⌄</span>
                </div>
                {ab && <pre className="dv-prev">{mensajeReclamo(g.cadete, g.casos)}</pre>}
                <div className="dv-rec-acc">
                  <button className={"dv-btn" + (env ? "" : " pri")} onClick={() => enviar(g, "copiar")}>{env ? "Copiado ✓ · copiar de nuevo" : "Copiar mensaje"}</button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="dv-modal-pie">
          “Copiar mensaje” lo deja listo para pegar en el WhatsApp del cadete. Al copiarlo, esos paquetes quedan como reclamados.
          {sinCadete ? ` ${sinCadete.casos.length} paquete(s) sin cadete real (sin asignar, “Repro gramar”, “Desasignado”) no se pueden reclamar: revisalos en LightData.` : ""}
        </div>
      </div>
    </div>
  );
}

// ---------------- Remitos ----------------
const ESTADO_REMITO = { emitido: "Esperando firma", procesando: "Procesando en LightData", devuelto: "Devuelto al cliente", error: "Con error", anulado: "Anulado" };

function Remitos({ remitos, casosDe, recargar, toast }) {
  const [filtro, setFiltro] = useState("abiertos");
  const [subiendo, setSubiendo] = useState(null); // codigo en curso
  const inputGeneral = useRef();
  const lista = remitos.filter((r) => (filtro === "abiertos" ? ["emitido", "procesando", "error"].includes(r.estado) : filtro === "devueltos" ? r.estado === "devuelto" : true));

  async function subirFirmado(file, remitoEsperado) {
    if (!file) return;
    setSubiendo(remitoEsperado ? remitoEsperado.codigo : "…");
    try {
      const { blob, qr } = await leerFoto(file);
      const codigo = codigoDeQR(qr);
      let rem = codigo ? remitos.find((r) => r.codigo === codigo) : null;
      if (codigo && !rem) throw new Error(`El QR dice ${codigo}, pero ese remito no existe`);
      if (remitoEsperado && codigo && codigo !== remitoEsperado.codigo) throw new Error(`La foto es del remito ${codigo}, no del ${remitoEsperado.codigo}`);
      if (!rem && remitoEsperado) {
        // eslint-disable-next-line no-alert
        if (!window.confirm(`No pude leer el QR de la foto.\n\n¿Confirmás que es el remito ${remitoEsperado.codigo} de ${remitoEsperado.cliente}, firmado?`)) throw new Error("Cancelado. Probá otra foto con el QR bien visible.");
        rem = remitoEsperado;
      }
      if (!rem) throw new Error("No pude leer el QR. Sacá la foto de nuevo con el QR entero y nítido, o subila desde la fila del remito.");
      if (rem.estado === "devuelto") throw new Error(`El remito ${rem.codigo} ya figura devuelto`);
      if (rem.estado === "anulado") throw new Error(`El remito ${rem.codigo} está anulado`);
      setSubiendo(rem.codigo);
      const path = `${rem.codigo}/${Date.now()}.jpg`;
      const up = await authedFetch(`${SUPABASE_URL}/storage/v1/object/remitos-firmados/${path}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
      if (!up.ok) throw new Error("No se pudo subir la foto (" + up.status + ")");
      await sbFetch(`remitos_devolucion?id=eq.${rem.id}`, { method: "PATCH", body: JSON.stringify({ estado: "procesando", foto_path: path, firmado_por: yo(), firmado_at: new Date().toISOString(), error: null }) });
      const j = await pedirAccion("procesar");
      toast(j.ok ? `${rem.codigo} recibido. Se pasa a "Devuelto al cliente" en LightData en 1–2 minutos.` : `${rem.codigo} guardado, pero no se pudo avisar a LightData (${j.motivo}). Se procesa en la próxima corrida horaria.`);
      await recargar();
    } catch (e) { toast(String(e.message || e)); }
    setSubiendo(null);
  }

  async function verFoto(rem) {
    const r = await authedFetch(`${SUPABASE_URL}/storage/v1/object/sign/remitos-firmados/${rem.foto_path}`, { method: "POST", body: JSON.stringify({ expiresIn: 600 }) });
    const j = await r.json().catch(() => ({}));
    if (j.signedURL) window.open(`${SUPABASE_URL}/storage/v1${j.signedURL}`, "_blank", "noopener");
    else toast("No se pudo abrir la foto");
  }
  async function anular(rem) {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`¿Anular ${rem.codigo}? Los envíos vuelven a quedar libres para otro remito.`)) return;
    try { await sbFetch(`remitos_devolucion?id=eq.${rem.id}`, { method: "PATCH", body: JSON.stringify({ estado: "anulado" }) }); await recargar(); }
    catch (e) { toast("No se pudo anular"); }
  }

  return (
    <>
      <div style={{ ...card, padding: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontWeight: 600 }}>Subir remito firmado</div>
          <div style={{ fontSize: 13, color: C.ink3, marginTop: 2 }}>Sacale una foto con el QR visible. La app reconoce el remito y pasa sus envíos a “Devuelto al cliente” en LightData.</div>
        </div>
        <input ref={inputGeneral} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { subirFirmado(e.target.files[0], null); e.target.value = ""; }} />
        <button className="dv-btn pri" disabled={!!subiendo} onClick={() => inputGeneral.current.click()}>{subiendo ? `Subiendo ${subiendo}…` : "Sacar foto / elegir archivo"}</button>
      </div>

      <div className="dv-seg sm" style={{ alignSelf: "flex-start" }}>
        {[["abiertos", "Abiertos"], ["devueltos", "Devueltos"], ["todos", "Todos"]].map(([id, l]) => <button key={id} className={filtro === id ? "on" : ""} onClick={() => setFiltro(id)}>{l}</button>)}
      </div>

      <div style={{ ...card, overflow: "hidden" }}>
        {lista.length === 0 && <div style={{ padding: 28, textAlign: "center", color: C.ink3, fontSize: 14 }}>No hay remitos en esta vista. Se arman desde Seguimiento → En depósito, seleccionando envíos.</div>}
        {lista.map((rem) => (
          <RemitoFila key={rem.id} rem={rem} casos={casosDe(rem)} subiendo={subiendo === rem.codigo}
            onSubir={(f) => subirFirmado(f, rem)} onImprimir={() => imprimirRemitos([{ ...rem, casos: casosDe(rem) }])}
            onFoto={() => verFoto(rem)} onAnular={() => anular(rem)} />
        ))}
      </div>
    </>
  );
}

function RemitoFila({ rem, casos, subiendo, onSubir, onImprimir, onFoto, onAnular }) {
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
            {casos.length} envío{casos.length !== 1 ? "s" : ""} · {fecha(rem.creado_at)} · {rem.creado_por || "—"}
            {rem.firmado_at ? ` · firmado subido ${fecha(rem.firmado_at)}` : ""}
          </div>
        </div>
        <span className="dv-tag" style={rem.estado === "devuelto" ? { color: C.teal, borderColor: "rgba(46,230,182,.3)" } : rem.estado === "error" ? { color: C.ambar, borderColor: "rgba(245,192,68,.3)" } : null}>{ESTADO_REMITO[rem.estado]}</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {rem.estado !== "anulado" && <button className="dv-btn" onClick={onImprimir}>Imprimir</button>}
          {["emitido", "error"].includes(rem.estado) && (
            <>
              <input ref={input} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { onSubir(e.target.files[0]); e.target.value = ""; }} />
              <button className="dv-btn pri" disabled={subiendo} onClick={() => input.current.click()}>{subiendo ? "Subiendo…" : "Subir firmado"}</button>
            </>
          )}
          {rem.foto_path && <button className="dv-btn" onClick={onFoto}>Ver firma</button>}
          {rem.estado === "emitido" && <button className="dv-btn" onClick={onAnular}>Anular</button>}
        </div>
      </div>
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
  return { blob, qr };
}

// ---------------- Impresión del remito ----------------
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
async function imprimirRemitos(remitos, ventana) {
  const w = ventana || window.open("", "_blank");
  if (!w) { window.alert("El navegador bloqueó la ventana del remito. El remito quedó guardado: imprimilo desde la pestaña Remitos o permití ventanas emergentes para este sitio."); return; }
  w.document.open();
  const hoy = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  const hojas = [];
  for (const rem of remitos) {
    const qr = await QRCode.toDataURL(QR_PREFIJO + rem.codigo, { margin: 1, width: 320, errorCorrectionLevel: "M" });
    const filas = rem.casos.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.ml_venta_id || "—")}</td><td>${esc(c.tracking || "—")}</td><td>${c.tipo === "CAMBIO" ? "Cambio" : "Cancelado"}</td><td>${esc(c.tipo === "CAMBIO" ? c.li_texto || "" : "")}</td></tr>`).join("");
    for (const copia of ["ORIGINAL", "DUPLICADO"]) {
      hojas.push(`<section class="hoja">
        <header><div><div class="marca">FLEXIT</div><div class="tit">Remito de devolución</div><div class="cod">${esc(rem.codigo)}</div></div>
          <div class="qr"><img src="${qr}" alt=""/><div>${copia}</div></div></header>
        <div class="meta"><div><span>Cliente</span><b>${esc(rem.cliente)}</b></div><div><span>Fecha</span><b>${hoy}</b></div><div><span>Cantidad</span><b>${rem.casos.length}</b></div></div>
        <table><thead><tr><th>#</th><th>Venta</th><th>Tracking</th><th>Tipo</th><th>Detalle</th></tr></thead><tbody>${filas}</tbody></table>
        <p class="leyenda">Recibí conforme los ${rem.casos.length} paquete(s) detallados.</p>
        <footer><div>Nombre y apellido</div><div>DNI</div><div>Firma</div><div>Fecha de recepción</div></footer>
      </section>`);
    }
  }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Remitos ${remitos.map((r) => r.codigo).join(" ")}</title><style>
    @page{size:A4;margin:14mm}*{box-sizing:border-box}body{font-family:Helvetica,Arial,sans-serif;color:#111;margin:0}
    .hoja{page-break-after:always;min-height:265mm;display:flex;flex-direction:column}.hoja:last-child{page-break-after:auto}
    header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px}
    .marca{font-weight:800;letter-spacing:.12em;font-size:13px}.tit{font-size:22px;font-weight:700;margin-top:6px}.cod{font-size:28px;font-weight:800;margin-top:2px;letter-spacing:.02em}
    .qr{text-align:center;font-size:10px;letter-spacing:.15em;color:#444}.qr img{width:38mm;height:38mm;display:block}
    .meta{display:flex;gap:28px;margin:14px 0}.meta span{display:block;font-size:10px;color:#666;text-transform:uppercase;letter-spacing:.08em}.meta b{font-size:15px}
    table{width:100%;border-collapse:collapse;font-size:11.5px}th{text-align:left;border-bottom:1px solid #111;padding:6px 4px;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#444}td{border-bottom:1px solid #ddd;padding:6px 4px;vertical-align:top}
    .leyenda{margin-top:18px;font-size:12px}footer{margin-top:auto;display:grid;grid-template-columns:1.4fr 1fr 1.2fr 1fr;gap:16px;padding-top:56px}
    footer div{border-top:1px solid #111;padding-top:6px;font-size:11px;text-align:center}
  </style></head><body>${hojas.join("")}<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>`);
  w.document.close();
}

const CSS = `
.dv-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
@media (max-width:820px){.dv-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.dv-kpi{text-align:left;padding:16px 18px;cursor:pointer;color:inherit;font-family:inherit;transition:border-color .12s}
.dv-kpi.on{border-color:rgba(46,230,182,.35)!important}
.dv-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px;vertical-align:middle}
.dv-seg{display:inline-flex;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:3px}
.dv-seg button{background:none;border:0;color:#a7adc2;font:inherit;font-size:13px;padding:7px 14px;border-radius:8px;cursor:pointer}
.dv-seg.sm button{padding:5px 11px;font-size:12px}
.dv-seg button.on{background:rgba(255,255,255,.08);color:#f4f5fa}
.dv-chips{display:flex;gap:6px;flex-wrap:wrap}
.dv-chips button{background:transparent;border:1px solid rgba(255,255,255,.08);color:#a7adc2;font:inherit;font-size:13px;padding:6px 12px;border-radius:999px;cursor:pointer}
.dv-chips button b{color:#f4f5fa;font-weight:600;margin-left:4px}
.dv-chips button.on{border-color:rgba(46,230,182,.35);color:#f4f5fa;background:rgba(46,230,182,.06)}
.dv-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#f4f5fa;font:inherit;font-size:13px;padding:7px 12px;border-radius:9px;cursor:pointer;white-space:nowrap}
.dv-btn.pri{background:rgba(46,230,182,.12);border-color:rgba(46,230,182,.3);color:#2ee6b6}
.dv-btn.on{border-color:rgba(255,255,255,.25)}
.dv-btn:disabled{opacity:.5;cursor:default}
.dv-input{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:#f4f5fa;font:inherit;font-size:13px;padding:7px 12px;border-radius:9px;min-width:0;flex:1 1 220px;outline:none}
.dv-input:focus{border-color:rgba(46,230,182,.35)}
.dv-check{font-size:13px;color:#a7adc2;display:flex;gap:6px;align-items:center;cursor:pointer}
.dv-head,.dv-linea{display:grid;grid-template-columns:28px minmax(0,1fr) 170px 100px 56px;gap:12px;align-items:center;padding:10px 16px}
.dv-head{font-size:11px;color:#71768e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid rgba(255,255,255,.06)}
.dv-r{text-align:right}
.dv-fila{border-bottom:1px solid rgba(255,255,255,.05)}.dv-fila:last-child{border-bottom:0}
.dv-linea{cursor:pointer}.dv-fila.ab{background:rgba(255,255,255,.025)}
.dv-cb{display:flex;align-items:center;justify-content:center;cursor:pointer}.dv-cb input{width:16px;height:16px;accent-color:#2ee6b6;cursor:pointer}
.dv-tag{font-size:11px;color:#a7adc2;border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:1px 6px}
.dv-tag.mk{color:#F5C044;border-color:rgba(245,192,68,.3)}
.dv-det{padding:4px 16px 16px 56px}
.dv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px 16px}
.dv-show-m{display:none}
@media (max-width:700px){.dv-head,.dv-linea{grid-template-columns:24px minmax(0,1fr) 80px 36px;gap:8px;padding:10px 12px}.dv-hide-m{display:none}.dv-show-m{display:inline}.dv-det{padding:4px 12px 14px 12px}}
.dv-barra{position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:50;display:flex;gap:8px;align-items:center;background:rgba(22,23,38,.96);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:10px 12px;box-shadow:0 20px 60px rgba(0,0,0,.45);width:min(720px,calc(100vw - 32px));flex-wrap:wrap;color:#f4f5fa;font-size:13px}
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
