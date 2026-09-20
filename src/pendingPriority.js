// LightData supplies local Argentina timestamps, without a timezone suffix.
export function shipmentTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}T${match[4] || '00:00:00'}-03:00` : /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00-03:00` : text.replace(' ', 'T');
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(iso) ? `${iso}-03:00` : iso;
  const timestamp = Date.parse(zoned);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export const normalizeState = value => String(value || 'Sin estado').trim().toLowerCase().replace(/\s+/g, ' ');
export const OPEN_STATES = ['En camino al destinatario', 'En planta de procesamiento', 'Nadie', 'Nadie 2DA visita', 'No entregado', 'Reprogramado por Meli'];
export const RETURN_STATES = ['Cancelado', 'Rechazado por el comprador'];
// LightData no tiene un estado para "volvio al deposito": la operacion lo anota
// reasignando el envio a un cadete ficticio. Ese envio sigue en un estado abierto
// pero ya no es una entrega vigente y no hay cadete real a quien llamar.
export const RETURN_COURIERS = ['devuelto deposito'];
const normalizeCourier = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
export const returnedByCourier = row => RETURN_COURIERS.includes(normalizeCourier(row.cadete));

const hasState = (row, list) => list.some(s => normalizeState(s) === normalizeState(row.estado));
export const isOpenShipment = row => hasState(row, OPEN_STATES) && !returnedByCourier(row);
export const needsReturn = row => hasState(row, RETURN_STATES) || returnedByCourier(row);
export const matchesStates = (row, states) => !states.length || states.some(s => normalizeState(s) === normalizeState(row.estado));

// Abiertos y Devoluciones son grupos con significado, no listas de estados: al elegirlos
// mandan isOpenShipment y needsReturn. La seleccion individual de Mas estados queda literal.
const sameGroup = (states, group) => states.length === group.length && group.every(g => states.some(s => normalizeState(s) === normalizeState(g)));
export const matchesSelection = (row, states) => {
  if (!states.length) return true;
  if (sameGroup(states, OPEN_STATES)) return isOpenShipment(row);
  if (sameGroup(states, RETURN_STATES)) return needsReturn(row);
  return matchesStates(row, states);
};

export function pendingPriority(row, now = Date.now()) {
  if (returnedByCourier(row)) return { rank: -1, label: 'Ya volvió al depósito · según el cadete asignado', color: '#9aacc5' };
  if (needsReturn(row)) return { rank: -1, label: 'Gestionar devolución a depósito', color: '#9aacc5' };
  if (!isOpenShipment(row)) return { rank: -1, label: 'Fuera de entregas abiertas', color: '#9aacc5' };
  const time = shipmentTime(row.fecha_flexit);
  if (time === null) return { rank: 0, label: 'Fecha sin confirmar', color: '#9aacc5' };
  const hours = Math.max(0, (now - time) / 3600000);
  if (row.service === 'Flex' && hours >= 48) return { rank: 3, label: 'Crítico · Flex +48 h', color: '#ff8f9a' };
  if (hours >= 48) return { rank: 2, label: 'Urgente · +48 h', color: '#ffb36b' };
  if (hours >= 24) return { rank: 1, label: 'Atención · +24 h', color: '#f1d39b' };
  return { rank: 0, label: 'Reciente · menos de 24 h', color: '#2ecfaa' };
}
