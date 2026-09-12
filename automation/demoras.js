function fechaEstadoADia(fechaEstado) {
  const datePart = String(fechaEstado || "").trim().split(" ")[0];
  if (!datePart) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

function historialExcluyeDemora(historial, fechasOkISO) {
  // 5=Entregado y 8=Cancelado son terminales: el historial manda aunque el
  // Excel exportado haya quedado atrasado y todavia diga En camino/En planta.
  const ESTADOS_NO_DEMORA = new Set(["5", "6", "8", "11", "12"]);
  return historial.some(h => {
    const codigoEstado = String(h.estado);
    if (!ESTADOS_NO_DEMORA.has(codigoEstado)) return false;
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
  const ESTADOS_INTENTO = new Set(["6", "11", "12"]);
  return historial.some(h => {
    if (!ESTADOS_INTENTO.has(String(h.estado))) return false;
    if (fechaEstadoADia(h.fecha) !== fechaISO) return false;
    const partes = String(h.fecha || "").trim().split(" ");
    if (partes.length < 2) return false;
    const hora = parseInt(partes[1].split(":")[0], 10);
    return Number.isInteger(hora) && hora < 21;
  });
}

module.exports = { fechaEstadoADia, historialExcluyeDemora, historialExcluyeDem21 };
