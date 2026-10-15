import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { sbFetch, SUPABASE_URL } from "./colectasShared";

// ── Mapa de tránsito (se abre desde el chip de Tránsito del Home) ──
// Capas, de abajo hacia arriba:
//   1. Calles de OpenStreetMap oscurecidas con un filtro CSS (mismo proveedor que Colectas/Zonas).
//   2. Tránsito en vivo de TomTom, estilo Waze: cada calle verde/amarilla/roja según su velocidad.
//      Los tiles pasan por la edge function `transito-tiles` (la key de TomTom queda en Vault).
//   3. Íconos de incidentes de TomTom (cortes, obras, choques).
//   4. Nuestras alertas: calles cortadas cerca de la base (rojo punteado), zona de la marcha (círculo),
//      y el tramo trabado de cada corredor en alerta (lo que transito_sync guardó en transito_estado.tramos).
// Lectura sola: no escribe nada.

const BASE = [-34.6145753, -58.3854936]; // Venezuela 1370
const CONGRESO = [-34.6097, -58.3926];
const TILES = `${SUPABASE_URL}/functions/v1/transito-tiles`;
const ROJO = "#E8615F", AMBAR = "#F5C044", TEAL = "#2ee6b6";

export default function TransitoMapa({ alertas, onCerrar, isMobile }) {
  const contRef = useRef(null);
  const mapRef = useRef(null);
  const capaRef = useRef(null);
  const boundsRef = useRef(null);
  const [estado, setEstado] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    sbFetch("transito_estado?select=corredor_id,tramos,geom")
      .then((rows) => setEstado(Array.isArray(rows) ? rows : []))
      .catch(() => { setEstado([]); setError("No se pudieron cargar los corredores."); });
  }, []);

  // Mapa (una sola vez)
  useEffect(() => {
    if (mapRef.current || !contRef.current) return;
    const map = L.map(contRef.current, { center: [-34.64, -58.5], zoom: 10, minZoom: 8, maxZoom: 17, zoomControl: !isMobile, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 17, className: "fx-tr-base",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Tránsito &copy; TomTom',
    }).addTo(map);
    L.tileLayer(`${TILES}/flow/{z}/{x}/{y}.png`, { maxZoom: 17, minZoom: 8, opacity: 0.95, zIndex: 3 }).addTo(map);
    L.tileLayer(`${TILES}/incidentes/{z}/{x}/{y}.png`, { maxZoom: 17, minZoom: 11, zIndex: 4 }).addTo(map);
    capaRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 80);
    const obs = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    obs?.observe(contRef.current);
    return () => { clearTimeout(t); obs?.disconnect(); map.remove(); mapRef.current = null; };
  }, [isMobile]);

  // Nuestras alertas encima
  useEffect(() => {
    const map = mapRef.current, capa = capaRef.current;
    if (!map || !capa || estado === null) return;
    capa.clearLayers();
    const puntos = [BASE];

    // Zona de la marcha (noticias que afectan la base)
    alertas.filter((a) => a.fuente === "noticias" && a.radar_base).forEach((a) => {
      L.circle(CONGRESO, { radius: 650, color: ROJO, weight: 1, fillColor: ROJO, fillOpacity: 0.14, dashArray: "4 4" })
        .bindTooltip(`<b>${a.titulo}</b>${a.hora_evento ? `<br>Desde las ${a.hora_evento} hs` : ""}`, { className: "fx-tr-tip", sticky: true })
        .addTo(capa);
      puntos.push(CONGRESO);
    });

    // Calles cortadas alrededor de la base (TomTom)
    alertas.filter((a) => a.corredor_id === "base" && a.datos && Array.isArray(a.datos.geom)).forEach((a) => {
      a.datos.geom.forEach((linea) => {
        if (!Array.isArray(linea) || linea.length < 2) return;
        L.polyline(linea, { color: "#0F0F1B", weight: 9, opacity: 0.55 }).addTo(capa);
        L.polyline(linea, { color: ROJO, weight: 5, opacity: 1, dashArray: "8 6" })
          .bindTooltip("Calle cortada", { className: "fx-tr-tip", sticky: true }).addTo(capa);
        puntos.push(...linea);
      });
    });

    // Corredores en alerta: recorrido tenue + tramo trabado marcado
    const enAlerta = new Map(alertas.filter((a) => a.fuente === "tomtom" && a.corredor_id && a.corredor_id !== "base").map((a) => [a.corredor_id, a]));
    (estado || []).forEach((e) => {
      const a = enAlerta.get(e.corredor_id);
      if (!a) return;
      if (Array.isArray(e.geom) && e.geom.length > 1) {
        L.polyline(e.geom, { color: "#ffffff", weight: 3, opacity: 0.35 })
          .bindTooltip(`<b>${a.titulo}</b><br>${a.detalle || ""}`, { className: "fx-tr-tip", sticky: true }).addTo(capa);
      }
      (e.tramos || []).filter((t) => Array.isArray(t.puntos) && t.puntos.length > 1).forEach((t) => {
        const fuerte = t.cat === "ROAD_CLOSED" || t.mag >= 3 || t.demora >= 10;
        L.polyline(t.puntos, { color: "#0F0F1B", weight: 10, opacity: 0.5 }).addTo(capa);
        L.polyline(t.puntos, { color: fuerte ? ROJO : AMBAR, weight: 6, opacity: 1 })
          .bindTooltip(`<b>${a.titulo}</b><br>${t.cat === "ROAD_CLOSED" ? "Cortado" : t.kmh ? `${t.kmh} km/h` : "Lento"}${t.demora ? ` · +${t.demora} min en este tramo` : ""}`, { className: "fx-tr-tip", sticky: true })
          .addTo(capa);
        puntos.push(...t.puntos);
      });
    });

    // La base
    L.circleMarker(BASE, { radius: 8, color: TEAL, weight: 3, fillColor: "#0F0F1B", fillOpacity: 1 })
      .bindTooltip("Base · Venezuela 1370", { className: "fx-tr-tip", permanent: !isMobile, direction: "right", offset: [8, 0] })
      .addTo(capa);

    if (puntos.length > 1) {
      const b = L.latLngBounds(puntos);
      boundsRef.current = b;
      map.fitBounds(b, { padding: [30, 30], maxZoom: 15 });
    } else {
      boundsRef.current = null;
      map.setView(BASE, 14);
    }
  }, [alertas, estado, isMobile]);

  const ir = (donde) => {
    const map = mapRef.current; if (!map) return;
    if (donde === "base") map.setView(BASE, 15);
    else if (donde === "amba") map.setView([-34.62, -58.55], 9);
    else if (boundsRef.current) map.fitBounds(boundsRef.current, { padding: [30, 30], maxZoom: 15 });
  };

  const btn = { border: "1px solid rgba(255,255,255,0.12)", background: "rgba(24,25,42,0.92)", color: "#f4f5fa", borderRadius: 10, padding: "0 12px", minHeight: 36, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
  const dot = (c) => ({ width: 10, height: 4, borderRadius: 2, background: c, display: "inline-block" });

  return (
    <div onClick={onCerrar} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(8,8,24,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 0 : 24 }}>
      <style>{`
        .fx-tr-base { filter: invert(1) hue-rotate(195deg) brightness(0.72) contrast(0.92) saturate(0.35); }
        .fx-tr-tip { background: rgba(24,25,42,0.96); color: #f4f5fa; border: 1px solid rgba(255,255,255,0.12); border-radius: 9px; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.35); }
        .fx-tr-tip.leaflet-tooltip-top:before { border-top-color: rgba(24,25,42,0.96); }
        .fx-tr-tip.leaflet-tooltip-right:before { border-right-color: rgba(24,25,42,0.96); }
        .fx-tr-mapa .leaflet-container { background: #14141f; font-family: inherit; }
        .fx-tr-mapa .leaflet-control-attribution { background: rgba(15,15,27,0.7); color: #71768e; font-size: 10px; }
        .fx-tr-mapa .leaflet-control-attribution a { color: #a7adc2; }
      `}</style>
      <div onClick={(e) => e.stopPropagation()} className="fx-tr-mapa"
        style={{ position: "relative", width: isMobile ? "100%" : "min(1040px, 100%)", height: isMobile ? "100%" : "min(720px, 100%)", background: "#0F0F1B", border: isMobile ? "none" : "1px solid rgba(255,255,255,0.08)", borderRadius: isMobile ? 0 : 20, overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 30px 80px rgba(0,0,0,0.45)", color: "#f4f5fa" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: isMobile ? "14px 14px 10px" : "14px 18px 12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Space Grotesk', -apple-system, sans-serif", fontWeight: 600, fontSize: 16 }}>Mapa de tránsito</div>
            <div style={{ fontSize: 11.5, color: "#71768e", marginTop: 2, display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={dot("#3ec46d")} />fluido</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={dot(AMBAR)} />lento</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span style={dot(ROJO)} />trabado / cortado</span>
              <span>En vivo · TomTom</span>
            </div>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar mapa" style={{ ...btn, minWidth: 36, padding: 0, fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
          <div ref={contRef} style={{ position: "absolute", inset: 0 }} />
          <div style={{ position: "absolute", left: 12, bottom: 22, zIndex: 500, display: "flex", gap: 8 }}>
            <button type="button" onClick={() => ir("alertas")} style={btn}>Alertas</button>
            <button type="button" onClick={() => ir("base")} style={btn}>Base</button>
            <button type="button" onClick={() => ir("amba")} style={btn}>Todo AMBA</button>
          </div>
          {error && <div style={{ position: "absolute", top: 12, left: 12, right: 12, zIndex: 500, fontSize: 12.5, color: ROJO, background: "rgba(24,25,42,0.95)", borderRadius: 10, padding: "8px 12px" }}>{error}</div>}
        </div>
      </div>
    </div>
  );
}
