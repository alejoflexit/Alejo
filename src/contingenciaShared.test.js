import jsQR from "jsqr";
import { TextEncoder } from "util";
import {
  leerContingencia, clienteLD, clienteVisible, mapaVendedores, uuid, evaluarLectura, EN_CUADRO_MS,
  nuevoEscaneo, codigosDeTanda, filaParaSubir, CAMPOS_ALTA, pendientesSync, cuantosSinSubir, lotes,
  aplicarSubida, marcarBorrado, marcarMostrado, desdeRemoto, fusionar, agruparTandas, primerPendiente,
  matrizQR, pixelesQR, diaAR, etiquetaDia, clasificarError, lotesPor,
} from "./contingenciaShared";

// jsdom no trae TextEncoder (los navegadores sí); qrcode lo usa para pasar el texto a bytes UTF-8
if (typeof global.TextEncoder === "undefined") global.TextEncoder = TextEncoder;

const QR_ML = '{"id":"45123456789","sender_id":123456789,"hash_code":"Xy9+/abc==","security_digit":"0"}';
const QR_LD = '{"local":1,"did":"1088519","cliente":"77","empresa":125}';
const T0 = Date.parse("2026-11-16T13:00:00Z"); // 10:00 AR

const lec = (qr) => leerContingencia(qr);
const esc = (qr, extra = {}) => nuevoEscaneo({ lectura: lec(qr), modo: "salida", persona: "Juan", tanda: "t1", por: "Alejo", ahora: T0, ...extra });

describe("lectura", () => {
  test("QR de Mercado Libre: código, vendedor y texto crudo tal cual", () => {
    expect(lec(QR_ML)).toEqual({ codigo: "45123456789", sender_id: "123456789", tipo: "ml", qr: QR_ML });
  });
  test("QR de LightData: did y cliente LD", () => {
    expect(lec(QR_LD)).toMatchObject({ codigo: "1088519", sender_id: null, tipo: "ld", qr: QR_LD });
    expect(clienteLD(QR_LD)).toBe("77");
    expect(clienteLD(QR_ML)).toBeNull();
  });
  test("no recorta el texto crudo (espacios y saltos se conservan)", () => {
    const raro = ` ${QR_ML}\n`;
    expect(lec(raro).qr).toBe(raro);
    expect(lec(raro).codigo).toBe("45123456789");
  });
  test("descarta basura", () => {
    expect(lec("")).toBeNull();
    expect(lec(null)).toBeNull();
    expect(lec('{"otra":"cosa"}')).toBeNull();
  });
});

describe("cliente", () => {
  const vend = mapaVendedores([{ sender_id: 123456789, cliente: "Tienda Uno" }, { sender_id: "9", cliente: null }]);
  test("se deduce del sender_id", () => {
    expect(clienteVisible({ sender_id: "123456789" }, vend)).toBe("Tienda Uno");
  });
  test("vendedor desconocido queda sin identificar, separado por sender_id", () => {
    expect(clienteVisible({ sender_id: "555" }, vend)).toBe("Sin identificar · vendedor 555");
  });
  test("el cliente guardado manda; LightData muestra su número de cliente", () => {
    expect(clienteVisible({ cliente: "Guardado", sender_id: "123456789" }, vend)).toBe("Guardado");
    expect(clienteVisible({ tipo: "ld", qr: QR_LD }, vend)).toBe("Cliente LightData 77");
    expect(clienteVisible({ tipo: "texto", qr: "ABC123" }, vend)).toBe("Sin identificar");
  });
});

test("uuid v4 con formato válido y distinto cada vez", () => {
  const a = uuid(), b = uuid();
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(a).not.toBe(b);
  const fijo = uuid((buf) => buf.fill(0xff));
  expect(fijo).toMatch(/^ffffffff-ffff-4fff-bfff-ffffffffffff$/);
});

describe("ráfaga y duplicados", () => {
  test("la misma etiqueta en cuadro se ignora; pasado el tiempo es duplicado si ya está en la tanda", () => {
    const estado = { codigos: new Set(["A"]), ultimo: { c: "A", at: T0 } };
    expect(evaluarLectura(estado, "A", T0 + 500)).toBe("ignorar");
    expect(evaluarLectura(estado, "A", T0 + EN_CUADRO_MS + 1)).toBe("duplicado");
    expect(evaluarLectura(estado, "B", T0 + 10)).toBe("nuevo");
  });
  test("los códigos de la tanda no cuentan los borrados ni otras tandas", () => {
    const regs = [esc(QR_ML), marcarBorrado(esc(QR_LD)), esc('{"id":"999"}', { tanda: "t2" })];
    expect([...codigosDeTanda(regs, "t1")]).toEqual(["45123456789"]);
  });
  test("el escaneo guarda todo lo pedido", () => {
    const r = esc(QR_ML, { cliente: "Tienda Uno" });
    expect(r).toMatchObject({ qr: QR_ML, codigo: "45123456789", sender_id: "123456789", tipo: "ml", modo: "salida", persona: "Juan", cliente: "Tienda Uno", escaneado_por: "Alejo", tanda: "t1", escaneado_at: "2026-11-16T13:00:00.000Z", s_alta: 0 });
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    // ingreso no lleva persona aunque se pase
    expect(nuevoEscaneo({ lectura: lec(QR_ML), modo: "ingreso", persona: "X", tanda: "t" }).persona).toBeNull();
  });
});

describe("cola de sincronización", () => {
  test("fila de subida: solo los campos de alta, sin estado local", () => {
    const f = filaParaSubir(esc(QR_ML));
    expect(Object.keys(f)).toEqual(CAMPOS_ALTA);
    expect(f.s_alta).toBeUndefined();
    expect(f.qr).toBe(QR_ML);
  });
  test("las marcas esperan a que el alta esté arriba", () => {
    const a = marcarMostrado(marcarBorrado(esc(QR_ML)), "Ana");
    expect(pendientesSync([a])).toMatchObject({ altas: [a], borrados: [], reesc: [], total: 1 });
    const subido = aplicarSubida(a, "alta");
    const p = pendientesSync([subido]);
    expect(p.borrados.map((x) => x.id)).toEqual([a.id]);
    expect(p.reesc).toEqual([]); // borrado: no se marca como mostrado
  });
  test("reintentar no duplica: aplicar la misma subida dos veces deja igual", () => {
    const regs = [esc(QR_ML), esc(QR_LD)];
    let estado = regs.map((r) => aplicarSubida(r, "alta"));
    estado = estado.map((r) => aplicarSubida(r, "alta"));
    expect(cuantosSinSubir(estado)).toBe(0);
    expect(new Set(estado.map((r) => r.id)).size).toBe(2);
  });
  test("una marca nueva hecha mientras subía la anterior no se da por subida", () => {
    const base = aplicarSubida(esc(QR_ML), "alta");
    const enVuelo = marcarMostrado(base, "Ana", T0);
    const fresco = { ...enVuelo, reesc_at: "2026-11-16T13:05:00.000Z" }; // cambió mientras tanto
    expect(aplicarSubida(fresco, "reesc", enVuelo).s_reesc).toBe(0);
    expect(aplicarSubida(enVuelo, "reesc", enVuelo).s_reesc).toBe(1);
  });
  test("marcar dos veces conserva la primera", () => {
    const m = marcarMostrado(esc(QR_ML), "Ana", T0);
    expect(marcarMostrado(m, "Beto", T0 + 1000)).toBe(m);
    const b = marcarBorrado(esc(QR_ML), T0);
    expect(marcarBorrado(b, T0 + 5)).toBe(b);
  });
  test("lotes", () => {
    expect(lotes([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(lotes([], 3)).toEqual([]);
  });
});

describe("fusión remoto + local", () => {
  test("une por id sin duplicar y conserva marcas de los dos lados", () => {
    const a = esc(QR_ML), b = esc(QR_LD);
    const remA = { ...filaParaSubir(a), reesc_at: "2026-11-16T15:00:00.000Z", reesc_por: "Monitor", borrado_at: null };
    const remC = { ...filaParaSubir(esc('{"id":"777"}')), reesc_at: null, borrado_at: null };
    const locB = marcarMostrado(b, "Ana");
    const out = fusionar([remA, remC], [a, locB]);
    expect(out).toHaveLength(3);
    expect(out.find((x) => x.id === a.id).reesc_at).toBe("2026-11-16T15:00:00.000Z");
    expect(out.find((x) => x.id === b.id).reesc_por).toBe("Ana");
    expect(desdeRemoto(remC).s_alta).toBe(1);
  });
});

describe("tandas a pasar", () => {
  const r = (codigo, extra) => ({ ...esc(`{"id":"${codigo}","sender_id":1}`), ...extra });
  test("salida por cadete, ingreso uno solo; el cliente no separa grupos", () => {
    const regs = [
      r("A1", { escaneado_at: "2026-11-16T13:00:01Z", cliente: "Tienda Uno" }),
      r("A2", { escaneado_at: "2026-11-16T13:00:00Z" }),
      r("A3", { sender_id: "2", escaneado_at: "2026-11-16T13:00:02Z" }),
      r("B1", { persona: "Pepe" }),
      r("C1", { modo: "ingreso", persona: null }),
      r("C2", { modo: "ingreso", persona: null }),
    ];
    const g = agruparTandas(regs);
    expect(g.map((x) => [x.modo, x.persona, x.total])).toEqual([
      ["ingreso", null, 2],
      ["salida", "Juan", 3],
      ["salida", "Pepe", 1],
    ]);
    // ordenados por hora dentro del grupo
    expect(g[1].items.map((x) => x.codigo)).toEqual(["A2", "A1", "A3"]);
  });
  test("una fila vieja de colecta (primera versión) se ignora sin romper", () => {
    const g = agruparTandas([r("V1", { modo: "colecta" }), r("S1")]);
    expect(g.map((x) => [x.modo, x.total])).toEqual([["salida", 1]]);
    expect(agruparTandas([r("V1", { modo: "colecta" })])).toEqual([]);
  });
  test("un código repetido aparece una sola vez; cuenta mostrados y completo; borrados afuera", () => {
    const hora = (s) => ({ escaneado_at: `2026-11-16T13:00:0${s}Z` });
    const regs = [r("A1", hora(1)), r("A1", { ...hora(2), tanda: "t9", reesc_at: "2026-11-16T14:00:00Z" }), r("A2", hora(3)), marcarBorrado(r("A3", hora(4)))];
    const [g] = agruparTandas(regs);
    expect(g.total).toBe(2);
    expect(g.mostrados).toBe(1);
    expect(g.completo).toBe(false);
    expect(primerPendiente(g.items)).toBe(1);
  });
  test("separa por día (AR)", () => {
    const g = agruparTandas([r("A1", { escaneado_at: "2026-11-16T02:00:00Z" }), r("A2", { escaneado_at: "2026-11-16T04:00:00Z" })]);
    expect(g.map((x) => x.dia)).toEqual(["2026-11-16", "2026-11-15"]);
    expect(diaAR("2026-11-16T02:00:00Z")).toBe("2026-11-15");
    expect(etiquetaDia("2026-11-16", T0)).toBe("Hoy · lun 16/11");
  });
  test("primer pendiente: todos mostrados vuelve al inicio", () => {
    expect(primerPendiente([{ reesc_at: "x" }, { reesc_at: "y" }])).toBe(0);
    expect(primerPendiente([])).toBe(0);
  });
});

describe("QR regenerado = texto crudo, byte a byte", () => {
  const casos = [
    QR_ML,
    QR_LD,
    '{"id":"46012345678","sender_id":987654321,"hash_code":"qK3+Lw/8Zz0=","security_digit":"7"}',
    ` ${QR_ML}\n`,
    "2000019256677600",
    '{"id":"1","nota":"Ñandú — envío"}',
  ];
  test.each(casos)("%s", (crudo) => {
    const lectura = leerContingencia(crudo);
    const guardado = nuevoEscaneo({ lectura, modo: "ingreso", tanda: "t" }).qr;
    // ida y vuelta por JSON (IndexedDB / Supabase guardan el string)
    const recuperado = JSON.parse(JSON.stringify({ qr: guardado })).qr;
    const img = pixelesQR(matrizQR(recuperado), 4);
    const leido = jsQR(img.data, img.ancho, img.alto);
    expect(leido).not.toBeNull();
    expect(leido.data).toBe(crudo);
    expect(Buffer.from(leido.binaryData).equals(Buffer.from(crudo, "utf8"))).toBe(true);
  });
});

describe("errores y lotes", () => {
  test("clasifica errores de Supabase", () => {
    expect(clasificarError(new Error('{"code":"42501","message":"new row violates row-level security policy for table \\"contingencia_escaneos\\""}'))).toBe("sesion");
    expect(clasificarError(new Error('{"code":"PGRST205","message":"Could not find the table \'public.contingencia_escaneos\' in the schema cache"}'))).toBe("tabla");
    expect(clasificarError(new Error('{"code":"42P01","message":"relation \\"public.contingencia_escaneos\\" does not exist"}'))).toBe("tabla");
    expect(clasificarError(new TypeError("Load failed"))).toBe("red");
  });
  test("lotes por campo no mezclan valores", () => {
    const xs = [{ p: "a", i: 1 }, { p: "b", i: 2 }, { p: "a", i: 3 }, { p: "a", i: 4 }];
    expect(lotesPor(xs, "p", 2).map((l) => l.map((x) => x.i))).toEqual([[1, 3], [4], [2]]);
  });
});
