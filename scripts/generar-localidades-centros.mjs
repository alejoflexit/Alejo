import { writeFile } from "node:fs/promises";

const API = "https://apis.datos.gob.ar/georef/api/v2.0/localidades?provincia=06&max=5000";
const SALIDA = new URL("../public/localidades-centros.json", import.meta.url);

const respuesta = await fetch(API);
if (!respuesta.ok) throw new Error(`GeoRef respondio ${respuesta.status}`);

const { localidades = [] } = await respuesta.json();
const dentroDelMapa = localidades
  .filter((l) => {
    const lat = Number(l.centroide?.lat);
    const lng = Number(l.centroide?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -35.35 && lat <= -34.05 && lng >= -59.35 && lng <= -57.65;
  })
  .map((l) => ({
    nombre: l.nombre,
    partido: l.departamento?.nombre || "",
    lat: Number(l.centroide.lat),
    lng: Number(l.centroide.lon),
  }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

await writeFile(SALIDA, `${JSON.stringify(dentroDelMapa)}\n`, "utf8");
console.log(`Guardados ${dentroDelMapa.length} centros oficiales de Buenos Aires.`);
