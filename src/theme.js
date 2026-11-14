// ── Tokens de diseño de Flexit ──
// Única fuente de verdad de color, tipografía, radios y movimiento. La referencia visual es el Home.
// Pantalla nueva o retoque: importar de acá en vez de escribir el valor a mano.
//   import { FX, FX_FONT } from "./theme";

export const FX_FONT = {
  // Títulos de pantalla y números grandes (indicadores)
  display: "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
  // Texto corrido, tablas, botones
  body: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Helvetica Neue', sans-serif",
  // Números de envío, códigos
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

export const FX = {
  color: {
    // Texto: principal / secundario / terciario
    ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e",
    // Marca y estados. El color se usa para ESTADO, no para decorar.
    teal: "#2EE6B6",   // ok / acción principal
    ambar: "#F5C044",  // atención
    rojo: "#E8615F",   // crítico
    azul: "#5BA8E8",   // informativo
    lila: "#bd8ed8",
    // Superficies
    fondo: "#061225",
    glass: "rgba(27,28,46,0.72)", glassSoft: "rgba(27,28,46,0.6)", pop: "rgba(24,25,42,0.92)",
    line: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.09)",
    // Mismos estados en formato "r,g,b" para armar rgba(...) con transparencia
    tealRgb: "46,230,182", ambarRgb: "245,192,68", rojoRgb: "232,97,95",
  },
  // Radios: chico (chips, inputs) / medio (botones) / grande (paneles) / tarjeta
  radius: { sm: 6, md: 10, lg: 14, xl: 20, pill: 999 },
  // Escala tipográfica. Piso de lectura: 12.
  size: { xs: 11, sm: 12, md: 13, lg: 15, xl: 18, kpi: 26 },
  weight: { normal: 400, medium: 500, semi: 600, bold: 700 },
  shadow: { card: "0 20px 60px rgba(0,0,0,0.28)" },
  motion: { fast: "150ms ease" },
};

export const rgba = (rgb, a) => `rgba(${rgb},${a})`;
