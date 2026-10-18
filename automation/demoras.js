function fechaEstadoADia(fechaEstado) {
  const datePart = String(fechaEstado || "").trim().split(" ")[0];
  if (!datePart) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

function minutoDe(fecha) {
  return String(fecha || "").trim().slice(0, 16);
}

// El 31 ("reprogramado por meli" como lo registra hoy LightData, autor Sistema)
// es una reprogramacion real si el paquete ya estaba en planta (hay un estado 1
// anterior). Antes de planta no excusa (caso Ariel Ferrero 16/10: 31 a las 14:02,
// planta 14:55, salio y no se entrego).
// 18/10/2026: se saco la condicion "no pegado a un En camino (2/22) del mismo
// minuto". Se habia tomado como ruido de sep-2026, pero una muestra de envios
// comunes de sep y oct no trae ningun 31: no es algo que LightData le pegue a
// cada En camino. Y los envios con 31 pegado (1042915, 1043073, 1042810 del
// 17/10) no tuvieron ningun intento: Meli los paso de dia. Ver wiki
// analisis/auditoria-demorados-estado31-2026-10-16.
function es31Valido(h, historial) {
  const idx = historial.indexOf(h);
  return historial.slice(0, idx).some(x => String(x.estado) === "1");
}

function historialExcluyeDemora(historial, fechasOkISO) {
  // 5=Entregado y 8=Cancelado son terminales: el historial manda aunque el
  // Excel exportado haya quedado atrasado y todavia diga En camino/En planta.
  // 31 = "reprogramado por meli" tal como lo registra hoy LightData (lo pone
  // "Sistema"); se trata igual que el 11 si pasa es31Valido.
  const ESTADOS_NO_DEMORA = new Set(["5", "6", "8", "11", "12", "31"]);
  return historial.some(h => {
    const codigoEstado = String(h.estado);
    if (!ESTADOS_NO_DEMORA.has(codigoEstado)) return false;
    if (codigoEstado === "31" && !es31Valido(h, historial)) return false;
    const diaH = fechaEstadoADia(h.fecha);
    if (fechasOkISO && diaH && !fechasOkISO.has(diaH)) return false;
    if (codigoEstado === "5" || codigoEstado === "8") return true;
    const partes = String(h.fecha).split(" ");
    if (partes.length < 2) return false;
    const hora = parseInt(partes[1].split(":")[0]);
    return hora < 21;
  });
}

function historialExcluyeDem21(historial, fechaISO) {
  // El estado final puede ser "reprogramado por meli" después de las 21 aunque
  // el intento real haya ocurrido antes (por ejemplo Nadie 18:26 -> Repro 23:10).
  // En ese caso no corresponde penalizar dem21: manda el primer intento válido
  // del mismo día, no la hora en que Meli actualizó automáticamente el estado.
  const ESTADOS_INTENTO = new Set(["6", "11", "12", "31"]);
  return historial.some(h => {
    if (!ESTADOS_INTENTO.has(String(h.estado))) return false;
    if (String(h.estado) === "31" && !es31Valido(h, historial)) return false;
    if (fechaEstadoADia(h.fecha) !== fechaISO) return false;
    const partes = String(h.fecha || "").trim().split(" ");
    if (partes.length < 2) return false;
    const hora = parseInt(partes[1].split(":")[0], 10);
    return Number.isInteger(hora) && hora < 21;
  });
}

module.exports = { fechaEstadoADia, historialExcluyeDemora, historialExcluyeDem21 };
