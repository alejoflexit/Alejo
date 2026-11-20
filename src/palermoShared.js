// Palermo en dos carritos (A / B) — lógica pura, testeada en palermoShared.test.js.
// Pedido de Alejo (20/11/2026): al escanear el QR, que la app diga en qué carrito va según la
// ubicación del envío. Corte aprobado: "por Malabia" (con los 467 envíos de Palermo del 1 al 20/11
// queda 258 A / 209 B; el dibujo a mano y el corte por Juan B. Justo quedaban ~71/29).
//
// Zona A: al sureste de Malabia (de Córdoba a Santa Fe); del otro lado de Santa Fe, lo que queda al
//         este de Av. Sarmiento (Plaza Italia → río). Alto Palermo, Botánico, Palermo Chico, Soho sur.
// Zona B: el resto de Palermo — Soho norte, Hollywood, Las Cañitas, Palermo Nuevo.
// Fuera:  afuera del recuadro de Palermo (generoso: incluye bordes de Villa Crespo, Recoleta, Colegiales).
//
// Esquinas sacadas del geocodificador de la Ciudad (USIG). Coordenadas [longitud, latitud].
export const ESQUINAS = {
  malabiaCordoba: [-58.431223, -34.593539],
  malabiaSantaFe: [-58.417117, -34.584366],
  plazaItalia: [-58.42055, -34.58233], // cruce de la línea de Santa Fe con la de Sarmiento
  sarmientoLibertador: [-58.414965, -34.575278],
  sarmientoFigueroaAlcorta: [-58.41187, -34.571369],
};

// Recuadro de Palermo: lo que cae afuera no es de estos carritos
export const RECUADRO = { oeste: -58.452, este: -58.385, sur: -34.602, norte: -34.553 };

// Prolonga la recta p→q hasta la latitud `lat`
const hastaLat = (p, q, lat) => { const t = (lat - p[1]) / (q[1] - p[1]); return [p[0] + t * (q[0] - p[0]), lat]; };

const E = ESQUINAS, R = RECUADRO;
export const POLIGONO_A = [
  hastaLat(E.malabiaCordoba, E.malabiaSantaFe, R.sur), // Malabia hacia el sur, hasta el borde
  E.malabiaCordoba,
  E.malabiaSantaFe,
  E.plazaItalia,
  E.sarmientoFigueroaAlcorta,
  hastaLat(E.plazaItalia, E.sarmientoFigueroaAlcorta, R.norte), // Sarmiento hasta el río
  [R.este, R.norte],
  [R.este, R.sur],
];

export function dentroPoligono(lng, lat, poli) {
  let dentro = false;
  for (let i = 0, j = poli.length - 1; i < poli.length; j = i++) {
    const [xi, yi] = poli[i], [xj, yj] = poli[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

// Coordenada válida: LightData a veces manda 0 o vacío
export function coord(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) && n !== 0 ? n : null;
}

// → "A" | "B" | "fuera" | null (sin coordenadas)
export function zonaPalermo(latitud, longitud) {
  const lat = coord(latitud), lng = coord(longitud);
  if (lat == null || lng == null) return null;
  if (lng < R.oeste || lng > R.este || lat < R.sur || lat > R.norte) return "fuera";
  return dentroPoligono(lng, lat, POLIGONO_A) ? "A" : "B";
}

export const CARRITOS = {
  A: { id: "A", color: "#0a9b5b", nombre: "Carrito A", barrios: "Alto Palermo · Botánico · Palermo Chico · Soho sur" },
  B: { id: "B", color: "#e8650a", nombre: "Carrito B", barrios: "Soho norte · Hollywood · Las Cañitas · Palermo Nuevo" },
};

// Filtro PostgREST para precargar los envíos con coordenadas dentro del recuadro
export const FILTRO_RECUADRO = `latitud=gte.${R.sur}&latitud=lte.${R.norte}&longitud=gte.${R.oeste}&longitud=lte.${R.este}`;
