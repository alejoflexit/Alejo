// Ubicar un cliente en el mapa desde el formulario de Clientes (alta y edición).
// Se carga con React.lazy desde Colectas.js para no sumar Leaflet al bundle principal.
// Reusa el buscador de direcciones de la vista Mapa; el pin elegido acá se guarda como
// 'manual', igual que en el Mapa, así la cola de geocoding automático nunca lo pisa.
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BRAND } from './colectasShared';
import { BuscadorDireccion } from './ColectasMapa';

const CENTRO_CABA = [-34.6083, -58.3712];
const PIN = L.divIcon({
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2ECFAA;border:2px solid #0d1b2a;box-shadow:0 2px 6px rgba(0,0,0,.5)"></div>',
  className: 'flexit-pin-form', iconSize: [22, 22], iconAnchor: [11, 22],
});

export default function ClienteUbicacion({ direccion, lat, lng, onChange }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const poner = (la, ln, centrar) => {
    const map = mapRef.current; if (!map) return;
    if (!markerRef.current) {
      markerRef.current = L.marker([la, ln], { icon: PIN, draggable: true }).addTo(map);
      markerRef.current.on('dragend', e => { const p = e.target.getLatLng(); onChangeRef.current(p.lat, p.lng); });
    } else {
      markerRef.current.setLatLng([la, ln]);
    }
    if (centrar) map.setView([la, ln], 16);
  };

  useEffect(() => {
    const tiene = lat != null && lng != null;
    const map = L.map(divRef.current, { zoomControl: true }).setView(tiene ? [lat, lng] : CENTRO_CABA, tiene ? 16 : 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    mapRef.current = map;
    if (tiene) poner(lat, lng, false);
    map.on('click', e => { poner(e.latlng.lat, e.latlng.lng, false); onChangeRef.current(e.latlng.lat, e.latlng.lng); });
    setTimeout(() => map.invalidateSize(), 50);
    return () => { map.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) minmax(280px, 2fr)', gap: 12, alignItems: 'start' }}>
      <div>
        <BuscadorDireccion inicial={direccion} onElegir={c => { poner(c.lat, c.lng, true); onChange(c.lat, c.lng); }} />
        <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 8, lineHeight: 1.5 }}>
          Buscá la dirección y elegí el resultado, o tocá el mapa donde está el cliente. El pin se puede arrastrar para ajustarlo.
        </div>
      </div>
      <div ref={divRef} style={{ height: 240, borderRadius: 10, border: `1px solid ${BRAND.border}`, overflow: 'hidden' }} />
    </div>
  );
}
