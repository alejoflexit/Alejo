import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const C = {
  card: "#1A1A4A", border: "rgba(255,255,255,0.08)", text: "#fff",
  muted: "rgba(255,255,255,0.55)", ok: "#2ECFAA", warn: "#EF9F27", crit: "#E24B4A",
};

const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\b(partido de|ciudad autonoma de buenos aires)\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const num = (n) => new Intl.NumberFormat("es-AR").format(Math.round(n || 0));

function encontrarZona(nombre, zonas) {
  const n = norm(nombre);
  const exacta = zonas.find((z) => norm(z.zona) === n);
  if (exacta) return exacta;
  const candidatas = zonas.filter((z) => {
    const nz = norm(z.zona);
    return nz.length >= 4 && (nz.includes(n) || n.includes(nz));
  });
  return candidatas.length === 1 ? candidatas[0] : null;
}

function colorZona(z) {
  if (!z || !z.tope) return z ? "#718096" : "#242C3B";
  if (z.pct >= 1) return C.crit;
  if (z.pct >= 0.85) return C.warn;
  return C.ok;
}

export default function ZonasMapa({ zonas = [], meta, filtro = "" }) {
  const contRef = useRef(null);
  const mapRef = useRef(null);
  const capaRef = useRef(null);
  const etiquetasRef = useRef(null);
  const [geo, setGeo] = useState(null);
  const [error, setError] = useState("");

  const visibles = useMemo(() => {
    const q = norm(filtro);
    return q ? zonas.filter((z) => norm(z.zona).includes(q) || (z.cadetes || []).some((c) => norm(c).includes(q))) : zonas;
  }, [zonas, filtro]);

  useEffect(() => {
    let vivo = true;
    fetch("/zonas-base.geojson")
      .then((r) => { if (!r.ok) throw new Error(`capa geografica ${r.status}`); return r.json(); })
      .then((j) => { if (vivo) setGeo(j); })
      .catch((e) => { if (vivo) setError(e.message || String(e)); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (mapRef.current || !contRef.current) return;
    const map = L.map(contRef.current, { center: [-34.64, -58.55], zoom: 9, zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    capaRef.current = L.layerGroup().addTo(map);
    etiquetasRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 80);
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geo || !capaRef.current || !etiquetasRef.current) return;
    capaRef.current.clearLayers();
    etiquetasRef.current.clearLayers();
    const q = norm(filtro);

    const layer = L.geoJSON(geo, {
      style: (feature) => {
        const z = encontrarZona(feature.properties.nombre, visibles);
        const atenuada = q && !z;
        const color = colorZona(z);
        return { color: z ? color : "rgba(255,255,255,0.24)", weight: z ? 1.8 : 1, fillColor: color, fillOpacity: atenuada ? 0.04 : z ? 0.42 : 0.10 };
      },
      onEachFeature: (feature, polygon) => {
        const z = encontrarZona(feature.properties.nombre, visibles);
        const nombre = z?.zona || feature.properties.nombre;
        const estado = !z ? "Sin datos asociados" : !z.tope ? "Sin tope configurado" : z.pct >= 1 ? "Saturada" : z.pct >= 0.85 ? "Al limite" : "En orden";
        polygon.bindTooltip(
          `<div style="min-width:170px"><b style="font-size:13px">${nombre}</b><br>` +
          (z ? `<span>${num(z.total)} envios${z.tope ? ` / ${num(z.tope)} de capacidad` : ""}</span><br><span style="color:${colorZona(z)};font-weight:700">${estado}</span>` : `<span style="opacity:.7">${estado}</span>`) +
          `</div>`,
          { sticky: true, className: "flexit-zona-tip" }
        );
        if (z && z.total > 0) {
          const centro = polygon.getBounds().getCenter();
          L.marker(centro, {
            interactive: false,
            icon: L.divIcon({
              className: "flexit-zona-label",
              html: `<div style="background:${colorZona(z)};color:#07131d;border:2px solid rgba(255,255,255,.8);border-radius:999px;min-width:30px;height:30px;padding:0 7px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;box-shadow:0 2px 8px rgba(0,0,0,.45)">${num(z.total)}</div>`,
              iconSize: [42, 30], iconAnchor: [21, 15],
            }),
          }).addTo(etiquetasRef.current);
        }
      },
    }).addTo(capaRef.current);
    if (layer.getBounds().isValid()) map.fitBounds(layer.getBounds(), { padding: [12, 12] });
  }, [geo, visibles, filtro]);

  return (
    <div>
      <style>{`
        .flexit-zona-tip { background:rgba(13,27,42,.96);border:1px solid rgba(46,207,170,.45);color:#fff;border-radius:10px;box-shadow:0 3px 14px rgba(0,0,0,.45);padding:9px 11px; }
        .flexit-zona-label { background:transparent;border:none; }
      `}</style>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "10px 13px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 13, color: C.muted }}><b style={{ color: C.text }}>{num(meta?.asignados)}</b> envios ubicados por zona</span>
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted }}>Los circulos muestran cantidades; toca un area para ver su detalle.</span>
        </div>
        {error && <div style={{ padding: 12, color: C.crit, fontSize: 13 }}>No pude cargar los limites ({error}).</div>}
        <div ref={contRef} style={{ height: "min(68vh, 650px)", minHeight: 430, background: "#101827" }} />
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: 11.5, color: C.muted }}>
        <span><b style={{ color: C.ok }}>●</b> En orden</span><span><b style={{ color: C.warn }}>●</b> Al limite</span><span><b style={{ color: C.crit }}>●</b> Saturada</span><span><b style={{ color: "#718096" }}>●</b> Sin tope</span><span>Las areas sin datos quedan oscuras.</span>
      </div>
    </div>
  );
}
