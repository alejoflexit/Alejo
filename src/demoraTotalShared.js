// CommonJS para compartir exactamente la misma regla con la carga Node.
function esDemoradoFlexit(origen, estado) {
  const fuente = String(origen ?? "").trim().toUpperCase();
  const valor = String(estado ?? "").trim().toLowerCase().replace(/^(nan|null|undefined)$/, "");
  return fuente !== "ML" && ["", "en camino al destinatario", "en planta de procesamiento"].includes(valor);
}

function demoraTotal(m) {
  const total = Number(m.cantidad);
  const flexit = m.demorados_flexit;
  if (!Number.isFinite(total) || total <= 0 || !Number.isInteger(flexit) || flexit < 0) return null;
  const meli = Number(m.demorados || 0) + Number(m.dem21 || 0);
  return { total, meli, flexit, afectados: meli + flexit, porcentaje: (meli + flexit) / total * 100 };
}

module.exports = { esDemoradoFlexit, demoraTotal };
