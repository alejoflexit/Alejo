import React, { useState, useEffect, useCallback, useRef } from "react";

// Zonas — saturación por zona EN VIVO (spec-zonas-en-vivo).
// Fuente: bridge del VPS GET /zonas (Excel de ENVIOS con Fecha Flexit = hoy, agregado por CP,
// cache 5 min del lado del bridge). El mapeo CP→zona sale de `zonas_cp` y la capacidad de
// `cadete_topes` (tope por cadete sumado por zona), igual que el corte de las 14:30.
// Pensada para dejar abierta en la compu: se refresca sola cada 5 minutos.

const BRIDGE_ZONAS_URL = "https://srv1801226.hstgr.cloud/bridge/zonas";
const BRIDGE_KEY = "db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b"; // misma key que Arribos (riesgo aceptado, ver spec-lightdata-bridge)
const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

const REFRESH_MS = 5 * 60 * 1000; // igual al cache del bridge
const UMBRAL_LIMITE = 0.85;       // ≥85% del tope = "al límite" (mismo criterio que la saturación de lunes)

const C = {
  card: "#1A1A4A", cardAlt: "#12123A", border: "rgba(255,255,255,0.08)",
  text: "#fff", muted: "rgba(255,255,255,0.55)", faint: "rgba(255,255,255,0.35)",
  ok: "#2ECFAA", warn: "#EF9F27", crit: "#E24B4A",
};

const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const num = (n) => new Intl.NumberFormat("es-AR").format(n);
const horaAR = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

async function supa(pathQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${pathQuery.split("?")[0]} → ${r.status}`);
  return r.json();
}

export default function Zonas() {
  const [zonas, setZonas] = useState(null);       // [{zona, total, entregados, tope, pct, estado}]
  const [sinTope, setSinTope] = useState([]);     // zonas con envíos pero sin tope configurado
  const [meta, setMeta] = useState(null);         // {total, actualizado, porEstado, sinZona, sinCp}
  const [error, setError] = useState(null);
  const [sinEndpoint, setSinEndpoint] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const refMapas = useRef(null);                  // {cpZona, topeZona} — se cargan una vez

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // 1) mapas (una sola vez por visita)
      if (!refMapas.current) {
        const [zonasCP, topes] = await Promise.all([
          supa("zonas_cp?select=cp,zona&limit=10000"),
          supa("cadete_topes?select=cadete,tope,zonas&activo=eq.true&limit=1000"),
        ]);
        const cpZona = new Map();
        for (const z of zonasCP) {
          const digitos = String(z.cp).replace(/\D/g, "");
          if (digitos) cpZona.set(digitos, z.zona);
        }
        const topeZona = new Map();
        for (const t of topes) {
          if (!t.zonas) continue; // backups sin zona fija no aportan tope
          for (const z of String(t.zonas).split(/[,/]/)) {
            const k = norm(z);
            if (k) topeZona.set(k, (topeZona.get(k) || 0) + (t.tope || 0));
          }
        }
        refMapas.current = { cpZona, topeZona };
      }
      // 2) carga del día desde el bridge
      const r = await fetch(`${BRIDGE_ZONAS_URL}`, { headers: { "x-bridge-key": BRIDGE_KEY } });
      const j = await r.json().catch(() => null);
      if (r.status === 404 || (j && j.error === "ruta desconocida")) { setSinEndpoint(true); setError(null); return; }
      if (!r.ok || !j || !j.porCP) throw new Error((j && j.error) || `bridge → ${r.status}`);
      setSinEndpoint(false);

      // 3) CP → zona
      const { cpZona, topeZona } = refMapas.current;
      const porZona = {}; // zona -> {total, entregados}
      let sinZona = 0, sinCp = 0;
      for (const [cp, v] of Object.entries(j.porCP)) {
        if (cp === "(sin cp)") { sinCp += v.t; continue; }
        const zona = cpZona.get(cp);
        if (!zona) { sinZona += v.t; continue; }
        const nodo = porZona[zona] || (porZona[zona] = { total: 0, entregados: 0 });
        nodo.total += v.t; nodo.entregados += v.e;
      }
      const conTope = [], sinTopeArr = [];
      for (const [zona, v] of Object.entries(porZona)) {
        const tope = topeZona.get(norm(zona));
        if (tope) {
          const pct = v.total / tope;
          conTope.push({ zona, ...v, tope, pct, estado: pct >= 1 ? "saturada" : pct >= UMBRAL_LIMITE ? "limite" : "ok" });
        } else {
          sinTopeArr.push({ zona, ...v });
        }
      }
      conTope.sort((a, b) => b.pct - a.pct);
      sinTopeArr.sort((a, b) => b.total - a.total);
      setZonas(conTope);
      setSinTope(sinTopeArr);
      setMeta({ total: j.total, actualizado: j.actualizado, porEstado: j.porEstado || {}, sinZona, sinCp });
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, REFRESH_MS);
    return () => clearInterval(t);
  }, [cargar]);

  const colorEstado = (e) => (e === "saturada" ? C.crit : e === "limite" ? C.warn : C.ok);
  const f = norm(filtro);
  const visibles = zonas ? zonas.filter((z) => !f || norm(z.zona).includes(f)) : [];
  const saturadas = zonas ? zonas.filter((z) => z.estado === "saturada").length : 0;
  const alLimite = zonas ? zonas.filter((z) => z.estado === "limite").length : 0;

  if (sinEndpoint) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: 28, maxWidth: 620 }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>El bridge todavía no tiene el endpoint de zonas</div>
        <div style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.6 }}>
          El código ya está en el repo del vault (<code>vps/lightdata-bridge.js</code>) — falta correr el deploy en el VPS.
          Mandale a Hermes el mensaje <b>mensaje-hermes-zonas.md</b> del vault y esta pantalla arranca sola.
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* barra superior: estado del dato + buscador */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {meta && (
          <>
            <span style={{ fontSize: 13, color: C.muted }}>
              <b style={{ color: C.text }}>{num(meta.total)}</b> envíos hoy · dato de las <b style={{ color: C.text }}>{horaAR(meta.actualizado)}</b> · se actualiza cada 5 min
            </span>
            <span style={{ fontSize: 12.5, padding: "3px 10px", borderRadius: 999, background: "rgba(226,75,74,0.12)", color: C.crit, fontWeight: 700 }}>🔴 {saturadas} saturadas</span>
            <span style={{ fontSize: 12.5, padding: "3px 10px", borderRadius: 999, background: "rgba(239,159,39,0.12)", color: C.warn, fontWeight: 700 }}>🟠 {alLimite} al límite</span>
          </>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar zona…"
            style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, padding: "7px 12px", fontSize: 13, width: 150 }} />
          <button onClick={cargar} disabled={cargando} title="Actualizar ahora"
            style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.muted, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}>
            {cargando ? "…" : "⟳"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(226,75,74,0.10)", border: "1px solid rgba(226,75,74,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#f1a2a1", marginBottom: 14 }}>
          No pude actualizar recién ({error}). {zonas ? "Muestro el último dato bueno." : "Reintento solo en unos minutos."}
        </div>
      )}

      {!zonas && cargando && (
        <div style={{ color: C.muted, fontSize: 14, padding: "30px 0" }}>Cargando el listado del día… la primera vez puede tardar un minuto (baja el Excel completo de LightData).</div>
      )}

      {zonas && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {visibles.map((z) => {
              const col = colorEstado(z.estado);
              const ancho = Math.min(z.pct, 1.2) / 1.2; // la barra se clava en 120% para que una zona muy pasada no aplaste al resto
              return (
                <div key={z.zona} style={{ background: C.card, border: `1px solid ${z.estado === "saturada" ? "rgba(226,75,74,0.45)" : C.border}`, borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 7 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{z.zona}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: col }}>
                      {z.estado === "saturada" ? "🔴 SATURADA" : z.estado === "limite" ? "🟠 AL LÍMITE" : "🟢 OK"}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                      <b>{num(z.total)}</b><span style={{ color: C.muted }}> / {num(z.tope)}</span>
                      <span style={{ color: C.faint, fontSize: 12.5 }}> · {num(z.entregados)} entregados</span>
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden", position: "relative" }}>
                    <div style={{ width: `${(ancho * 100).toFixed(1)}%`, height: "100%", borderRadius: 4, background: col, transition: "width .5s" }} />
                    {/* marca del 100% del tope */}
                    <div style={{ position: "absolute", left: `${((1 / 1.2) * 100).toFixed(1)}%`, top: 0, bottom: 0, width: 2, background: "rgba(255,255,255,0.35)" }} />
                  </div>
                </div>
              );
            })}
            {visibles.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "16px 4px" }}>Ninguna zona coincide con la búsqueda.</div>}
          </div>

          {(sinTope.length > 0 || (meta && (meta.sinZona > 0 || meta.sinCp > 0))) && (
            <details style={{ marginTop: 18, color: C.muted }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text }}>
                Sin tope o sin zona ({num(sinTope.reduce((s, z) => s + z.total, 0) + (meta ? meta.sinZona + meta.sinCp : 0))} envíos)
              </summary>
              <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 8 }}>
                {sinTope.length > 0 && (
                  <div>Zonas con envíos pero sin cadete/tope en <code>cadete_topes</code>: {sinTope.slice(0, 15).map((z) => `${z.zona} (${num(z.total)})`).join(" · ")}{sinTope.length > 15 ? ` · +${sinTope.length - 15} más` : ""}</div>
                )}
                {meta && meta.sinZona > 0 && <div>CPs que no matchean ninguna zona de <code>zonas_cp</code>: {num(meta.sinZona)} envíos.</div>}
                {meta && meta.sinCp > 0 && <div>Envíos sin CP en LightData: {num(meta.sinCp)}.</div>}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
