const test = require("node:test");
const assert = require("node:assert/strict");
const { refreshCacheSafely, upsertRows, upsertPrivateReceipts, getMissingReceiptIds, hasPrivateReceipt } = require("./safe-cache-refresh");

test("upserts every fresh row before deleting stale rows", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (!init.method) return Response.json([{ id_interno: "keep" }, { id_interno: "stale" }]);
    return new Response(null, { status: 204 });
  };

  const result = await refreshCacheSafely({
    baseUrl: "https://project.example",
    key: "secret-test",
    table: "envios_busqueda",
    rows: [{ id_interno: "keep" }, { id_interno: "new" }],
    fetchImpl,
    writeBatch: 1,
  });

  assert.deepEqual(result, { previous: 2, current: 2, removed: 1 });
  assert.deepEqual(calls.map((call) => call.init.method ?? "GET"), ["GET", "POST", "POST", "DELETE"]);
  assert.match(calls.at(-1).url, /stale/);
});

test("upserts masked receipt fields without requiring the full shipment row", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return new Response(null, { status: 201 });
  };
  await upsertRows({
    baseUrl: "https://project.example",
    key: "secret-test",
    table: "envios_busqueda",
    rows: [{ id_interno: "941916", recibido_por: "Facundo DNI:6000" }],
    fetchImpl,
  });
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    { id_interno: "941916", recibido_por: "Facundo DNI:6000" },
  ]);
  assert.equal(calls[0].init.body.includes("38576000"), false);
});

test("never deletes the old cache when an upsert batch fails", async () => {
  const methods = [];
  let posts = 0;
  const fetchImpl = async (_url, init = {}) => {
    const method = init.method ?? "GET";
    methods.push(method);
    if (method === "GET") return Response.json([{ id_interno: "old" }]);
    if (method === "POST" && ++posts === 2) return new Response("failed", { status: 500 });
    return new Response(null, { status: 204 });
  };

  await assert.rejects(refreshCacheSafely({
    baseUrl: "https://project.example",
    key: "secret-test",
    table: "envios_busqueda",
    rows: [{ id_interno: "one" }, { id_interno: "two" }],
    fetchImpl,
    writeBatch: 1,
  }), /upsert error/);
  assert.equal(methods.includes("DELETE"), false);
});

test("sends complete receipt data only through the private service-role RPC", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return Response.json(1);
  };

  const count = await upsertPrivateReceipts({
    baseUrl: "https://project.example",
    key: "secret-test",
    rows: [{ id_interno: "941916", recibido_por: "Facundo DNI:38576000" }],
    fetchImpl,
  });

  assert.equal(count, 1);
  assert.match(calls[0].url, /rpc\/upsert_envios_recepcion$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    p_rows: [{ id_interno: "941916", recibido_por: "Facundo DNI:38576000" }],
  });
});

test("reads only delivered shipment ids that are still missing receipt data", async () => {
  const calls = [];
  const ids = await getMissingReceiptIds({
    baseUrl: "https://project.example",
    key: "secret-test",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json([
        { id_interno: "941916", estado: "Entregado", recibido_por: null },
        { id_interno: "941917", estado: "Entregado", recibido_por: "Facundo DNI:6000" },
        { id_interno: "941918", estado: "A planta", recibido_por: null },
      ]);
    },
  });
  assert.deepEqual(ids, ["941916"]);
  assert.match(calls[0].url, /select=id_interno,estado,recibido_por/);
});

test("verifies a private receipt without exposing its contents", async () => {
  const calls = [];
  const found = await hasPrivateReceipt({
    baseUrl: "https://project.example",
    key: "secret-test",
    id: "86245",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json([{ id_interno: "86245", recibido_por: "Persona DNI:12345678" }]);
    },
  });
  assert.equal(found, true);
  assert.match(calls[0].url, /rpc\/get_envios_recepcion$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_ids: ["86245"] });
});

test("rejects an empty download without touching Supabase", async () => {
  let calls = 0;
  await assert.rejects(refreshCacheSafely({
    baseUrl: "https://project.example",
    key: "secret-test",
    table: "envios_busqueda",
    rows: [],
    fetchImpl: async () => { calls += 1; return Response.json([]); },
  }), /zero rows/);
  assert.equal(calls, 0);
});
