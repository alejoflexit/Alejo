const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_WRITE_BATCH = 500;
const DEFAULT_DELETE_BATCH = 200;

function headers(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function getExistingIds({ baseUrl, key, table, fetchImpl, pageSize }) {
  const ids = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetchImpl(`${baseUrl}/rest/v1/${table}?select=id_interno&order=id_interno`, {
      headers: headers(key, { Range: `${offset}-${offset + pageSize - 1}` }),
    });
    if (!response.ok) throw new Error(`Supabase read error: ${response.status}`);
    const rows = await response.json();
    ids.push(...rows.map((row) => String(row.id_interno)));
    if (rows.length < pageSize) return ids;
  }
}

async function upsertBatch({ baseUrl, key, table, rows, fetchImpl }) {
  const response = await fetchImpl(`${baseUrl}/rest/v1/${table}?on_conflict=id_interno`, {
    method: "POST",
    headers: headers(key, {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    }),
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Supabase upsert error: ${await response.text()}`);
}

async function upsertRows({ baseUrl, key, table, rows, fetchImpl = fetch, writeBatch = DEFAULT_WRITE_BATCH }) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  for (let index = 0; index < rows.length; index += writeBatch) {
    await upsertBatch({
      baseUrl: normalizedBaseUrl,
      key,
      table,
      rows: rows.slice(index, index + writeBatch),
      fetchImpl,
    });
  }
}

async function upsertPrivateReceipts({ baseUrl, key, rows, fetchImpl = fetch }) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/rest/v1/rpc/upsert_envios_recepcion`, {
    method: "POST",
    headers: headers(key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_rows: rows }),
  });
  if (!response.ok) throw new Error(`Supabase private receipt error: ${response.status}`);
  return Number(await response.json());
}

async function getMaskedReceiptIds({ baseUrl, key, fetchImpl = fetch, pageSize = DEFAULT_PAGE_SIZE }) {
  const ids = [];
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetchImpl(`${normalizedBaseUrl}/rest/v1/envios_busqueda?select=id_interno&recibido_por=not.is.null&order=id_interno`, {
      headers: headers(key, { Range: `${offset}-${offset + pageSize - 1}` }),
    });
    if (!response.ok) throw new Error(`Supabase masked receipt read error: ${response.status}`);
    const rows = await response.json();
    ids.push(...rows.map(row => String(row.id_interno)));
    if (rows.length < pageSize) return ids;
  }
}

async function deleteBatch({ baseUrl, key, table, ids, fetchImpl }) {
  const filter = encodeURIComponent(`in.(${ids.join(",")})`);
  const response = await fetchImpl(`${baseUrl}/rest/v1/${table}?id_interno=${filter}`, {
    method: "DELETE",
    headers: headers(key),
  });
  if (!response.ok) throw new Error(`Supabase stale cleanup error: ${await response.text()}`);
}

async function refreshCacheSafely({
  baseUrl,
  key,
  table,
  rows,
  fetchImpl = fetch,
  pageSize = DEFAULT_PAGE_SIZE,
  writeBatch = DEFAULT_WRITE_BATCH,
  deleteBatchSize = DEFAULT_DELETE_BATCH,
  onProgress = () => undefined,
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Refusing to refresh cache with zero rows");
  }
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const existingIds = await getExistingIds({ baseUrl: normalizedBaseUrl, key, table, fetchImpl, pageSize });

  for (let index = 0; index < rows.length; index += writeBatch) {
    await upsertBatch({
      baseUrl: normalizedBaseUrl,
      key,
      table,
      rows: rows.slice(index, index + writeBatch),
      fetchImpl,
    });
    onProgress(Math.min(index + writeBatch, rows.length), rows.length);
  }

  const freshIds = new Set(rows.map((row) => String(row.id_interno)));
  const staleIds = existingIds.filter((id) => !freshIds.has(id));
  for (let index = 0; index < staleIds.length; index += deleteBatchSize) {
    await deleteBatch({
      baseUrl: normalizedBaseUrl,
      key,
      table,
      ids: staleIds.slice(index, index + deleteBatchSize),
      fetchImpl,
    });
  }

  return { previous: existingIds.length, current: rows.length, removed: staleIds.length };
}

module.exports = { refreshCacheSafely, upsertRows, upsertPrivateReceipts, getMaskedReceiptIds };
