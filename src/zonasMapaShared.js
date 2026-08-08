const quitarAcentos = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export const normMapa = (s) => quitarAcentos(s)
  .toLowerCase()
  .replace(/\b(partido de|ciudad autonoma de buenos aires)\b/g, "")
  .replace(/[^a-z0-9 ]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const ALIASES = {
  "derqui": "presidente derqui",
  "gral pacheco": "general pacheco",
  "ing maschwitz": "ingeniero maschwitz",
  "la boca": "boca",
  "la paternal": "paternal",
  "laferrere": "gregorio de laferrere",
  "malvinas": "malvinas argentinas",
  "parque avellaneda": "parque avellaneda",
  "pompeya": "nueva pompeya",
  "pque avellaneda": "parque avellaneda",
  "san martin": "general san martin",
  "villa gral mitre": "villa general mitre",
  "villa madero": "villa eduardo madero",
};

// Zonas operativas que no son una localidad oficial exacta o que necesitan
// separarse de otra etiqueta que comparte el mismo centro.
const CENTROS_MANUALES = {
  "alberti": [-34.5076, -58.7835], // Manuel Alberti (Pilar)
  "don torcuato": [-34.4944, -58.6211],
  "ing budge": [-34.7245, -58.4631],
  "la matanza norte": [-34.6355, -58.5575],
  "lomas centro": [-34.7581, -58.4058],
  "microcentro": [-34.6037, -58.3816],
  "nordelta": [-34.3992, -58.6491],
  "resto de la plata": [-35.015, -57.997],
  "tigre c": [-34.4204, -58.5718],
  "villa celina": [-34.7053, -58.4815],
};

function centroGeometria(geometry) {
  if (!geometry?.coordinates) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  const recorrer = (valor) => {
    if (!Array.isArray(valor)) return;
    if (typeof valor[0] === "number" && typeof valor[1] === "number") {
      minLng = Math.min(minLng, valor[0]); maxLng = Math.max(maxLng, valor[0]);
      minLat = Math.min(minLat, valor[1]); maxLat = Math.max(maxLat, valor[1]);
      return;
    }
    valor.forEach(recorrer);
  };
  recorrer(geometry.coordinates);
  return Number.isFinite(minLat) ? [(minLat + maxLat) / 2, (minLng + maxLng) / 2] : null;
}

function featureExacta(features, buscados, capa) {
  return features.find((f) => (!capa || f.properties?.capa === capa) && buscados.includes(normMapa(f.properties?.nombre)));
}

export function resolverCentroZona(nombre, geo, localidades = []) {
  const original = normMapa(nombre);
  if (CENTROS_MANUALES[original]) return { centro: CENTROS_MANUALES[original], fuente: "ajuste" };

  const alias = ALIASES[original] || original;
  const buscados = [...new Set([original, alias])];
  const features = geo?.features || [];

  // En CABA los polígonos sí son barrios, así que su centro es la mejor referencia.
  const barrio = featureExacta(features, buscados, "CABA");
  if (barrio) return { centro: centroGeometria(barrio.geometry), fuente: "barrio" };

  const candidatas = localidades.filter((l) => buscados.includes(normMapa(l.nombre)));
  if (candidatas.length) {
    const esperada = candidatas.find((l) => normMapa(l.partido) === alias) || candidatas[0];
    return { centro: [Number(esperada.lat), Number(esperada.lng)], fuente: "localidad", partido: esperada.partido };
  }

  // Algunas zonas operativas son partidos completos (Almirante Brown, Echeverría, etc.).
  const partido = featureExacta(features, buscados, "AMBA");
  if (partido) return { centro: centroGeometria(partido.geometry), fuente: "partido" };

  const aproximadas = localidades.filter((l) => {
    const n = normMapa(l.nombre);
    return n.length >= 5 && (n.includes(alias) || alias.includes(n));
  });
  if (aproximadas.length === 1) {
    const l = aproximadas[0];
    return { centro: [Number(l.lat), Number(l.lng)], fuente: "localidad", partido: l.partido };
  }
  return null;
}

export function nivelZona(zona) {
  if (!zona) return "base";
  if (!zona.tope) return "sintope";
  if (zona.pct >= 1) return "critica";
  if (zona.pct >= 0.85) return "limite";
  return "ok";
}

const PRIORIDAD = { base: 0, ok: 1, sintope: 2, limite: 3, critica: 4 };

export function agruparPuntos(puntos, proyectar, radioPx) {
  if (!radioPx) return puntos.map((p) => ({ miembros: [p], centro: p.centro, total: p.total || 0, nivel: nivelZona(p) }));
  const grupos = [];
  [...puntos].sort((a, b) => (b.total || 0) - (a.total || 0)).forEach((punto) => {
    const px = proyectar(punto.centro);
    const existente = grupos.find((g) => {
      const dx = g.px.x - px.x, dy = g.px.y - px.y;
      return Math.sqrt(dx * dx + dy * dy) <= radioPx;
    });
    if (!existente) {
      grupos.push({ miembros: [punto], centro: [...punto.centro], px: { ...px }, total: punto.total || 0, nivel: nivelZona(punto) });
      return;
    }
    existente.miembros.push(punto);
    existente.total += punto.total || 0;
    existente.centro = [
      existente.miembros.reduce((s, p) => s + p.centro[0], 0) / existente.miembros.length,
      existente.miembros.reduce((s, p) => s + p.centro[1], 0) / existente.miembros.length,
    ];
    existente.px = proyectar(existente.centro);
    const nivel = nivelZona(punto);
    if (PRIORIDAD[nivel] > PRIORIDAD[existente.nivel]) existente.nivel = nivel;
  });
  return grupos;
}
