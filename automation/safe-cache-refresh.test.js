const test = require("node:test");
const assert = require("node:assert/strict");
const { refreshCacheSafely } = require("./safe-cache-refresh");

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
