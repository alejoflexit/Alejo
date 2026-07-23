import React, { useState, useEffect, useCallback, useRef } from "react";

// Zonas — saturación por TERRITORIO y por zona, EN VIVO (spec-zonas-en-vivo).
// Fuente: bridge del VPS GET /zonas (Excel de ENVIOS con Fecha Flexit = hoy, cache 5 min).
// v3 (feedback de Alejo 23/07):
//  - La vista por cadete del Excel NO sirve (las asignaciones rotan si alguien falta).
//    La unidad correcta es el TERRITORIO: el grupo de zonas que se hace junto
//    (ej. Recoleta + Retiro), definido en cadete_topes.zonas — estable aunque cambie quién lo corre.
//  - Atribución fina CP+localidad: 48 de 515 CPs están en varias zonas (CABA se pisa; ej. 1408 =
//    Liniers/Monte Castro/Versalles/Villa Luro/Villa Real). Con el CP solo, una zona chica se
//    llevaba todo el CP (Villa Real "32" cuando tenía 2 reales). Se desambigua con la localidad.

const BRIDGE_ZONAS_URL = "https://srv1801226.hstgr.cloud/bridge/zonas";
const BRIDGE_KEY = "db1d987c9cfbd82b949d61f31ffcedaceceddd10a19b556b"; // misma key que Arribos (riesgo aceptado, ver spec-lightdata-bridge)
const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "sb_publishable_yYrDNXJECjKQJaa7xx4dww_iwugKOnI";

const REFRESH_MS = 5 * 60 * 1000; // igual al cache del bridge
const UMBRAL_LIMITE = 0.85;       // ≥85% del tope = "al límite"

const C = {
  card: "#1A1A4A", cardAlt: "#12123A", border: "rgba(255,255,255,0.08)",
  text: "#fff", muted: "rgba(255,255,255,0.55)", faint: "rgba(255,255,255,0.35)",
  ok: "#2ECFAA", warn: "#EF9F27", crit: "#E24B4A",
};

const norm = (s) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
const num = (n) => new Intl.NumberFormat("es-AR").format(Math.round(n));
const horaAR = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

async function supa(pathQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!r.ok) throw new Error(`Supabase ${pathQuery.split("?")[0]} → ${r.status}`);
  return r.json();
}

// Match zona↔localidad tolerante: "Santa Rita" (Excel) debe encontrar "Villa Santa Rita" (zona).
function matchNombre(nl, nz) {
  if (!nl || nl.length < 4) return false;
  return nz === nl || nz.includes(nl) || nl.includes(nz);
}

export default function Zonas() {
  const [vista, setVista] = useState("terr");     // "terr" (territorios = grupos de zonas) | "zona"
  const [terrs, setTerrs] = useState(null);       // [{nombre, cadetes, total, entregados, tope, pct, estado, notas}]
  const [zonas, setZonas] = useState(null);       // [{zona, total, entregados, tope, pct, estado, cadetes}]
  const [sinTope, setSinTope] = useState([]);     // zonas con envíos pero sin tope configurado
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState(null);
  const [sinEndpoint, setSinEndpoint] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const refMapas = useRef(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      // 1) mapas (una sola vez por visita)
      if (!refMapas.current) {
        const [zonasCP, topes] = await Promise.all([
          supa("zonas_cp?select=cp,zona&limit=10000"),
          supa("cadete_topes?select=cadete,tope,zonas&activo=eq.true&limit=1000"),
        ]);
        const cpZonas = new Map();      // cp (dígitos) -> [zona, zona…]  (48/515 CPs tienen varias)
        const todasZonas = new Set();
        for (const z of zonasCP) {
          const digitos = String(z.cp).replace(/\D/g, "");
          if (!digitos) continue;
          const arr = cpZonas.get(digitos) || [];
          if (!arr.includes(z.zona)) arr.push(z.zona);
          cpZonas.set(digitos, arr);
          todasZonas.add(z.zona);
        }
        const topeZona = new Map();     // norm(zona) -> tope sumado (para la vista por zona)
        const zonaCadetes = new Map();  // norm(zona) -> cadetes que la hacen
        for (const t of topes) {
          if (!t.zonas) continue;
          for (const z of String(t.zonas).split(/[,/]/)) {
            const k = norm(z);
            if (!k) continue;
            topeZona.set(k, (topeZona.get(k) || 0) + (t.tope || 0));
            zonaCadetes.set(k, [...(zonaCadetes.get(k) || []), t.cadete]);
          }
        }
        refMapas.current = { cpZonas, topeZona, zonaCadetes, topes, todasZonas: [...todasZonas] };
      }
      // 2) carga del día desde el bridge
      const r = await fetch(`${BRIDGE_ZONAS_URL}`, { headers: { "x-bridge-key": BRIDGE_KEY } });
      const j = await r.json().catch(() => null);
      if (r.status === 404 || (j && j.error === "ruta desconocida")) { setSinEndpoint(true); setError(null); return; }
      if (!r.ok || !j || (!j.porDet && !j.porCP)) throw new Error((j && j.error) || `bridge → ${r.status}`);
      setSinEndpoint(false);

      const { cpZonas, topeZona, zonaCadetes, topes, todasZonas } = refMapas.current;
      const finoDisponible = !!j.porDet; // cp|localidad — necesita el bridge re-deployado

      // 3) atribución envío→zona
      const porZona = {}; // zona -> {total, entregados}
      let sinZona = 0, sinCp = 0, ambiguos = 0;
      const suma = (zona, v) => { const n = porZona[zona] || (porZona[zona] = { total: 0, entregados: 0 }); n.total += v.t; n.entregados += v.e; };
      const entradas = finoDisponible ? Object.entries(j.porDet) : Object.entries(j.porCP);
      for (const [key, v] of entradas) {
        const [cp, loc] = finoDisponible ? key.split("|") : [key, ""];
        if (cp === "(sin cp)") { sinCp += v.t; continue; }
        const cands = cpZonas.get(cp) || [];
        const nl = norm(loc);
        let zona = null;
        if (cands.length === 1) {
          zona = cands[0];
        } else if (cands.length > 1) {
          const m = cands.filter((z) => matchNombre(nl, norm(z)));
          if (m.length === 1) zona = m[0];
          else if (m.length === 0 && finoDisponible) {
            // la localidad no matchea las zonas de ese CP: buscar por nombre en todas las zonas
            const g = todasZonas.filter((z) => matchNombre(nl, norm(z)));
            if (g.length === 1) zona = g[0]; else { ambiguos += v.t; continue; }
          } else { ambiguos += v.t; continue; }
        } else {
          // CP sin zona: última chance por nombre de localidad
          const g = finoDisponible ? todasZonas.filter((z) => matchNombre(nl, norm(z))) : [];
          if (g.length === 1) zona = g[0]; else { sinZona += v.t; continue; }
        }
        suma(zona, v);
      }

      // 4) vista POR ZONA
      const conTope = [], sinTopeArr = [];
      for (const [zona, v] of Object.entries(porZona)) {
        const tope = topeZona.get(norm(zona));
        if (tope) {
          const pct = v.total / tope;
          conTope.push({ zona, ...v, tope, pct, estado: pct >= 1 ? "saturada" : pct >= UMBRAL_LIMITE ? "limite" : "ok", cadetes: zonaCadetes.get(norm(zona)) || [] });
        } else {
          sinTopeArr.push({ zona, ...v });
        }
      }
      conTope.sort((a, b) => b.pct - a.pct);
      sinTopeArr.sort((a, b) => b.total - a.total);
      setZonas(conTope);
      setSinTope(sinTopeArr);

      // 5) vista TERRITORIOS: grupo de zonas que se hace junto (cadete_topes.zonas), estable
      // aunque falte el titular. Cadetes con la MISMA lista de zonas se fusionan (tope sumado).
      // Si una zona aparece en varios territorios, su volumen se reparte en partes iguales.
      const terrMap = new Map(); // clave = lista de zonas normalizada y ordenada
      for (const t of topes) {
        if (!t.zonas) continue;
        const lista = String(t.zonas).split(/[,/]/).map((z) => z.trim()).filter(Boolean);
        if (!lista.length) continue;
        const clave = lista.map(norm).sort().join("§");
        const node = terrMap.get(clave) || { zonasList: lista, cadetes: [], tope: 0 };
        node.cadetes.push(t.cadete);
        node.tope += t.tope || 0;
        terrMap.set(clave, node);
      }
      const cobertura = new Map(); // norm(zona) -> en cuántos territorios está
      for (const t of terrMap.values()) for (const z of t.zonasList) { const k = norm(z); cobertura.set(k, (cobertura.get(k) || 0) + 1); }
      const volZona = new Map();   // norm(zona) -> {total, entregados}
      for (const [zona, v] of Object.entries(porZona)) volZona.set(norm(zona), v);
      const terrArr = [];
      for (const t of terrMap.values()) {
        let total = 0, entregados = 0; const compartidas = [];
        for (const z of t.zonasList) {
          const k = norm(z), v = volZona.get(k), nCob = cobertura.get(k) || 1;
          if (!v) continue;
          total += v.total / nCob; entregados += v.entregados / nCob;
          if (nCob > 1) compartidas.push(z);
        }
        if (total === 0 && t.tope === 0) continue;
        const pct = t.tope ? total / t.tope : null;
        terrArr.push({
          nombre: t.zonasList.join(" + "),
          cadetes: t.cadetes,
          total, entregados, tope: t.tope || null, pct,
          estado: pct == null ? "sintope" : pct >= 1 ? "saturada" : pct >= UMBRAL_LIMITE ? "limite" : "ok",
          notas: compartidas.length ? `${compartidas.join(", ")} repartida entre varios territorios` : "",
        });
      }
      terrArr.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.total - a.total);
      setTerrs(terrArr);

      setMeta({ total: j.total, actualizado: j.actualizado, sinZona, sinCp, ambiguos, sinCadete: 0, finoDisponible });
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

  const colorEstado = (e) => (e === "saturada" ? C.crit : e === "limite" ? C.warn : e === "sintope" ? C.faint : C.ok);
  const f = norm(filtro);
  const esTerr = vista === "terr";
  const listaBase = esTerr ? (terrs || []) : (zonas || []);
  const items = listaBase.filter((it) => {
    if (!f) return true;
    const nombre = esTerr ? it.nombre : it.zona;
    const gente = esTerr ? it.cadetes : it.cadetes;
    return norm(nombre).includes(f) || gente.some((c) => norm(c).includes(f));
  });
  const saturadas = listaBase.filter((x) => x.estado === "saturada").length;
  const alLimite = listaBase.filter((x) => x.estado === "limite").length;

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
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
        {meta && (
          <>
            <span style={{ fontSize: 13, color: C.muted }}>
              <b style={{ color: C.text }}>{num(meta.total)}</b> envíos hoy · dato de las <b style={{ color: C.text }}>{horaAR(meta.actualizado)}</b> · se actualiza cada 5 min
            </span>
            <span style={{ fontSize: 12.5, padding: "3px 10px", borderRadius: 999, background: "rgba(226,75,74,0.12)", color: C.crit, fontWeight: 700 }}>🔴 {saturadas} saturados</span>
            <span style={{ fontSize: 12.5, padding: "3px 10px", borderRadius: 999, background: "rgba(239,159,39,0.12)", color: C.warn, fontWeight: 700 }}>🟠 {alLimite} al límite</span>
          </>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, overflow: "hidden" }}>
            {[["terr", "Territorios"], ["zona", "Por zona"]].map(([k, lbl]) => (
              <button key={k} onClick={() => setVista(k)}
                style={{ background: vista === k ? "rgba(46,207,170,0.15)" : "none", border: "none", color: vista === k ? C.ok : C.muted, padding: "7px 12px", fontSize: 13, fontWeight: vista === k ? 700 : 500, cursor: "pointer" }}>
                {lbl}
              </button>
            ))}
          </div>
          <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar zona o cadete…"
            style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.text, padding: "7px 12px", fontSize: 13, width: 160 }} />
          <button onClick={cargar} disabled={cargando} title="Actualizar ahora"
            style={{ background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 9, color: C.muted, padding: "7px 12px", fontSize: 13, cursor: "pointer" }}>
            {cargando ? "…" : "⟳"}
          </button>
        </div>
      </div>

      {meta && !meta.finoDisponible && (
        <div style={{ background: "rgba(239,159,39,0.10)", border: "1px solid rgba(239,159,39,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#f3c886", marginBottom: 14 }}>
          ⚠️ Números aproximados: los CPs compartidos entre zonas (48 de 515) todavía no se pueden desambiguar — falta el re-deploy del bridge (mensaje-hermes-zonas.md). Con el deploy, la atribución pasa a CP + localidad.
        </div>
      )}

      {error && (
        <div style={{ background: "rgba(226,75,74,0.10)", border: "1px solid rgba(226,75,74,0.35)", borderRadius: 12, padding: "10px 14px", fontSize: 13, color: "#f1a2a1", marginBottom: 14 }}>
          No pude actualizar recién ({error}). {listaBase.length ? "Muestro el último dato bueno." : "Reintento solo en unos minutos."}
        </div>
      )}

      {!zonas && cargando && (
        <div style={{ color: C.muted, fontSize: 14, padding: "30px 0" }}>Cargando el listado del día… la primera vez puede tardar un minuto (baja el Excel completo de LightData).</div>
      )}

      {zonas && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {items.map((it) => {
              const nombre = esTerr ? it.nombre : it.zona;
              const sub = esTerr
                ? `Titular${it.cadetes.length > 1 ? "es" : ""}: ${it.cadetes.join(" · ")}${it.notas ? " — " + it.notas : ""}`
                : (it.cadetes.length ? "La hacen: " + it.cadetes.join(" · ") : "");
              const col = colorEstado(it.estado);
              const pct = it.pct ?? 0;
              const ancho = Math.min(pct, 1.2) / 1.2;
              return (
                <div key={nombre} style={{ background: C.card, border: `1px solid ${it.estado === "saturada" ? "rgba(226,75,74,0.45)" : C.border}`, borderRadius: 12, padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{nombre}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: col }}>
                      {it.estado === "saturada" ? "🔴 SATURADO" : it.estado === "limite" ? "🟠 AL LÍMITE" : it.estado === "sintope" ? "sin tope" : "🟢 OK"}
                    </span>
                    <span style={{ marginLeft: "auto", fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                      <b>{num(it.total)}</b>{it.tope ? <span style={{ color: C.muted }}> / {num(it.tope)}</span> : null}
                      <span style={{ color: C.faint, fontSize: 12.5 }}> · {num(it.entregados)} entregados</span>
                    </span>
                  </div>
                  {sub && <div style={{ fontSize: 11.5, color: C.faint, marginBottom: 7 }}>{sub}</div>}
                  {it.tope ? (
                    <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.07)", overflow: "hidden", position: "relative" }}>
                      <div style={{ width: `${(ancho * 100).toFixed(1)}%`, height: "100%", borderRadius: 4, background: col === C.faint ? C.muted : col, transition: "width .5s" }} />
                      <div style={{ position: "absolute", left: `${((1 / 1.2) * 100).toFixed(1)}%`, top: 0, bottom: 0, width: 2, background: "rgba(255,255,255,0.35)" }} />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {items.length === 0 && <div style={{ color: C.muted, fontSize: 13, padding: "16px 4px" }}>Nada coincide con la búsqueda.</div>}
          </div>

          {(sinTope.length > 0 || (meta && (meta.sinZona > 0 || meta.sinCp > 0 || meta.ambiguos > 0))) && (
            <details style={{ marginTop: 18, color: C.muted }}>
              <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: C.text }}>
                Datos sueltos ({num(sinTope.reduce((s, z) => s + z.total, 0) + (meta ? meta.sinZona + meta.sinCp + meta.ambiguos : 0))} envíos)
              </summary>
              <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 8 }}>
                {sinTope.length > 0 && (
                  <div>Zonas con envíos pero sin cadete/tope en <code>cadete_topes</code>: {sinTope.slice(0, 15).map((z) => `${z.zona} (${num(z.total)})`).join(" · ")}{sinTope.length > 15 ? ` · +${sinTope.length - 15} más` : ""}</div>
                )}
                {meta && meta.ambiguos > 0 && <div>Envíos en CPs compartidos cuya localidad no alcanzó para decidir la zona: {num(meta.ambiguos)} (quedan fuera de las barras — mejor faltar que inflar).</div>}
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
