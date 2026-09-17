// LightData supplies local Argentina timestamps, without a timezone suffix.
export function shipmentTime(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}(?::\d{2})?))?/);
  const iso = match ? `${match[3]}-${match[2]}-${match[1]}T${match[4] || '00:00:00'}-03:00` : /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00-03:00` : text.replace(' ', 'T');
  const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(iso) ? `${iso}-03:00` : iso;
  const timestamp = Date.parse(zoned);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function pendingPriority(row, now = Date.now()) {
  const time = shipmentTime(row.fecha_flexit);
  if (time === null) return { rank: 0, label: 'Fecha sin confirmar', color: '#9aacc5' };
  const hours = Math.max(0, (now - time) / 3600000);
  if (row.service === 'Flex' && hours >= 48) return { rank: 3, label: 'Crítico · Flex +48 h', color: '#ff8f9a' };
  if (hours >= 48) return { rank: 2, label: 'Urgente · +48 h', color: '#ffb36b' };
  if (hours >= 24) return { rank: 1, label: 'Atención · +24 h', color: '#f1d39b' };
  return { rank: 0, label: 'Reciente · menos de 24 h', color: '#2ecfaa' };
}
