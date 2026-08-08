import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { agruparPuntos, nivelZona, normMapa, resolverCentroZona } from "./zonasMapaShared";

const C = {
  card: "#1A1A4A", border: "rgba(255,255,255,0.08)", text: "#fff",
  muted: "rgba(255,255,255,0.58)", ok: "#2ECFAA", warn: "#EF9F27", crit: "#E24B4A",
  noTop: "#8795A8", base: "#263548",
};

const num = (n) => new Intl.NumberFormat("es-AR").format(Math.round(n || 0));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const colorNivel = (nivel) => ({ critica: C.crit, limite: C.warn, ok: C.ok, sintope: C.noTop }[nivel] || C.base);
const textoNivel = (nivel) => ({ critica: "Saturada", limite: "Al límite", ok: "En orden", sintope: "Sin tope configurado" }[nivel] || "");

function htmlDetalle(z) {
  const nivel = nivelZona(z);
  const capacidad = z.tope ? ` / ${num(z.tope)} de capacidad` : "";
  const cadetes = (z.cadetes || []).length ? `<div style="opacity:.72;margin-top:5px">La hacen: ${esc(z.cadetes.join(" · "))}</div>` : "";
  return `<div style="min-width:180px"><b style="font-size:13px">${esc(z.zona)}</b><br>` +
    `<span>${num(z.total)} envíos${capacidad}</span><br>` +
    `<span style="color:${colorNivel(nivel)};font-weight:800">${textoNivel(nivel)}</span>${cadetes}</div>`;
}

export default function ZonasMapa({ zonas = [], meta, filtro = "" }) {
  const contRef = useRef(null);
  const mapRef = useRef(null);
  const baseRef = useRef(null);
  const puntosRef = useRef(null);
  const ultimoAjusteRef = useRef("");
  const [geo, setGeo] = useState(null);
  const [localidades, setLocalidades] = useState(null);
  const [error, setError] = useState("");
  const [modo, setModo] = useState("todas");

  useEffect(() => {
    let vivo = true;
    Promise.all([
      fetch("/zonas-base.geojson").then((r) => { if (!r.ok) throw new Error(`límites ${r.status}`); return r.json(); }),
      fetch("/localidades-centros.json").then((r) => { if (!r.ok) throw new Error(`localidades ${r.status}`); return r.json(); }),
    ])
      .then(([limites, centros]) => { if (vivo) { setGeo(limites); setLocalidades(centros); } })
      .catch((e) => { if (vivo) setError(e.message || String(e)); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (mapRef.current || !contRef.current) return;
    const map = L.map(contRef.current, { center: [-34.64, -58.55], zoom: 9, zoomControl: true, minZoom: 8 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    baseRef.current = L.layerGroup().addTo(map);
    puntosRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 80);
    const observador = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => map.invalidateSize()) : null;
    observador?.observe(contRef.current);
    return () => {
      clearTimeout(t);
      observador?.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!geo || !baseRef.current) return;
    baseRef.current.clearLayers();
    L.geoJSON(geo, {
      style: (feature) => ({
        color: feature.properties?.capa === "CABA" ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.20)",
        weight: feature.properties?.capa === "CABA" ? 1.1 : 1.35,
        fillColor: C.base,
        fillOpacity: feature.properties?.capa === "CABA" ? 0.055 : 0.035,
      }),
      onEachFeature: (feature, polygon) => {
        polygon.bindTooltip(`<b>${esc(feature.properties?.nombre)}</b><br><span style="opacity:.68">Límite administrativo</span>`, {
          sticky: true, className: "flexit-zona-tip flexit-zona-tip-base",
        });
      },
    }).addTo(baseRef.current);
  }, [geo]);

  const ubicaciones = useMemo(() => {
    if (!geo || !localidades) return { puntos: [], pendientes: [] };
    const puntos = [], pendientes = [];
    zonas.filter((z) => z.total > 0).forEach((z) => {
      const ubicacion = resolverCentroZona(z.zona, geo, localidades);
      if (ubicacion?.centro) puntos.push({ ...z, centro: ubicacion.centro, fuenteUbicacion: ubicacion.fuente });
      else pendientes.push(z);
    });
    return { puntos, pendientes };
  }, [zonas, geo, localidades]);

  const visibles = useMemo(() => {
    const q = normMapa(filtro);
    return ubicaciones.puntos.filter((z) => {
      const coincide = !q || normMapa(z.zona).includes(q) || (z.cadetes || []).some((c) => normMapa(c).includes(q));
      const alerta = nivelZona(z) === "critica" || nivelZona(z) === "limite";
      return coincide && (modo === "todas" || alerta);
    });
  }, [ubicaciones.puntos, filtro, modo]);

  useEffect(() => {
    const map = mapRef.current;
    const capa = puntosRef.current;
    if (!map || !capa || !geo || !localidades) return;

    const renderizar = () => {
      capa.clearLayers();
      const zoom = map.getZoom();
      const compacto = map.getSize().x < 600;
      const radio = compacto
        ? (zoom <= 8 ? 56 : zoom === 9 ? 46 : zoom === 10 ? 36 : zoom === 11 ? 28 : 0)
        : (zoom <= 8 ? 34 : zoom === 9 ? 30 : zoom === 10 ? 25 : zoom === 11 ? 20 : 0);
      const grupos = agruparPuntos(visibles, (centro) => map.latLngToContainerPoint(centro), radio);

      grupos.forEach((grupo) => {
        const esGrupo = grupo.miembros.length > 1;
        const color = colorNivel(grupo.nivel);
        const etiqueta = esGrupo ? `${grupo.miembros.length} zonas` : grupo.miembros[0].zona;
        const nombreVisible = !esGrupo && zoom >= 11 ? `<span class="flexit-map-nombre">${esc(etiqueta)}</span>` : "";
        const aria = `${etiqueta}, ${num(grupo.total)} envíos`;
        const html = `<div class="flexit-map-burbuja ${esGrupo ? "es-grupo" : ""}" style="--burbuja:${color}">` +
          `<span class="flexit-map-numero">${num(grupo.total)}</span>${esGrupo ? `<span class="flexit-map-cantidad">${grupo.miembros.length} zonas</span>` : ""}${nombreVisible}</div>`;
        const ancho = esGrupo ? 72 : 56;
        const marker = L.marker(grupo.centro, {
          keyboard: true,
          zIndexOffset: esGrupo ? 600 : 400,
          icon: L.divIcon({ className: "flexit-zona-label", html, iconSize: [ancho, 54], iconAnchor: [ancho / 2, 27] }),
        }).addTo(capa);
        marker.getElement()?.setAttribute("aria-label", aria);

        if (esGrupo) {
          const nombres = grupo.miembros.slice(0, 6).map((z) => esc(z.zona)).join(" · ");
          const resto = grupo.miembros.length > 6 ? ` · +${grupo.miembros.length - 6}` : "";
          marker.bindTooltip(`<b>${grupo.miembros.length} zonas · ${num(grupo.total)} envíos</b><br><span style="opacity:.72">${nombres}${resto}</span><br><span style="color:${color};font-weight:800">${textoNivel(grupo.nivel)}</span>`, {
            direction: "top", offset: [0, -22], className: "flexit-zona-tip",
          });
          marker.on("click", () => map.flyTo(grupo.centro, Math.min(zoom + 2, 12), { duration: 0.45 }));
        } else {
          const z = grupo.miembros[0];
          marker.bindTooltip(htmlDetalle(z), { direction: "top", offset: [0, -22], className: "flexit-zona-tip" });
          marker.bindPopup(htmlDetalle(z), { className: "flexit-zona-popup", closeButton: false, offset: [0, -15] });
        }
      });
    };

    map.on("zoomend moveend", renderizar);
    renderizar();

    const ajuste = `${modo}|${normMapa(filtro)}|${visibles.map((z) => z.zona).join("|")}`;
    if (ajuste !== ultimoAjusteRef.current && visibles.length) {
      ultimoAjusteRef.current = ajuste;
      const bounds = L.latLngBounds(visibles.map((z) => z.centro));
      if (bounds.isValid()) map.fitBounds(bounds.pad(filtro || modo === "alertas" ? 0.32 : 0.12), { maxZoom: filtro || modo === "alertas" ? 12 : 10, padding: [24, 24] });
    }

    return () => map.off("zoomend moveend", renderizar);
  }, [geo, localidades, visibles, filtro, modo]);

  const estadoDato = meta?.modo === "foto" ? "Foto 14:30" : meta ? "En vivo" : "";
  const alertas = ubicaciones.puntos.filter((z) => ["critica", "limite"].includes(nivelZona(z))).length;
  const mensajeVacio = modo === "alertas" ? "✓ No hay zonas en alerta" : filtro ? "Nada coincide con la búsqueda" : "No hay envíos para mostrar";

  return (
    <div>
      <style>{`
        .flexit-zona-tip { background:rgba(13,27,42,.97);border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:10px;box-shadow:0 5px 18px rgba(0,0,0,.42);padding:9px 11px;line-height:1.4; }
        .flexit-zona-tip-base { border-color:rgba(255,255,255,.12); }
        .flexit-zona-label { background:transparent;border:none;overflow:visible!important; }
        .flexit-map-burbuja { position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:40px;height:40px;padding:0 7px;border-radius:999px;background:var(--burbuja);color:#06121c;border:2px solid rgba(255,255,255,.88);display:flex;align-items:center;justify-content:center;box-sizing:border-box;box-shadow:0 3px 11px rgba(0,0,0,.5);font-weight:900;cursor:pointer;white-space:nowrap;transition:transform .15s,filter .15s; }
        .flexit-map-burbuja:hover,.flexit-map-burbuja:focus { transform:translate(-50%,-50%) scale(1.08);filter:brightness(1.08); }
        .flexit-map-burbuja.es-grupo { min-width:58px;height:48px;padding:4px 9px;flex-direction:column;line-height:1.02; }
        .flexit-map-numero { font-size:12px;font-variant-numeric:tabular-nums; }
        .flexit-map-burbuja.es-grupo .flexit-map-numero { font-size:13px; }
        .flexit-map-cantidad { font-size:8.5px;font-weight:800;opacity:.76;margin-top:2px; }
        .flexit-map-nombre { position:absolute;left:50%;top:39px;transform:translateX(-50%);background:rgba(10,20,34,.9);color:#fff;border:1px solid rgba(255,255,255,.14);padding:2px 6px;border-radius:5px;font-size:9.5px;font-weight:700;box-shadow:0 2px 7px rgba(0,0,0,.35); }
        .flexit-zona-popup .leaflet-popup-content-wrapper,.flexit-zona-popup .leaflet-popup-tip { background:#0d1b2a;color:#fff; }
        .flexit-mapa-modo:focus-visible { outline:2px solid ${C.ok};outline-offset:2px; }
        @media (max-width:600px) { .flexit-mapa-ayuda { display:none; } .flexit-map-nombre { display:none; } }
      `}</style>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 12.5, color: C.muted }}>
            <b style={{ color: C.text }}>{num(meta?.asignados)}</b> envíos ubicados{estadoDato ? <span style={{ color: C.ok }}> · {estadoDato}</span> : null}
          </span>
          <div style={{ display: "flex", background: "rgba(255,255,255,.045)", border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }} aria-label="Qué zonas mostrar">
            {[["todas", "Todas"], ["alertas", `Alertas ${alertas}`]].map(([k, label]) => (
              <button key={k} className="flexit-mapa-modo" onClick={() => setModo(k)} aria-pressed={modo === k}
                style={{ minHeight: 36, background: modo === k ? "rgba(46,207,170,.16)" : "transparent", border: "none", color: modo === k ? C.ok : C.muted, padding: "0 11px", fontSize: 12, fontWeight: modo === k ? 800 : 600, cursor: "pointer" }}>
                {label}
              </button>
            ))}
          </div>
          {ubicaciones.pendientes.length > 0 && (
            <span title={ubicaciones.pendientes.map((z) => z.zona).join(", ")} style={{ fontSize: 11, color: C.warn }}>ⓘ {ubicaciones.pendientes.length} por ubicar</span>
          )}
          <span className="flexit-mapa-ayuda" style={{ marginLeft: "auto", fontSize: 11.5, color: C.muted }}>Tocá un grupo para acercar · tocá una zona para ver el detalle</span>
        </div>
        {error && <div style={{ padding: 12, color: C.crit, fontSize: 13 }}>No pude cargar la referencia geográfica ({error}).</div>}
        {!error && (!geo || !localidades) && <div style={{ padding: 12, color: C.muted, fontSize: 13 }}>Preparando el mapa…</div>}
        <div style={{ position: "relative" }}>
          <div ref={contRef} role="region" aria-label="Mapa operativo de envíos por zona" style={{ height: "clamp(500px, calc(100vh - 225px), 760px)", minHeight: 500, background: "#101827" }} />
          {visibles.length === 0 && geo && localidades && (
            <div style={{ position: "absolute", zIndex: 800, left: "50%", top: 18, transform: "translateX(-50%)", background: "rgba(13,27,42,.94)", border: `1px solid ${C.ok}`, borderRadius: 999, color: C.text, fontSize: 12.5, fontWeight: 700, padding: "8px 13px", boxShadow: "0 4px 14px rgba(0,0,0,.35)", whiteSpace: "nowrap" }}>
              {mensajeVacio}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8, fontSize: 11.5, color: C.muted }}>
        <span><b style={{ color: C.ok }}>●</b> En orden</span><span><b style={{ color: C.warn }}>●</b> Al límite</span><span><b style={{ color: C.crit }}>●</b> Saturada</span><span><b style={{ color: C.noTop }}>●</b> Sin tope</span>
        <span style={{ marginLeft: "auto" }}>Los bordes son referencia; las burbujas son las zonas operativas · centros de <a href="https://www.argentina.gob.ar/georef" target="_blank" rel="noreferrer" style={{ color: C.muted }}>GeoRef</a>.</span>
      </div>
    </div>
  );
}
