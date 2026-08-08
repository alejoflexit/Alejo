import fs from "fs";
import path from "path";
import { agruparPuntos, nivelZona, resolverCentroZona } from "./zonasMapaShared";

const leerPublico = (nombre) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", nombre), "utf8"));
const geo = leerPublico("zonas-base.geojson");
const localidades = leerPublico("localidades-centros.json");
const zonasOperativasActuales = (
  "Agronomía|Alberti|Aldo Bonzi|Alejandro Korn|Almagro|Almirante Brown|Avellaneda|Banfield|Barracas|Belgrano|Benavidez|Berazategui|Berisso|Billinghurst|Boedo|Caballito|Campana|Cañuelas|Chacarita|Ciudad Evita|Coghlan|Colegiales|Constitución|Del Viso|Derqui|Don Torcuato|El Talar|Ensenada|Escobar|Esteban Echeverría|Ezeiza|Fátima|Florencio Varela|Flores|Floresta|Garín|General Rodriguez|Gonzalez Catán|Gral Pacheco|Guernica|Hurlingham|Ing Budge|Ing Maschwitz|Isidro Casanova|Ituzaingó|Jose C Paz|Jose Leon Suarez|La Boca|La Matanza Norte|La Paternal|La Plata|La Tablada|Laferrere|Lanús|Liniers|Llavallol|Loma Hermosa|Lomas Centro|Lomas de Zamora|Lomas Del Mirador|Luján|Malvinas|Manzanares|Marcos Paz|Mataderos|Matheu|Merlo|Microcentro|Monte Castro|Moreno|Morón|Nordelta|Nuñez|Palermo|Parque Chacabuco|Parque Chas|Parque Patricios|Pilar|Pompeya|Pque Avellaneda|Puerto Madero|Quilmes|Rafael Castillo|Ramos Mejía|Recoleta|Resto de La Plata|Retiro|Ricardo Rojas|Rincon de Milberg|Saavedra|San Andrés|San Fernando|San Isidro|San Justo|San Martín|San Miguel|San Telmo|San Vicente|Tapiales|Temperley|Tigre|Tigre C|Tres de Febrero|Troncos del Talar|Turdera|Velez Sarsfield|Versalles|Vicente Lopez|Villa Ballester|Villa Celina|Villa Centenario|Villa Crespo|Villa del Parque|Villa Devoto|Villa Gral Mitre|Villa Libertad|Villa Lugano|Villa Luro|Villa Luzuriaga|Villa Lynch|Villa Madero|Villa Maipú|Villa Ortuzar|Villa Pueyrredón|Villa Real|Villa Rosa|Villa Santa Rita|Villa Soldati|Villa Urquiza|Virrey del Pino|Zarate|Zelaya"
).split("|");

describe("referencia geografica de zonas", () => {
  test("ubica las localidades y alias operativos que no son partidos", () => {
    const zonas = [
      "Banfield", "Temperley", "Lomas Centro", "Alberti", "Ing Budge", "Ing Maschwitz",
      "Derqui", "Don Torcuato", "Gral Pacheco", "Laferrere", "La Boca", "La Matanza Norte", "Microcentro", "Nordelta",
      "Pompeya", "Pque Avellaneda", "Resto de La Plata", "San Martín", "Tigre C",
      "Villa Celina", "Villa Gral Mitre", "Villa Madero",
    ];
    const faltantes = zonas.filter((zona) => !resolverCentroZona(zona, geo, localidades)?.centro);
    expect(faltantes).toEqual([]);
  });

  test("cubre todo el catálogo operativo actual, incluso zonas hoy sin volumen", () => {
    const faltantes = zonasOperativasActuales.filter((zona) => !resolverCentroZona(zona, geo, localidades)?.centro);
    expect(faltantes).toEqual([]);
  });

  test("Banfield no hereda el centro del partido Lomas de Zamora", () => {
    const banfield = resolverCentroZona("Banfield", geo, localidades).centro;
    const lomas = resolverCentroZona("Lomas de Zamora", geo, localidades).centro;
    expect(Math.abs(banfield[0] - lomas[0]) + Math.abs(banfield[1] - lomas[1])).toBeGreaterThan(0.01);
  });
});

describe("jerarquia visual", () => {
  test("prioriza una alerta dentro de un grupo y suma sus envios", () => {
    const puntos = [
      { zona: "A", centro: [-34.7, -58.4], total: 20, tope: 50, pct: 0.4 },
      { zona: "B", centro: [-34.71, -58.41], total: 55, tope: 50, pct: 1.1 },
    ];
    const grupos = agruparPuntos(puntos, ([lat, lng]) => ({ x: lng * 100, y: lat * 100 }), 10);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].total).toBe(75);
    expect(grupos[0].nivel).toBe("critica");
  });

  test("mantiene separados los puntos cuando no corresponde agrupar", () => {
    const puntos = [
      { zona: "A", centro: [-34.7, -58.4], total: 20, tope: 50, pct: 0.4 },
      { zona: "B", centro: [-35, -59], total: 40, tope: null, pct: null },
    ];
    const grupos = agruparPuntos(puntos, ([lat, lng]) => ({ x: lng * 100, y: lat * 100 }), 10);
    expect(grupos).toHaveLength(2);
    expect(nivelZona(puntos[1])).toBe("sintope");
  });
});
