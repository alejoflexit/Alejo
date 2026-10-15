import React, { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { createPortal } from "react-dom";
import { sbFetch, todayStr } from "./colectasShared";

// El mapa (Leaflet) se carga recién cuando alguien lo abre, para no engordar el Home.
const TransitoMapa = React.lazy(() => import("./TransitoMapa"));

// ── Alertas de tránsito (chip en el header del Home) ──
// Datos: tabla alertas_transito (lectura pública). Las automáticas las escribe la función
// public.transito_sync() en Supabase cada 10 min (pg_cron, 6–22 hs AR) con TomTom:
//   · corredores: tiempo de viaje en vivo vs LO HABITUAL para esa hora (no vs ruta vacía),
//     así no alerta todos los días a las 17 hs. Ámbar ≥ +12 min, roja ≥ +30 min.
//   · radar de la base: calles cerradas alrededor de Venezuela 1370 que arrancaron en las últimas 12 hs
//     (marchas en Congreso / Plaza de Mayo). Las obras viejas quedan afuera.
// Las manuales las carga el equipo desde el popover y vencen solas.
// Noticias: public.transito_noticias_sync() cada 15 min lee los RSS de La Nación, Infobae, TN, Clarín,
// Perfil y Ámbito, prefiltra por palabras clave y Claude Haiku arma los eventos (hoy / mañana, dónde,
// a qué hora). Así una marcha anunciada aparece ANTES de que TomTom vea las calles cortadas.

const C = {
  ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e",
  glassSoft: "rgba(27,28,46,0.6)", pop: "rgba(24,25,42,0.96)", line: "rgba(255,255,255,0.06)",
  teal: "#2ee6b6", ambar: "#F5C044", rojo: "#E8615F",
  shadow: "0 20px 60px rgba(0,0,0,0.28)",
  grotesk: "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
};

const TIPOS = {
  cortado: { label: "Corte total", grav: "roja" },
  marcha: { label: "Marcha / piquete", grav: "roja" },
  accidente: { label: "Accidente", grav: "ambar" },
  lento: { label: "Muy lento", grav: "ambar" },
};
const VENCE = [
  { id: "2h", label: "En 2 horas", calc: () => new Date(Date.now() + 2 * 3600e3) },
  { id: "dia", label: "Fin del día", calc: () => { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCHours(23 + 3, 59, 0, 0); return d; } },
  { id: "24h", label: "En 24 horas", calc: () => new Date(Date.now() + 24 * 3600e3) },
];

// Un evento anunciado para un día futuro (noticias) no es "ahora": va al final y no escala al Foco.
export const esFuturo = (a) => !!a.fecha_evento && a.fecha_evento > todayStr();
const ordenar = (as) => [...as].sort((a, b) =>
  (esFuturo(a) - esFuturo(b)) || (b.radar_base - a.radar_base) || ((b.gravedad === "roja") - (a.gravedad === "roja"))
  || ((b.fuente === "noticias") - (a.fuente === "noticias")) // la noticia explica el porqué y el horario; TomTom va debajo con las calles
  || ((b.cadetes || 0) - (a.cadetes || 0)));

export function useTransito() {
  const [alertas, setAlertas] = useState(null);
  const [estado, setEstado] = useState({ total: 0, actualizado: null });
  const recargar = useCallback(() => {
    sbFetch("alertas_transito?select=id,fuente,corredor_id,tipo,gravedad,radar_base,titulo,detalle,sugerencia,cadetes,creada_por,desde,vence,fuentes,fecha_evento,hora_evento,datos&activa=eq.true")
      .then((rows) => {
        const ahora = Date.now();
        setAlertas(ordenar((rows || []).filter((a) => !a.vence || new Date(a.vence).getTime() > ahora)));
      })
      .catch(() => {});
    sbFetch("transito_estado?select=actualizado")
      .then((rows) => {
        const ts = (rows || []).map((r) => new Date(r.actualizado).getTime());
        setEstado({ total: ts.length, actualizado: ts.length ? Math.max(...ts) : null });
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    recargar();
    const t = setInterval(recargar, 120000);
    return () => clearInterval(t);
  }, [recargar]);
  return { alertas: alertas || [], cargado: alertas !== null, estado, recargar };
}

// Texto listo para pegar en el grupo de WhatsApp de los cadetes.
export function textoAviso(alertas) {
  if (!alertas.length) return "🚦 Tránsito: todo normal en los corredores y alrededor de la base.";
  const lineas = alertas.map((a) => {
    const det = a.radar_base && a.detalle ? a.detalle.replace(/^\d+ cortes: /, "") : a.detalle;
    const cuando = esFuturo(a) ? `MAÑANA${a.hora_evento ? ` ${a.hora_evento} hs` : ""} — ` : a.hora_evento ? `Desde las ${a.hora_evento} — ` : "";
    return `• ${cuando}${a.titulo}${det ? `: ${det}` : ""}${a.sugerencia ? ` → ${a.sugerencia}` : ""}`;
  });
  return `🚦 Tránsito ahora\n${lineas.join("\n")}`;
}

const RouteIcon = ({ size = 18, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="19" r="3" /><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" /><circle cx="18" cy="5" r="3" />
  </svg>
);

const hace = (ts) => {
  if (!ts) return "";
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : `hace ${Math.round(m / 60)} h`;
};

function FormCorte({ usuario, onListo, onCancelar }) {
  const [donde, setDonde] = useState("");
  const [tipo, setTipo] = useState("cortado");
  const [sug, setSug] = useState("");
  const [base, setBase] = useState(false);
  const [vence, setVence] = useState("2h");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const inp = { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9, border: `1px solid rgba(255,255,255,0.1)`, background: "rgba(255,255,255,0.05)", color: "#fff", fontSize: 13, outline: "none", fontFamily: "inherit" };
  const lbl = { fontSize: 11.5, color: C.ink3, fontWeight: 600, marginBottom: 4, display: "block" };
  const guardar = async () => {
    if (!donde.trim()) { setErr("Escribí dónde es el corte"); return; }
    setBusy(true); setErr("");
    try {
      await sbFetch("alertas_transito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fuente: "manual", tipo, gravedad: TIPOS[tipo].grav, radar_base: base,
          titulo: donde.trim(), detalle: TIPOS[tipo].label, sugerencia: sug.trim() || null,
          vence: VENCE.find((v) => v.id === vence).calc().toISOString(), creada_por: usuario || null,
        }),
      });
      onListo();
    } catch { setErr("No se pudo guardar. Probá de nuevo."); setBusy(false); }
  };
  return (
    <div style={{ padding: "12px 16px 14px", borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <label style={lbl}>Dónde</label>
        <input autoFocus value={donde} onChange={(e) => { setDonde(e.target.value); setErr(""); }} placeholder="Camino Negro y Av. Yrigoyen" style={inp} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={lbl}>Qué pasa</label>
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inp}>
            {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k} style={{ background: "#1b1c2e" }}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>Se saca solo</label>
          <select value={vence} onChange={(e) => setVence(e.target.value)} style={inp}>
            {VENCE.map((v) => <option key={v.id} value={v.id} style={{ background: "#1b1c2e" }}>{v.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={lbl}>Desvío sugerido (opcional)</label>
        <input value={sug} onChange={(e) => setSug(e.target.value)} placeholder="Salir por Paseo Colón" style={inp} />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: C.ink2, cursor: "pointer" }}>
        <input type="checkbox" checked={base} onChange={(e) => setBase(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.teal }} />
        Afecta la salida de la base
      </label>
      {err && <div style={{ color: C.rojo, fontSize: 12 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={guardar} disabled={busy} style={{ flex: 1, minHeight: 38, borderRadius: 10, border: "1px solid rgba(46,230,182,0.4)", background: "rgba(46,230,182,0.14)", color: C.teal, fontSize: 13, fontWeight: 700, cursor: busy ? "default" : "pointer" }}>{busy ? "Guardando…" : "Guardar alerta"}</button>
        <button type="button" onClick={onCancelar} style={{ minHeight: 38, padding: "0 14px", borderRadius: 10, border: `1px solid rgba(255,255,255,0.1)`, background: "transparent", color: C.ink2, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}

export function TransitoChip({ transito, session, usuario, isMobile }) {
  const { alertas, cargado, estado, recargar } = transito;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [mapa, setMapa] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setForm(false); } };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  if (!cargado) return null;

  const n = alertas.length;
  const hayRoja = alertas.some((a) => a.gravedad === "roja" && !esFuturo(a));
  const baseRoja = alertas.some((a) => a.radar_base && a.gravedad === "roja" && !esFuturo(a));
  const color = n === 0 ? C.ink3 : hayRoja ? C.rojo : C.ambar;
  const borde = n === 0 ? C.line : hayRoja ? "rgba(232,97,95,0.45)" : "rgba(245,192,68,0.4)";

  const copiar = () => {
    navigator.clipboard.writeText(textoAviso(alertas)).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1800); }).catch(() => {});
  };
  const sacar = async (a) => {
    try {
      await sbFetch(`alertas_transito?id=eq.${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ activa: false, updated_at: new Date().toISOString() }) });
    } catch { /* si falla, la recarga la vuelve a mostrar */ }
    recargar();
  };

  const popStyle = isMobile
    ? { position: "fixed", top: 72, left: 12, right: 12 }
    : { position: "absolute", top: 54, right: 0, width: 380 };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <style>{`@keyframes fx-tr-pulso{0%,100%{opacity:1}50%{opacity:.35}}@media (prefers-reduced-motion: reduce){.fx-tr-pulso{animation:none!important}}`}</style>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={n ? `Tránsito: ${n} alerta${n === 1 ? "" : "s"}` : "Tránsito normal"}
        style={{ position: "relative", height: 40, minWidth: 40, boxSizing: "border-box", padding: isMobile ? 0 : "0 13px", borderRadius: isMobile ? 12 : 20, background: C.glassSoft, border: `1px solid ${borde}`, color: n ? C.ink : C.ink2, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", fontFamily: "inherit" }}>
        <RouteIcon size={18} color={n ? color : C.ink2} />
        {!isMobile && (n ? `Tránsito · ${n}` : "Tránsito OK")}
        {n > 0 && (
          <span className={baseRoja ? "fx-tr-pulso" : undefined}
            style={isMobile
              ? { position: "absolute", top: -5, right: -5, minWidth: 20, height: 20, borderRadius: 11, background: color, color: hayRoja ? "#fff" : "#1a1406", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px", border: "2px solid #0F0F1B", fontFamily: C.grotesk, animation: baseRoja ? "fx-tr-pulso 1.6s ease-in-out infinite" : "none" }
              : { width: 8, height: 8, borderRadius: "50%", background: color, animation: baseRoja ? "fx-tr-pulso 1.6s ease-in-out infinite" : "none" }}>
            {isMobile ? n : null}
          </span>
        )}
      </button>

      {open && (
        <div style={{ ...popStyle, maxWidth: isMobile ? "none" : "calc(100vw - 32px)", background: C.pop, border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: C.shadow, overflow: "hidden", zIndex: 60, WebkitBackdropFilter: "blur(18px)", backdropFilter: "blur(18px)", color: C.ink, maxHeight: "calc(100vh - 100px)", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "14px 16px 10px" }}>
            <span style={{ fontFamily: C.grotesk, fontWeight: 600, fontSize: 14 }}>Tránsito ahora</span>
            {estado.actualizado && <span style={{ fontSize: 11, color: C.ink3 }}>TomTom · {hace(estado.actualizado)}</span>}
          </div>

          {n === 0 && (
            <div style={{ padding: "4px 16px 14px", fontSize: 12.5, color: C.ink2, lineHeight: 1.5 }}>
              Normal en los {estado.total || ""} corredores y alrededor de la base, comparado con lo habitual para esta hora.
            </div>
          )}

          {alertas.map((a) => {
            const col = a.gravedad === "roja" ? C.rojo : C.ambar;
            return (
              <div key={a.id} style={{ display: "flex", gap: 11, padding: "11px 16px", borderTop: `1px solid ${C.line}` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, flexShrink: 0, marginTop: 6 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>
                    {a.titulo}
                    {esFuturo(a) && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", color: C.ink2, background: "rgba(255,255,255,0.08)", borderRadius: 5, padding: "1px 6px", verticalAlign: 1 }}>MAÑANA</span>}
                    {a.radar_base && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", color: col, background: col + "22", borderRadius: 5, padding: "1px 6px", verticalAlign: 1 }}>BASE</span>}
                  </div>
                  {a.hora_evento && <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.45, marginTop: 2 }}>Desde las {a.hora_evento} hs</div>}
                  {a.detalle && <div style={{ fontSize: 12, color: C.ink2, lineHeight: 1.45, marginTop: 2 }}>{a.detalle}</div>}
                  {a.sugerencia && <div style={{ fontSize: 12, color: C.teal, lineHeight: 1.45, marginTop: 2 }}>→ {a.sugerencia}</div>}
                  {a.fuente === "manual" && <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>Cargado{a.creada_por ? ` por ${a.creada_por}` : ""}</div>}
                  {a.fuente === "noticias" && Array.isArray(a.fuentes) && a.fuentes.length > 0 && (
                    <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>
                      Noticias ·{" "}
                      {[...new Map(a.fuentes.map((f) => [f.medio, f])).values()].slice(0, 3).map((f, i) => (
                        <React.Fragment key={f.url}>{i > 0 && ", "}<a href={f.url} target="_blank" rel="noopener noreferrer" title={f.titulo} style={{ color: C.ink2, textDecoration: "underline", textUnderlineOffset: 2 }}>{f.medio}</a></React.Fragment>
                      ))}
                    </div>
                  )}
                  {a.fuente === "tomtom" && <div style={{ fontSize: 11, color: C.ink3, marginTop: 3 }}>TomTom</div>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
                  {a.cadetes > 0 && <span style={{ fontSize: 11.5, color: C.ink3, whiteSpace: "nowrap" }}>{a.cadetes} cad.</span>}
                  {a.fuente === "manual" && session && (
                    <button type="button" onClick={() => sacar(a)} style={{ border: `1px solid rgba(255,255,255,0.1)`, background: "transparent", color: C.ink2, borderRadius: 8, padding: "4px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Sacar</button>
                  )}
                </div>
              </div>
            );
          })}

          {form && session ? (
            <FormCorte usuario={usuario} onCancelar={() => setForm(false)} onListo={() => { setForm(false); recargar(); }} />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 16px", padding: "12px 16px 14px", borderTop: `1px solid ${C.line}` }}>
              <button type="button" onClick={() => { setOpen(false); setMapa(true); }} style={{ background: "none", border: "none", padding: 0, color: C.teal, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>Ver mapa</button>
              {n > 0 && <button type="button" onClick={copiar} style={{ background: "none", border: "none", padding: 0, color: C.ink2, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{copiado ? "✓ Copiado" : "Copiar aviso para el grupo"}</button>}
              {session && <button type="button" onClick={() => setForm(true)} style={{ background: "none", border: "none", padding: 0, color: C.ink2, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>+ Cargar corte</button>}
            </div>
          )}
        </div>
      )}

      {mapa && createPortal(
        <Suspense fallback={<div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(8,8,24,0.62)", display: "flex", alignItems: "center", justifyContent: "center", color: C.ink2, fontSize: 13 }}>Cargando mapa…</div>}>
          <TransitoMapa alertas={alertas} onCerrar={() => setMapa(false)} isMobile={isMobile} />
        </Suspense>,
        document.body
      )}
    </div>
  );
}
