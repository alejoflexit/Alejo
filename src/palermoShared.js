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

// Zona que cubren los carritos (21/11): el borde real del barrio Palermo (OpenStreetMap) + ~120 m, más las
// partes de Recoleta, Almagro y Villa Crespo dentro del recuadro (la ruta de Palermo entra ahí: Mansilla,
// Austria, Gallo…). NO entran Belgrano, Colegiales ni Chacarita. Con los 467 envíos del 1 al 20/11
// ninguno queda afuera; un envío de Belgrano (Sucre 1530) sí queda afuera.
export const RUTA_PALERMO = [[-58.41197, -34.598054], [-58.412679, -34.602], [-58.452, -34.602], [-58.452, -34.595445], [-58.450528, -34.594365], [-58.439786, -34.589268], [-58.445428, -34.585537], [-58.445931, -34.5847], [-58.445209, -34.582199], [-58.441764, -34.578607], [-58.444789, -34.576262], [-58.445162, -34.575562], [-58.444954, -34.574685], [-58.442732, -34.572458], [-58.449616, -34.568939], [-58.450114, -34.568304], [-58.450096, -34.567497], [-58.44846, -34.565735], [-58.443305, -34.562806], [-58.441717, -34.560951], [-58.442588, -34.55875], [-58.441609, -34.556749], [-58.438065, -34.554993], [-58.435901, -34.553484], [-58.435208, -34.552273], [-58.432428, -34.55048], [-58.4288, -34.549696], [-58.426005, -34.551022], [-58.415182, -34.553797], [-58.411085, -34.555924], [-58.410007, -34.555387], [-58.408946, -34.555585], [-58.408213, -34.556591], [-58.40852, -34.557896], [-58.403022, -34.562667], [-58.401719, -34.562217], [-58.399825, -34.562283], [-58.39611, -34.564304], [-58.395625, -34.565635], [-58.396396, -34.566974], [-58.392973, -34.571991], [-58.390788, -34.573208], [-58.390601, -34.5729], [-58.39023, -34.573547], [-58.385, -34.576292], [-58.385, -34.578219], [-58.389973, -34.578258], [-58.391633, -34.580832], [-58.387269, -34.583289], [-58.385, -34.585979], [-58.385, -34.588848], [-58.387917, -34.59171], [-58.386822, -34.599404], [-58.398804, -34.599754], [-58.402047, -34.599367], [-58.404698, -34.598096], [-58.41197, -34.598054]];

// → "A" | "B" | "fuera" | null (sin coordenadas)
export function zonaPalermo(latitud, longitud) {
  const lat = coord(latitud), lng = coord(longitud);
  if (lat == null || lng == null) return null;
  if (lng < R.oeste || lng > R.este || lat < R.sur || lat > R.norte) return "fuera";
  if (!dentroPoligono(lng, lat, RUTA_PALERMO)) return "fuera";
  return dentroPoligono(lng, lat, POLIGONO_A) ? "A" : "B";
}

export const CARRITOS = {
  A: { id: "A", color: "#1fa651", nombre: "Carrito A", barrios: "Alto Palermo · Botánico · Palermo Chico · Soho sur" },
  B: { id: "B", color: "#f08a12", nombre: "Carrito B", barrios: "Soho norte · Hollywood · Las Cañitas · Palermo Nuevo" },
};

// Filtro PostgREST para precargar los envíos con coordenadas dentro del recuadro
export const FILTRO_RECUADRO = `latitud=gte.${R.sur}&latitud=lte.${R.norte}&longitud=gte.${R.oeste}&longitud=lte.${R.este}`;
