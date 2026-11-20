import { zonaPalermo, coord, POLIGONO_A, dentroPoligono } from "./palermoShared";

// Envíos reales de noviembre (coordenadas USIG / LightData) con la zona que les toca
const CASOS = [
  ["Gorriti 4160 (Soho, al sur de Malabia)", -34.595085, -58.423413, "A"],
  ["Coronel Díaz 1821 (Alto Palermo)", -34.59008, -58.410865, "A"],
  ["Figueroa Alcorta 3015 (Palermo Chico)", -34.580435, -58.398427, "A"],
  ["Ugarteche 3107 (Botánico)", -34.580272, -58.411708, "A"],
  ["Fitz Roy 1450 (Hollywood)", -34.586223, -58.438758, "B"],
  ["Honduras 5083 (Soho norte)", -34.588187, -58.430905, "B"],
  ["Arce 743 (Cañitas)", -34.56859, -58.43479, "B"],
  ["Sinclair 3223 (Palermo Nuevo)", -34.572872, -58.422242, "B"],
];

test.each(CASOS)("%s", (_n, lat, lng, z) => { expect(zonaPalermo(lat, lng)).toBe(z); });

test("sin coordenadas o en cero → null", () => {
  expect(zonaPalermo(null, -58.4)).toBeNull();
  expect(zonaPalermo("0", "0")).toBeNull();
  expect(zonaPalermo("", "")).toBeNull();
});

test("acepta texto con coma o punto", () => {
  expect(coord("-34,59")).toBe(-34.59);
  expect(zonaPalermo("-34.595085", "-58.423413")).toBe("A");
});

test("fuera del recuadro de Palermo", () => {
  expect(zonaPalermo(-34.6037, -58.3816)).toBe("fuera"); // Obelisco
  expect(zonaPalermo(-34.5627, -58.4565)).toBe("fuera"); // Belgrano
});

test("el polígono A está cerrado y es coherente", () => {
  expect(POLIGONO_A.length).toBeGreaterThan(5);
  expect(dentroPoligono(-58.39, -34.59, POLIGONO_A)).toBe(true);
  expect(dentroPoligono(-58.445, -34.57, POLIGONO_A)).toBe(false);
});
