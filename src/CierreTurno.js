import React, { useState, useEffect, useCallback } from "react";
import { getSession } from "./auth";
import { sbFetch, todayStr, minutosAR, sumarDias, labelDia, useNotasRealtime } from "./colectasShared";

// Cierre de turno — el nocturno (18 a 23 hs) deja las novedades que el sistema no ve.
// Cada novedad es una nota de la Pizarra (notas_operativas, tipo 'turno') para el próximo día
// operativo: el equipo la ve a la mañana en la Pizarra y en el buzón del Inicio, la resuelve, y la
// noche siguiente el nocturno ve acá qué pasó con lo que dejó. Sin datos automáticos (eso está en
// Métricas): solo lo humano. Pedido de Alejo 22/10.

const C = {
  ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e",
  glass: "rgba(27,28,46,0.72)", line: "rgba(255,255,255,0.06)", soft: "rgba(255,255,255,0.05)",
  teal: "#2ee6b6", ambar: "#F5C044",
};
const card = { background: C.glass, border: `1px solid ${C.line}`, borderRadius: 16, WebkitBackdropFilter: "blur(18px)", backdropFilter: "blur(18px)" };
const INICIO_TURNO = 18 * 60;

// Próximo día con operación: lunes a sábado (el domingo no se trabaja).
export function proximoDiaOperativo(hoy) {
  let d = sumarDias(hoy, 1);
  if (new Date(d + "T12:00:00").getDay() === 0) d = sumarDias(d, 1);
  return d;
}
// Medianoche AR de un día, en UTC (AR = UTC-3 sin horario de verano)
const inicioDiaUTC = (dia) => `${dia}T03:00:00Z`;

export default function CierreTurno({ cadetes = [], abierto: abiertoCtl, onCerrar, onResumen }) {
  // Controlado desde Monitoreo (chip "Cierre de turno" arriba a la derecha): se abre solo al tocarlo.
  const controlado = abiertoCtl !== undefined;
  const hoy = todayStr();
  const destino = proximoDiaOperativo(hoy);
  const usuario = (getSession() || {}).nombre || "";
  const [abiertoLocal, setAbierto] = useState(() => minutosAR() >= INICIO_TURNO);
  const abierto = controlado ? abiertoCtl : abiertoLocal;
  const [deHoy, setDeHoy] = useState([]);       // las que se dejaron este turno
  const [deAnoche, setDeAnoche] = useState([]); // las que dejó el turno anterior (para hoy)
  const [texto, setTexto] = useState("");
  const [cadete, setCadete] = useState("");
  const [urgente, setUrgente] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const cargar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        sbFetch(`notas_operativas?select=*&tipo=eq.turno&created_at=gte.${inicioDiaUTC(hoy)}&order=created_at.asc`),
        sbFetch(`notas_operativas?select=*&tipo=eq.turno&fecha_objetivo=eq.${hoy}&created_at=lt.${inicioDiaUTC(hoy)}&order=created_at.asc`),
      ]);
      setDeHoy(Array.isArray(a) ? a : []); setDeAnoche(Array.isArray(b) ? b : []);
    } catch (e) { /* sin red: se reintenta con el realtime o al volver */ }
  }, [hoy]);
  useEffect(() => { cargar(); }, [cargar]);
  useNotasRealtime(useCallback((row) => { if (row && row.tipo === "turno") cargar(); }, [cargar]));

  const agregar = async (e) => {
    e.preventDefault();
    const t = texto.trim();
    if (!t || busy) return;
    setBusy(true); setErr("");
    try {
      await sbFetch("notas_operativas", { method: "POST", body: JSON.stringify({
        texto: t, tipo: "turno", prioridad: urgente ? "ahora" : "normal", fecha_objetivo: destino,
        cadete: cadete.trim() || null, autor: usuario || null,
      }) });
      setTexto(""); setCadete(""); setUrgente(false);
      await cargar();
    } catch (er) { setErr("No se pudo guardar. Probá de nuevo."); }
    finally { setBusy(false); }
  };
  const borrar = async (n) => {
    try { await sbFetch(`notas_operativas?id=eq.${n.id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); await cargar(); } catch (e) {}
  };

  useEffect(() => { if (onResumen) onResumen(deHoy.length); }, [deHoy.length, onResumen]);
  if (controlado && !abierto) return null;

  const resueltasAnoche = deAnoche.filter((n) => n.resuelta_at).length;
  const inp = { background: C.soft, border: `1px solid ${C.line}`, borderRadius: 10, color: C.ink, padding: "9px 12px", fontSize: 13.5, fontFamily: "inherit" };

  return (
    <div style={{ ...card, padding: "12px 14px", margin: "12px 0" }}>
      <button onClick={() => (controlado ? onCerrar && onCerrar() : setAbierto((v) => !v))} aria-expanded={abierto}
        style={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "baseline", gap: 10, width: "100%" }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: C.ink }}>Cierre de turno</span>
        <span style={{ fontSize: 12.5, color: C.ink2, flex: 1 }}>
          {deHoy.length ? `${deHoy.length} novedad${deHoy.length > 1 ? "es" : ""} para ${labelDia(destino, hoy)}` : `las novedades pasan a la Pizarra de ${labelDia(destino, hoy)}`}
          {deAnoche.length ? ` · de anoche: ${resueltasAnoche}/${deAnoche.length} resueltas` : ""}
        </span>
        <span style={{ fontSize: 12, color: C.ink3 }}>{abierto ? (controlado ? "cerrar" : "ocultar") : "abrir"}</span>
      </button>

      {abierto && (
        <div style={{ marginTop: 12 }}>
          <form onSubmit={agregar} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) agregar(e); }}
              placeholder="Qué pasó en el turno que tiene que saber el equipo mañana…"
              style={{ ...inp, resize: "vertical", width: "100%", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input list="cierre-cadetes" value={cadete} onChange={(e) => setCadete(e.target.value)} placeholder="Cadete (opcional)"
                style={{ ...inp, width: 200, maxWidth: "100%" }} />
              <datalist id="cierre-cadetes">{cadetes.map((n) => <option key={n} value={n} />)}</datalist>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.ink2, cursor: "pointer" }}>
                <input type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} /> Urgente
              </label>
              <button type="submit" disabled={busy || !texto.trim()}
                style={{ marginLeft: "auto", background: texto.trim() ? "rgba(46,230,182,0.12)" : C.soft, border: `1px solid ${texto.trim() ? "rgba(46,230,182,0.35)" : C.line}`, color: texto.trim() ? C.teal : C.ink3, borderRadius: 10, padding: "9px 16px", fontSize: 13.5, fontWeight: 600, cursor: texto.trim() ? "pointer" : "default" }}>
                {busy ? "Guardando…" : "Pasar a la Pizarra"}
              </button>
            </div>
            {err && <div style={{ fontSize: 12.5, color: C.ambar }}>{err}</div>}
          </form>

          {deHoy.length > 0 && (
            <Lista titulo={`Este turno → Pizarra de ${labelDia(destino, hoy)}`}>
              {deHoy.map((n) => (
                <Linea key={n.id} n={n} extra={!n.resuelta_at && n.autor === usuario
                  ? <button onClick={() => borrar(n)} style={{ background: "none", border: "none", color: C.ink3, fontSize: 12, cursor: "pointer", padding: 0 }}>borrar</button>
                  : null} />
              ))}
            </Lista>
          )}

          {deAnoche.length > 0 && (
            <Lista titulo="Lo que dejó el turno anterior">
              {deAnoche.map((n) => (
                <Linea key={n.id} n={n} extra={<span style={{ fontSize: 12, color: n.resuelta_at ? C.teal : C.ink3, whiteSpace: "nowrap" }}>
                  {n.resuelta_at ? `resuelta por ${n.resuelta_por || "—"}` : "pendiente"}
                </span>} />
              ))}
            </Lista>
          )}
        </div>
      )}
    </div>
  );
}

function Lista({ titulo, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 11.5, color: C.ink3, marginBottom: 4 }}>{titulo}</div>
      {children}
    </div>
  );
}

function Linea({ n, extra }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderTop: `1px solid ${C.line}` }}>
      {n.prioridad === "ahora" && <span aria-label="urgente" style={{ width: 7, height: 7, borderRadius: 4, background: C.ambar, flexShrink: 0, alignSelf: "center" }} />}
      <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
        {n.texto}
        <span style={{ color: C.ink3, fontSize: 12 }}>{n.cadete ? ` · ${n.cadete}` : ""}{n.autor ? ` · ${n.autor}` : ""}</span>
      </div>
      {extra}
    </div>
  );
}
