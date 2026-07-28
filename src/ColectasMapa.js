// Vista Mapa de Colectas — pines por cliente del día, asignación por lazo y ajuste manual de pines.
// Spec: wiki/analisis/spec-colectas-mapa.md. Se carga con React.lazy desde Colectas.js.
// Leaflet se usa con su API imperativa (sin react-leaflet): el lazo necesita control fino de
// pointer events y los markers se reconcilian a mano para no perder el drag ni el panel abierto.
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { BRAND, VEHICULOS, normNombre, estadoEfectivo, ChoferPicker } from './colectasShared';

const CENTRO_CABA = [-34.6083, -58.3712];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Las direcciones de los clientes traen la referencia pegada ("piso 3", "timbre 4B",
// "entre Conde y Superí", "consultar en la papelera de al lado"). Nominatim no las entiende:
// medido sobre las 57 de CABA, mandarlas crudas falla el 54%; recortadas a "calle + altura",
// el 95%. Lo que queda son typos de la dirección cargada (Humbolt, Billingurst) — esos se
// arreglan editando el cliente o poniendo el pin a mano.
const JUNK_DIRECCION = /\b(entre|piso|pisos|p\.?b\.?|timbre|depto|dpto|dto|departamento|local|oficina|of|uf|casa|esquina|esq|consultar|puerta|torre|interno|planta|altura|cochera|frente|fondo|galpon|nave|lote|manzana|mza)\d*\b/i;

export function limpiarDireccion(dir) {
  let s = String(dir || '').split(',')[0].split('(')[0];
  const m = s.match(JUNK_DIRECCION);
  if (m) s = s.slice(0, m.index);
  s = s.replace(/\bcaba\b/ig, ' ').replace(/\s+/g, ' ').trim();
  // cortar después de la última altura suelta ("directorio 314 2D" → "directorio 314";
  // "Av. 9 de Julio 1000" se conserva entero porque el último número suelto es la altura)
  const nums = [...s.matchAll(/\b\d+\b/g)];
  if (nums.length) { const u = nums[nums.length - 1]; s = s.slice(0, u.index + u[0].length); }
  return s.replace(/[\s.-]+$/, '').trim();
}

// Cercos geográficos: sin esto, una calle homónima manda el pin a otra ciudad (pasó de verdad:
// "santa fe 1780" cayó en Bahía Blanca y "JOSE A CABRERA 5475" en Mar del Plata).
const CAJA_CABA = '-58.531,-34.527,-58.335,-34.700';   // CABA propiamente dicha
const CAJA_AMBA = '-59.8,-33.8,-57.8,-35.4';           // CABA + conurbano, para SUR y NOROESTE
// Límite duro de aceptación: un cliente de CABA tiene que caer EN CABA (la consulta
// estructurada no lleva viewbox, así que sin este chequeo podía devolver un homónimo lejos).
const LIMITE_AMBA = { latMin: -35.4,   latMax: -33.8,   lngMin: -59.8,   lngMax: -57.8 };
const LIMITE_CABA = { latMin: -34.712, latMax: -34.520, lngMin: -58.540, lngMax: -58.325 };

const enc = encodeURIComponent;

// Devuelve {lat,lng} o null. Tres intentos en cascada, del más preciso al más laxo:
//   1) consulta ESTRUCTURADA (street + city). Es la que mejor funciona y en CABA no se escapa
//      del partido: recupera casos que la búsqueda libre resuelve mal ("santa fe 1780").
//   2) libre con el barrio, acotada por caja.
//   3) libre sin el barrio, acotada por caja — en CABA el barrio a veces confunde al buscador.
// Cualquier resultado fuera del AMBA se descarta: mejor "sin ubicar" que un pin en otra provincia.
async function buscarUbicacion(direccion, zonaBarrio, seccion) {
  const limpia = limpiarDireccion(direccion);
  if (!limpia) return null;
  const esCABA = seccion === 'CABA';
  const caja = esCABA ? CAJA_CABA : CAJA_AMBA;
  const ciudad = esCABA ? 'Ciudad Autónoma de Buenos Aires' : (zonaBarrio || 'Buenos Aires');
  const intentos = [
    `street=${enc(limpia)}&city=${enc(ciudad)}&country=Argentina`,
    `q=${enc([limpia, zonaBarrio, 'Buenos Aires', 'Argentina'].filter(Boolean).join(', '))}&viewbox=${caja}&bounded=1`,
    `q=${enc([limpia, 'Buenos Aires', 'Argentina'].join(', '))}&viewbox=${caja}&bounded=1`,
  ];
  for (let k = 0; k < intentos.length; k++) {
    if (k) await sleep(1100); // rate limit duro de Nominatim, también entre reintentos
    const res = await fetch(`${NOMINATIM}?format=json&limit=1&countrycodes=ar&${intentos[k]}`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (json && json[0]) {
      const lat = Number(json[0].lat), lng = Number(json[0].lon);
      const lim = esCABA ? LIMITE_CABA : LIMITE_AMBA;
      const dentro = lat >= lim.latMin && lat <= lim.latMax && lng >= lim.lngMin && lng <= lim.lngMax;
      if (dentro) return { lat, lng };
    }
  }
  return null;
}

// Color estable por chofer (mismo nombre → mismo color en todas las sesiones)
function colorChofer(nombre) {
  const n = normNombre(nombre);
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return `hsl(${h}, 72%, 58%)`;
}

const COLOR_ESTADO = {
  blanco:   'rgba(255,255,255,0.45)',
  amarillo: '#FBBF24',
  verde:    '#2ECFAA',
};

// Chips-filtro por estado: filtran los pines y a la vez son la leyenda de colores
// (el circulito de cada chip replica el estilo real del pin de ese estado).
const FILTROS_ESTADO = [
  { est: 'blanco',   label: 'Pendiente',   color: '#9CA3AF', relleno: 'rgba(148,155,166,0.92)', borde: 'rgba(255,255,255,0.45)' },
  { est: 'amarillo', label: 'A confirmar', color: '#FBBF24', relleno: 'rgba(251,191,36,0.25)', borde: '#FBBF24' },
  { est: 'verde',    label: 'Confirmado',  color: '#2ECFAA', relleno: 'rgba(46,207,170,0.25)', borde: '#2ECFAA' },
];

// Punto dentro de polígono (ray casting sobre lat/lng)
function dentroDePoligono(punto, poligono) {
  const [x, y] = punto;
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const [xi, yi] = poligono[i];
    const [xj, yj] = poligono[j];
    const cruza = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (cruza) dentro = !dentro;
  }
  return dentro;
}

// Dos buscadores de direcciones. Nominatim tiene un límite duro de 1 consulta/segundo por IP:
// si la cola de geocoding está corriendo (o corrió mucho hoy), una búsqueda manual encima puede
// caer bloqueada ("Failed to fetch", sin CORS en la respuesta de bloqueo). Photon (komoot) es el
// respaldo: mismo mapa OSM, sin ese límite, y además tolera mejor los typos.
const dentroAMBA = r =>
  r.lat >= LIMITE_AMBA.latMin && r.lat <= LIMITE_AMBA.latMax &&
  r.lng >= LIMITE_AMBA.lngMin && r.lng <= LIMITE_AMBA.lngMax;

async function candidatosNominatim(texto) {
  const res = await fetch(`${NOMINATIM}?format=json&limit=5&countrycodes=ar&viewbox=${CAJA_AMBA}&bounded=1&q=${enc(texto + ', Argentina')}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return (json || [])
    .map(r => ({ lat: Number(r.lat), lng: Number(r.lon), nombre: String(r.display_name || '').split(',').slice(0, 3).join(',') }))
    .filter(dentroAMBA);
}

async function candidatosPhoton(texto) {
  // bbox de Photon: lngMin,latMin,lngMax,latMax (el AMBA)
  const res = await fetch(`https://photon.komoot.io/api/?limit=5&lang=default&bbox=-59.8,-35.4,-57.8,-33.8&q=${enc(texto)}`);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return (json?.features || [])
    .map(f => {
      const [lng, lat] = f.geometry?.coordinates || [];
      const p = f.properties || {};
      const calle = [p.street || p.name, p.housenumber].filter(Boolean).join(' ');
      const nombre = [calle, p.district, p.city || p.county, p.state].filter(Boolean).slice(0, 3).join(', ');
      return { lat: Number(lat), lng: Number(lng), nombre: nombre || 'Resultado sin nombre' };
    })
    .filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng) && dentroAMBA(r));
}

// Buscador de direcciones estilo Google Maps: escribís → 🔍 → candidatos → elegís uno.
// El pin elegido por búsqueda se guarda como manual (el geocoding automático nunca lo pisa).
function BuscadorDireccion({ inicial, onElegir }) {
  const [texto, setTexto] = useState(inicial || '');
  const [candidatos, setCandidatos] = useState(null); // null = sin buscar | [] = sin resultados
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');

  const buscar = async () => {
    if (!texto.trim() || buscando) return;
    const t = texto.trim();
    setBuscando(true); setError(''); setCandidatos(null);
    let lista = null;
    let falloNominatim = '';
    try { lista = await candidatosNominatim(t); } catch (e) { falloNominatim = e.message || String(e); }
    if (!lista || !lista.length) {
      // Nominatim falló o no encontró nada → probar con el respaldo
      try { lista = await candidatosPhoton(t); } catch (e) {
        if (falloNominatim) {
          setError('Los dos buscadores fallaron (' + falloNominatim + '). Esperá unos segundos y probá de nuevo, o poné el pin a mano.');
          setBuscando(false);
          return;
        }
        lista = [];
      }
    }
    setCandidatos(lista || []);
    setBuscando(false);
  };

  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={texto} onChange={e => setTexto(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') buscar(); }}
          placeholder="Calle y altura, localidad…"
          style={{ flex: 1, minWidth: 0, padding: '7px 10px', borderRadius: 8, border: `1px solid ${BRAND.border}`, background: '#14171c', color: '#fff', fontSize: 13 }} />
        <button onClick={buscar} disabled={buscando}
          style={{ padding: '0 14px', minHeight: 34, borderRadius: 8, border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: '#fff', fontSize: 13, cursor: 'pointer', touchAction: 'manipulation' }}>
          {buscando ? '…' : '🔍 Buscar'}
        </button>
      </div>
      {error && <div style={{ fontSize: 12, color: '#E24B4A', marginTop: 6 }}>{error}</div>}
      {candidatos && !candidatos.length && (
        <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 6 }}>
          Sin resultados por la zona — probá "calle altura, localidad" o poné el pin a mano.
        </div>
      )}
      {candidatos?.map((cand, i) => (
        <button key={i} onClick={() => onElegir(cand)}
          style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 6, padding: '8px 10px', borderRadius: 8, border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: '#fff', fontSize: 12, cursor: 'pointer', touchAction: 'manipulation' }}>
          📍 {cand.nombre}
        </button>
      ))}
    </div>
  );
}

export default function ColectasMapa({
  clientes,          // ya filtrados por pestaña y activos
  registros,
  choferesFull,
  updateRegistro,
  onGeoUpdate,       // (clienteId, { lat, lng, geo_fuente, geo_direccion }) => Promise
  fecha,
  setFecha,
  tab,
  esMovil,
}) {
  const contRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());   // clienteId -> { marker, key }
  const capaRef = useRef(null);           // LayerGroup de pines
  const dibujoRef = useRef(null);         // polyline en vivo
  const poligonoRef = useRef(null);       // polígono cerrado de la selección
  const puntosRef = useRef([]);
  const encuadreRef = useRef('');

  const clientesRef = useRef(clientes);
  const visiblesRef = useRef([]);
  const dibujandoRef = useRef(false);
  const intentadosRef = useRef(new Set());  // `${id}|${direccion}` ya intentados en esta sesión
  const corriendoRef = useRef(false);       // hay una cola de geocoding en curso
  const vivoRef = useRef(true);             // false al desmontar: única razón para abortar la cola
  useEffect(() => { clientesRef.current = clientes; }, [clientes]);
  useEffect(() => { vivoRef.current = true; return () => { vivoRef.current = false; }; }, []);

  const [listo, setListo] = useState(false);
  const [sel, setSel] = useState(null);           // cliente_id del panel de detalle
  const [progreso, setProgreso] = useState(null); // { hechos, total }
  const [sinUbicar, setSinUbicar] = useState([]); // ids que Nominatim no encontró
  const [ubicando, setUbicando] = useState(null); // id esperando click en el mapa
  const [sinUbicarOpen, setSinUbicarOpen] = useState(false);
  const [lazo, setLazo] = useState(false);
  const [seleccion, setSeleccion] = useState(null); // { ids: [], excluidos: Set }
  const [ajustando, setAjustando] = useState(false);
  const [guardado, setGuardado] = useState('');
  const [geoError, setGeoError] = useState('');
  const [choferFoco, setChoferFoco] = useState(null); // leyenda: resaltar un chofer
  const [filtroEst, setFiltroEst] = useState(null);   // null = todos | 'blanco' | 'amarillo' | 'verde'
  const [buscandoDir, setBuscandoDir] = useState(null); // cliente_id con el buscador de dirección abierto
  const [buscaChofer, setBuscaChofer] = useState('');

  // Clientes que van al mapa: los "sin envíos" de hoy no se muestran (info muerta)
  const activos = useMemo(
    () => clientes.filter(c => estadoEfectivo(c, registros[c.id]) !== 'rojo'),
    [clientes, registros]
  );
  // La cola de geocoding trabaja sobre TODOS los activos, tenga o no un filtro de estado puesto
  visiblesRef.current = activos;
  // Conteo por estado para los chips-filtro
  const porEstado = useMemo(() => {
    const acc = { blanco: 0, amarillo: 0, verde: 0 };
    activos.forEach(c => { const e = estadoEfectivo(c, registros[c.id]); if (acc[e] != null) acc[e]++; });
    return acc;
  }, [activos, registros]);
  const visibles = useMemo(
    () => (filtroEst ? activos.filter(c => estadoEfectivo(c, registros[c.id]) === filtroEst) : activos),
    [activos, registros, filtroEst]
  );
  const conPin = useMemo(
    () => visibles.filter(c => typeof c.lat === 'number' && typeof c.lng === 'number'),
    [visibles]
  );

  const choferesDe = useCallback(
    c => { const chs = registros[c.id]?.choferes; return chs?.length ? chs : ['A coordinar']; },
    [registros]
  );

  // Ubicar un cliente eligiendo un resultado del buscador de direcciones
  const elegirUbicacion = useCallback(async (c, cand) => {
    await onGeoUpdate(c.id, { lat: cand.lat, lng: cand.lng, geo_fuente: 'manual', geo_direccion: c.direccion });
    setSinUbicar(prev => prev.filter(id => id !== c.id));
    setBuscandoDir(null);
    if (mapRef.current) mapRef.current.setView([cand.lat, cand.lng], Math.max(mapRef.current.getZoom(), 15));
    setGuardado(c.nombre);
    setTimeout(() => setGuardado(g => (g === c.nombre ? '' : g)), 1800);
  }, [onGeoUpdate]);

  // ── Mapa: init ──
  useEffect(() => {
    if (mapRef.current || !contRef.current) return;
    const map = L.map(contRef.current, { center: CENTRO_CABA, zoom: 11, zoomControl: true, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    capaRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    setListo(true);
    const t = setTimeout(() => { if (mapRef.current === map) map.invalidateSize(); }, 50);
    const markers = markersRef.current;
    return () => { clearTimeout(t); map.remove(); mapRef.current = null; markers.clear(); };
  }, []);

  // ── Geocodificación (Nominatim, 1 req/s, cache en la base) ──
  // OJO: la cola NO se puede cancelar cuando cambia la lista de pendientes. La primera versión
  // dependía de una clave derivada del set de "ya intentados" que la propia cola iba llenando:
  // al primer setProgreso el efecto se re-ejecutaba, el cleanup marcaba cancelado y la cola moría
  // antes del primer request (síntoma: mapa sin ningún pin y sin barra de progreso). Ahora la
  // corrida es un singleton con corriendoRef y solo aborta al desmontar el componente.
  const firmaGeo = activos.map(c => `${c.id}:${c.direccion}:${c.lat ?? ''}:${c.geo_fuente ?? ''}`).join('|');

  useEffect(() => {
    if (corriendoRef.current) return;
    const pendientes = visiblesRef.current.filter(c => {
      if (c.geo_fuente === 'manual') return false;                                  // el pin a mano nunca se pisa
      if (intentadosRef.current.has(`${c.id}|${c.direccion}`)) return false;         // ya se intentó en esta sesión
      if (typeof c.lat !== 'number') return true;                                    // nunca se ubicó
      return c.geo_direccion !== c.direccion;                                        // cambió la dirección → re-geocodificar
    });
    if (!pendientes.length) { setProgreso(null); return; }

    corriendoRef.current = true;
    (async () => {
      setProgreso({ hechos: 0, total: pendientes.length });
      const fallados = [];
      let errores = 0, ultimoError = '';
      for (let i = 0; i < pendientes.length; i++) {
        if (!vivoRef.current) break;
        const c = pendientes[i];
        intentadosRef.current.add(`${c.id}|${c.direccion}`);
        try {
          const punto = await buscarUbicacion(c.direccion, c.zona_barrio, c.seccion);
          if (punto) {
            await onGeoUpdate(c.id, { ...punto, geo_fuente: 'auto', geo_direccion: c.direccion });
          } else {
            fallados.push(c.id); // dirección que Nominatim no reconoce → panel "Sin ubicar"
          }
        } catch (e) {
          fallados.push(c.id);
          errores++; ultimoError = e.message || String(e);
        }
        if (!vivoRef.current) break;
        setProgreso({ hechos: i + 1, total: pendientes.length });
        if (i < pendientes.length - 1) await sleep(1100); // rate limit duro de Nominatim
      }
      corriendoRef.current = false;
      if (!vivoRef.current) return;
      setSinUbicar(prev => [...new Set([...prev, ...fallados])]);
      // Distinguir "no encontró la dirección" de "el servicio falló" — si no, un bloqueo de red
      // se ve igual que 47 direcciones mal escritas.
      setGeoError(errores ? `${errores} pedido(s) al buscador de direcciones fallaron (${ultimoError}).` : '');
      setProgreso(null);
    })();
  }, [firmaGeo, onGeoUpdate]);

  // ── Pines: reconciliación (crear / actualizar / borrar) ──
  useEffect(() => {
    if (!listo || !capaRef.current) return;
    const vivos = new Set();

    conPin.forEach(c => {
      vivos.add(c.id);
      const reg = registros[c.id];
      const est = estadoEfectivo(c, reg);
      const chs = choferesDe(c);
      const sinAsignar = chs.every(x => x === 'A coordinar');
      const chofer = sinAsignar ? null : chs.find(x => x !== 'A coordinar');
      const atenuado = choferFoco && chofer !== choferFoco;
      const enSeleccion = seleccion?.ids.includes(c.id) && !seleccion.excluidos.has(c.id);
      const emoji = VEHICULOS[c.vehiculo]?.emoji || '📦';
      const key = [est, chofer || '-', atenuado ? 'a' : '', enSeleccion ? 's' : '', emoji, c.lat, c.lng].join('|');

      let entry = markersRef.current.get(c.id);
      if (!entry) {
        // Nacen draggable para que Leaflet les cree el handler de arrastre, pero arrancan
        // deshabilitados. OJO: `marker.dragging` NO existe hasta que el marker está agregado al
        // mapa (se crea en _initInteraction, dentro de onAdd) — desactivarlo antes tira
        // TypeError y, sin error boundary, se lleva puesta toda la pantalla de Colectas.
        const marker = L.marker([c.lat, c.lng], { draggable: true, riseOnHover: true });
        marker.on('click', () => { setSel(c.id); });
        marker.on('dragend', async ev => {
          const { lat, lng } = ev.target.getLatLng();
          const actual = clientesRef.current.find(x => x.id === c.id) || c;
          await onGeoUpdate(c.id, { lat, lng, geo_fuente: 'manual', geo_direccion: actual.direccion });
          setGuardado(actual.nombre);
          setTimeout(() => setGuardado(g => (g === actual.nombre ? '' : g)), 1800);
        });
        marker.addTo(capaRef.current);
        if (marker.dragging) marker.dragging.disable();
        entry = { marker, key: null };
        markersRef.current.set(c.id, entry);
      }
      const pos = entry.marker.getLatLng();
      if (pos.lat !== c.lat || pos.lng !== c.lng) entry.marker.setLatLng([c.lat, c.lng]);

      if (entry.key !== key) {
        const borde = COLOR_ESTADO[est] || COLOR_ESTADO.blanco;
        const fondo = est === 'blanco' ? 'rgba(148,155,166,0.92)' : est === 'verde' ? 'rgba(46,207,170,0.22)' : 'rgba(251,191,36,0.20)';
        const punto = sinAsignar
          ? `<span style="width:11px;height:11px;border-radius:50%;border:2px dashed rgba(255,255,255,0.55);background:transparent;display:block"></span>`
          : `<span style="width:11px;height:11px;border-radius:50%;background:${colorChofer(chofer)};border:1.5px solid rgba(0,0,0,0.45);display:block"></span>`;
        const html = `
          <div style="position:relative;opacity:${atenuado ? 0.28 : 1};transition:opacity .15s">
            <div style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;
              border:2.5px solid ${enSeleccion ? '#8EC5FF' : borde};background:${fondo};font-size:17px;line-height:1;
              box-shadow:${enSeleccion ? '0 0 0 4px rgba(142,197,255,0.35)' : '0 2px 6px rgba(0,0,0,0.5)'}">${emoji}</div>
            <div style="position:absolute;right:-2px;bottom:-2px">${punto}</div>
          </div>`;
        entry.marker.setIcon(L.divIcon({ html, className: 'flexit-pin', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18] }));
        entry.key = key;
      }

      if (entry.marker.dragging) {
        if (ajustando) entry.marker.dragging.enable(); else entry.marker.dragging.disable();
      }
    });

    markersRef.current.forEach((entry, id) => {
      if (!vivos.has(id)) { capaRef.current.removeLayer(entry.marker); markersRef.current.delete(id); }
    });
  }, [listo, conPin, registros, choferFoco, seleccion, ajustando, choferesDe, onGeoUpdate]);

  // ── Encuadre inicial por pestaña/fecha ──
  useEffect(() => {
    if (!listo || !mapRef.current) return;
    // Mientras la cola de geocoding sigue agregando pines, la clave incluye cuántos hay: así el
    // encuadre acompaña en vez de quedarse fijo en los 2 primeros que llegaron.
    const clave = progreso ? `${tab}|${fecha}|${conPin.length}` : `${tab}|${fecha}`;
    if (encuadreRef.current === clave || !conPin.length) return;
    encuadreRef.current = clave;
    const bounds = L.latLngBounds(conPin.map(c => [c.lat, c.lng]));
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }, [listo, tab, fecha, conPin, progreso]);

  // ── Click en el mapa para ubicar a mano un cliente sin geocodificar ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ubicando) return;
    const h = async e => {
      const c = clientes.find(x => x.id === ubicando);
      await onGeoUpdate(ubicando, { lat: e.latlng.lat, lng: e.latlng.lng, geo_fuente: 'manual', geo_direccion: c?.direccion ?? null });
      setSinUbicar(prev => prev.filter(id => id !== ubicando));
      setUbicando(null);
    };
    map.on('click', h);
    return () => map.off('click', h);
  }, [ubicando, clientes, onGeoUpdate]);

  // ── Modo lazo: el drag del mapa se apaga mientras se dibuja ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (lazo) { map.dragging.disable(); map.doubleClickZoom.disable(); }
    else { map.dragging.enable(); map.doubleClickZoom.enable(); }
  }, [lazo]);

  const limpiarTrazo = useCallback(() => {
    const map = mapRef.current;
    if (dibujoRef.current && map) { map.removeLayer(dibujoRef.current); dibujoRef.current = null; }
    if (poligonoRef.current && map) { map.removeLayer(poligonoRef.current); poligonoRef.current = null; }
    puntosRef.current = [];
  }, []);

  const cancelarSeleccion = useCallback(() => { limpiarTrazo(); setSeleccion(null); }, [limpiarTrazo]);

  // Esc cancela el lazo / la selección
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') { cancelarSeleccion(); setLazo(false); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [cancelarSeleccion]);

  const puntoDeEvento = e => {
    const map = mapRef.current;
    const rect = contRef.current.getBoundingClientRect();
    return map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));
  };

  const onLazoDown = e => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    cancelarSeleccion();
    dibujandoRef.current = true;
    const ll = puntoDeEvento(e);
    puntosRef.current = [[ll.lat, ll.lng]];
    dibujoRef.current = L.polyline(puntosRef.current, { color: '#8EC5FF', weight: 3, dashArray: '6 4' }).addTo(mapRef.current);
  };

  const onLazoMove = e => {
    if (!dibujandoRef.current || !dibujoRef.current) return;
    const ll = puntoDeEvento(e);
    const ult = puntosRef.current[puntosRef.current.length - 1];
    if (ult && Math.abs(ult[0] - ll.lat) < 1e-6 && Math.abs(ult[1] - ll.lng) < 1e-6) return;
    puntosRef.current.push([ll.lat, ll.lng]);
    dibujoRef.current.setLatLngs(puntosRef.current);
  };

  const onLazoUp = () => {
    if (!dibujandoRef.current) return;
    dibujandoRef.current = false;
    const pts = puntosRef.current;
    if (pts.length < 3) { limpiarTrazo(); return; }
    const dentro = conPin.filter(c => dentroDePoligono([c.lat, c.lng], pts)).map(c => c.id);
    if (dibujoRef.current) { mapRef.current.removeLayer(dibujoRef.current); dibujoRef.current = null; }
    if (!dentro.length) { limpiarTrazo(); setSeleccion(null); return; }
    poligonoRef.current = L.polygon(pts, { color: '#8EC5FF', weight: 2, fillColor: '#8EC5FF', fillOpacity: 0.08 }).addTo(mapRef.current);
    setSeleccion({ ids: dentro, excluidos: new Set() });
    setBuscaChofer('');
  };

  const asignarBloque = async chofer => {
    if (!seleccion) return;
    const ids = seleccion.ids.filter(id => !seleccion.excluidos.has(id));
    // No se toca estado ni confirmado_por: asignar ≠ confirmar.
    ids.forEach(id => updateRegistro(id, { choferes: [chofer] }));
    cancelarSeleccion();
    setLazo(false);
    setGuardado(`${ids.length} colecta(s) → ${chofer}`);
    setTimeout(() => setGuardado(''), 2500);
  };

  // ── Leyenda por chofer ──
  const leyenda = useMemo(() => {
    const acc = new Map();
    conPin.forEach(c => {
      const chs = choferesDe(c);
      chs.forEach(ch => acc.set(ch, (acc.get(ch) || 0) + 1));
    });
    return [...acc.entries()].sort((a, b) => (a[0] === 'A coordinar' ? -1 : b[0] === 'A coordinar' ? 1 : b[1] - a[1]));
  }, [conPin, choferesDe]);

  const clienteSel = sel ? clientes.find(c => c.id === sel) : null;
  const sinUbicarClientes = clientes.filter(c => sinUbicar.includes(c.id));
  const btn = (activo, color = BRAND.teal) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 9,
    border: `1px solid ${activo ? color : BRAND.border}`, background: activo ? `${color}22` : BRAND.faint,
    color: activo ? color : BRAND.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer', touchAction: 'manipulation',
  });

  return (
    <div>
      {/* Barra de herramientas */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: BRAND.muted }}>
          <span>📅</span>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${BRAND.border}`, background: '#14171c', color: '#fff', fontSize: 13 }} />
        </div>
        <button onClick={() => { setLazo(v => !v); cancelarSeleccion(); setAjustando(false); }} style={btn(lazo, '#8EC5FF')}
          title="Dibujar alrededor de varias colectas para asignarlas juntas">
          ✏️ Lazo
        </button>
        <button onClick={() => { setAjustando(v => !v); setLazo(false); cancelarSeleccion(); }} style={btn(ajustando, '#FBBF24')}
          title="Arrastrar los pines para corregir su posición">
          📌 Ajustar pines
        </button>
        {FILTROS_ESTADO.map(f => (
          <button key={f.est} onClick={() => setFiltroEst(v => (v === f.est ? null : f.est))}
            title={filtroEst === f.est ? 'Ver todos' : `Ver solo ${f.label.toLowerCase()}`}
            style={{ ...btn(filtroEst === f.est, f.color), height: 30, padding: '0 10px', fontSize: 12 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', flexShrink: 0, boxSizing: 'border-box', background: f.relleno, border: `2px solid ${f.borde}` }} />
            {f.label} {porEstado[f.est]}
          </button>
        ))}
        <span style={{ fontSize: 12, color: BRAND.muted }}>{conPin.length} en el mapa</span>
        {progreso && (
          <span style={{ fontSize: 12, color: '#8EC5FF' }}>Ubicando clientes… {progreso.hechos}/{progreso.total}</span>
        )}
        {guardado && <span style={{ fontSize: 12, color: BRAND.teal }}>✓ {guardado}</span>}
        {geoError && <span style={{ fontSize: 12, color: '#E24B4A' }}>⚠️ {geoError}</span>}
        {sinUbicarClientes.length > 0 && (
          <button onClick={() => setSinUbicarOpen(v => !v)} style={btn(sinUbicarOpen, '#E24B4A')}>
            Sin ubicar ({sinUbicarClientes.length})
          </button>
        )}
      </div>

      {sinUbicarOpen && sinUbicarClientes.length > 0 && (
        <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(226,75,74,0.3)', background: 'rgba(226,75,74,0.07)' }}>
          <div style={{ fontSize: 12, color: BRAND.muted, marginBottom: 8 }}>
            No se pudo encontrar la dirección. Buscala con 🔍 (como en Google Maps), o tocá “Ubicar en el mapa” y después el punto exacto.
          </div>
          {sinUbicarClientes.map(c => (
            <div key={c.id} style={{ padding: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{c.nombre}</span>
                <span style={{ fontSize: 11, color: BRAND.muted }}>{c.direccion}</span>
                <button onClick={() => setBuscandoDir(v => (v === c.id ? null : c.id))} style={{ ...btn(buscandoDir === c.id), height: 30, marginLeft: 'auto' }}>
                  🔍 Buscar
                </button>
                <button onClick={() => { setUbicando(c.id); setSinUbicarOpen(false); }} style={{ ...btn(ubicando === c.id), height: 30 }}>
                  📍 Ubicar en el mapa
                </button>
              </div>
              {buscandoDir === c.id && (
                <div style={{ marginTop: 6 }}>
                  <BuscadorDireccion key={c.id} inicial={c.direccion} onElegir={cand => elegirUbicacion(c, cand)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {ubicando && (
        <div style={{ marginBottom: 8, fontSize: 12, color: '#FBBF24' }}>
          Tocá en el mapa dónde va {clientes.find(c => c.id === ubicando)?.nombre}.
          <button onClick={() => setUbicando(null)} style={{ marginLeft: 8, background: 'none', border: 'none', color: BRAND.muted, cursor: 'pointer', fontSize: 12 }}>Cancelar</button>
        </div>
      )}

      {/* Mapa */}
      <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${BRAND.border}` }}>
        <div ref={contRef} style={{ height: esMovil ? '58vh' : '64vh', minHeight: 320, background: '#1b1e24' }} />

        {lazo && (
          <div
            onPointerDown={onLazoDown} onPointerMove={onLazoMove} onPointerUp={onLazoUp} onPointerCancel={onLazoUp}
            style={{ position: 'absolute', inset: 0, zIndex: 900, cursor: 'crosshair', touchAction: 'none', background: 'transparent' }}
          />
        )}

        {lazo && !seleccion && (
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 950, padding: '6px 14px', borderRadius: 20, background: 'rgba(13,27,42,0.92)', border: '1px solid rgba(142,197,255,0.5)', color: '#8EC5FF', fontSize: 12, fontWeight: 600, pointerEvents: 'none' }}>
            Dibujá alrededor de las colectas
          </div>
        )}

        {/* Leyenda por chofer */}
        {!lazo && leyenda.length > 0 && (
          <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 800, maxHeight: '55%', overflowY: 'auto', padding: '8px 10px', borderRadius: 10, background: 'rgba(13,27,42,0.9)', border: `1px solid ${BRAND.border}`, backdropFilter: 'blur(3px)' }}>
            {leyenda.map(([ch, n]) => {
              const activo = choferFoco === ch;
              return (
                <div key={ch} onClick={() => setChoferFoco(activo ? null : ch)}
                  title={activo ? 'Quitar resaltado' : `Resaltar las de ${ch}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 4px', cursor: 'pointer', minHeight: 26, opacity: choferFoco && !activo ? 0.45 : 1 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: ch === 'A coordinar' ? 'transparent' : colorChofer(ch), border: ch === 'A coordinar' ? '2px dashed rgba(255,255,255,0.55)' : '1px solid rgba(0,0,0,0.4)' }} />
                  <span style={{ fontSize: 12, color: ch === 'A coordinar' ? '#FBBF24' : '#fff', whiteSpace: 'nowrap', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ch}</span>
                  <span style={{ fontSize: 11, color: BRAND.muted, marginLeft: 'auto' }}>{n}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detalle de un cliente */}
      {clienteSel && !seleccion && (() => {
        const reg = registros[clienteSel.id] || {};
        const est = estadoEfectivo(clienteSel, reg);
        const dirHoy = reg.direccion && reg.direccion !== clienteSel.direccion ? reg.direccion : null;
        const monto = reg.monto ?? clienteSel.monto;
        const estLbl = { blanco: 'Pendiente', amarillo: 'Con envíos', verde: 'Confirmado' }[est] || est;
        return (
          <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 12, border: `1px solid ${BRAND.border}`, background: BRAND.navyCard }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>{VEHICULOS[clienteSel.vehiculo]?.emoji || '📦'}</span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>{clienteSel.nombre}</span>
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', color: COLOR_ESTADO[est] }}>{estLbl}</span>
              <button onClick={() => setSel(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: BRAND.muted, cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: BRAND.muted, marginBottom: 8 }}>
              📍 {clienteSel.direccion}
              {clienteSel.zona_barrio ? ` · ${clienteSel.zona_barrio}` : ''}
              {clienteSel.horario ? ` · 🕐 ${clienteSel.horario}` : ''}
              {monto ? ` · $${Number(monto).toLocaleString('es-AR')}` : ''}
              {VEHICULOS[clienteSel.vehiculo] ? ` · ${VEHICULOS[clienteSel.vehiculo].label}` : ''}
            </div>
            {dirHoy && (
              <div style={{ fontSize: 12, color: '#FBBF24', marginBottom: 8 }}>
                📍 Hoy la dirección es otra: {dirHoy} (el pin sigue en la dirección fija)
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <ChoferPicker
                chs={choferesDe(clienteSel)}
                choferesList={choferesFull}
                onUpdate={updates => updateRegistro(clienteSel.id, updates)}
              />
              <button onClick={() => setBuscandoDir(v => (v === clienteSel.id ? null : clienteSel.id))}
                title="Buscar la dirección como en Google Maps y mover el pin al resultado"
                style={{ ...btn(buscandoDir === clienteSel.id), height: 30 }}>
                🔍 Reubicar
              </button>
              {clienteSel.geo_fuente === 'manual' && (
                <button
                  onClick={async () => {
                    await onGeoUpdate(clienteSel.id, { lat: null, lng: null, geo_fuente: 'auto', geo_direccion: null });
                    setSel(null);
                  }}
                  title="Volver a la ubicación automática (se vuelve a geocodificar la dirección)"
                  style={{ ...btn(false), height: 30 }}>
                  ↩ Ubicación automática
                </button>
              )}
            </div>
            {buscandoDir === clienteSel.id && (
              <div style={{ marginTop: 8 }}>
                <BuscadorDireccion key={clienteSel.id} inicial={clienteSel.direccion} onElegir={cand => elegirUbicacion(clienteSel, cand)} />
              </div>
            )}
          </div>
        );
      })()}

      {/* Panel de asignación en bloque */}
      {seleccion && (
        <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(142,197,255,0.45)', background: BRAND.navyCard }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#8EC5FF' }}>
              {seleccion.ids.filter(id => !seleccion.excluidos.has(id)).length} colecta(s) seleccionada(s)
            </span>
            <button onClick={cancelarSeleccion} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: BRAND.muted, cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>

          <div style={{ maxHeight: 190, overflowY: 'auto', marginBottom: 10 }}>
            {seleccion.ids.map(id => {
              const c = clientes.find(x => x.id === id);
              if (!c) return null;
              const chs = choferesDe(c);
              const yaTiene = chs.filter(x => x !== 'A coordinar');
              const excluido = seleccion.excluidos.has(id);
              return (
                <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px', cursor: 'pointer', opacity: excluido ? 0.45 : 1, minHeight: 32 }}>
                  <input type="checkbox" checked={!excluido}
                    onChange={() => setSeleccion(s => {
                      const ex = new Set(s.excluidos);
                      if (ex.has(id)) ex.delete(id); else ex.add(id);
                      return { ...s, excluidos: ex };
                    })}
                    style={{ width: 17, height: 17, accentColor: '#8EC5FF', cursor: 'pointer', flexShrink: 0 }} />
                  <span style={{ fontSize: 13 }}>{VEHICULOS[c.vehiculo]?.emoji || '📦'} {c.nombre}</span>
                  {yaTiene.length > 0 && (
                    <span style={{ fontSize: 11, color: '#FBBF24' }}>ya estaba con {yaTiene.join(', ')}</span>
                  )}
                </label>
              );
            })}
          </div>

          <input value={buscaChofer} onChange={e => setBuscaChofer(e.target.value)} placeholder="🔍 Buscar chofer…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: `1px solid ${BRAND.border}`, background: '#14171c', color: '#fff', fontSize: 13, marginBottom: 8 }} />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
            {choferesFull
              .filter(ch => !buscaChofer || normNombre(ch).includes(normNombre(buscaChofer)))
              .slice(0, 40)
              .map(ch => (
                <button key={ch} onClick={() => asignarBloque(ch)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 34, padding: '0 12px', borderRadius: 20, border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: '#fff', fontSize: 13, cursor: 'pointer', touchAction: 'manipulation' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: colorChofer(ch) }} />
                  Asignar {seleccion.ids.filter(id => !seleccion.excluidos.has(id)).length} a {ch}
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
