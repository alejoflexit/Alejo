import React, { useState } from "react";
import { todayStr } from "./colectasShared";

// Aviso plegable del Home para los feriados de la visita del Papa (9, 10 y 11 de noviembre de 2026).
// Se muestra solo con sesión (nombra clientes) y deja de aparecer después del jueves 12/11.
// Cerrado muestra una línea; se abre con un toque (nada en hover: cambia el alto).

const C = {
  ink: "#f4f5fa", ink2: "#a7adc2", ink3: "#71768e",
  glass: "rgba(27,28,46,0.72)", line: "rgba(255,255,255,0.06)",
  azul: "#5BA8E8", grotesk: "'Space Grotesk', -apple-system, 'Segoe UI', sans-serif",
};
const VENCE = "2026-11-12"; // último día visible

const DIAS = [
  {
    t: "Lunes 9", sub: "Feriado nacional",
    items: [
      "De 15:30 a 21:00 el Papa está por Microcentro y alrededores, muy cerca de la base.",
      "Recoleta, Palermo y Retiro: repartir antes de las 9:00 o después de las 14:00.",
      "Almirante Brown: evitar repartos entre las 8:30 y las 10:30.",
    ],
  },
  {
    t: "Martes 10", sub: "Feriado en CABA",
    items: [
      "Recoleta, Palermo y Retiro: terminar antes de las 17:00. A las 20:15 hay vigilia en Palermo.",
      "Moreno, Rodríguez, Luján y Marcos Paz: terminar antes de las 12:00.",
      "Desde el mediodía se esperan cortes en los accesos a Luján (rutas 5, 7 y 6).",
    ],
  },
  {
    t: "Miércoles 11", sub: "Feriado en Provincia",
    items: [
      "Luján centro: no se entrega.",
      "Morón, Ituzaingó y Merlo: salir después de las 11:30.",
      "Pilar y alrededores: evitar Ruta 6.",
      "Devoto: evitar repartos entre las 7:00 y las 9:00.",
      "Ezeiza y Esteban Echeverría: atención a los cortes de la tarde.",
    ],
  },
];

const OTROS = [
  "Av. Libertador cortada entre Olleros y Ugarteche del 4 al 14 de noviembre.",
  "Perímetro cerrado en la zona de la Nunciatura (Libertador, Callao, Quintana, Juncal y Cerrito) del 7 al 11. Proveedores solo en algunos horarios.",
  "Luján centro peatonal desde el lunes 9.",
];

const ZONAS = [
  ["Recoleta, Palermo y Retiro", "~135", "Lun antes de 9:00 o después de 14:00 · Mar terminar antes de 17:00"],
  ["Morón, Ituzaingó y Merlo", "~85", "Mié salir después de 11:30"],
  ["Moreno, Rodríguez, Luján y Marcos Paz", "~90", "Mar terminar antes de 12:00 · Mié no entregar en Luján centro"],
  ["Belgrano, Colegiales y Núñez", "~80", "Evitar Av. Libertador"],
  ["Pilar y alrededores", "~70", "Mié evitar Ruta 6"],
  ["Almirante Brown", "~60", "Lun evitar de 8:30 a 10:30"],
  ["Centro y Monserrat", "~55", "Lun atención de 15:30 a 21:00"],
  ["Ezeiza y Esteban Echeverría", "~55", "Mié atención a los cortes de la tarde"],
  ["Devoto", "~35", "Mié evitar de 7:00 a 9:00"],
];

const COLECTAS = [
  ["Alto", "Polo Industrial Ezeiza", "La Plata Trade Ezeiza, Instrumental Pasteur, Borrachines, Limpionline, Cercis e Infinix", "Mié 11: retirar antes de las 11:00 o pasar al jueves. El Papa pasa por la zona entre 11:30 y 14:00."],
  ["Alto", "Moreno, Trujui y Paso del Rey", "Wabro, KONTROLL y La Reina del Cotillón", "Mar 10: retirar antes de las 13:00. Mié 11: coordinar después de las 11:30."],
  ["Alto", "Concepto Estético", "Libertador 5190", "Consultar si su cuadra queda dentro del corte."],
  ["Medio", "Pilar, Villa Rosa y Matheu", "Zafra, Buho Color, PSR, Staleks y Cultivando Sur", "Mié 11: evitar Ruta 6 y coordinar recorridos alternativos."],
  ["Medio", "Morón, Ituzaingó y Merlo", "Plenty, Goldenbike, Arguz, JAVINA, Nitid y Componentes Merlo", "Mié 11: programar las colectas después de las 12:00."],
  ["Medio", "Palermo", "11 clientes", "Lun 9: coordinar las colectas desde las 15:00."],
  ["Normal", "Microcentro/Monserrat, Adrogué y Devoto", "", "Operación normal por ahora, sujeta a los cortes oficiales."],
];

const GRANDES = [
  ["La Plata Trade", 253], ["Independent Agents", 192], ["Unistore", 176], ["Ikorso", 148], ["Zafra", 118],
  ["Buho Color", 91], ["Legatus", 68], ["Celulares y Etc.", 59], ["Mo Mascotas", 53], ["Paperland", 49],
];

const PENDIENTES = [
  ["Antes del lunes 2", ["Mandar mensaje a todos los clientes para confirmar si despachan el 9, 10 y 11 (hay tres versiones: general, Polo Ezeiza y zona oeste/Pilar)."]],
  ["Miércoles 4", ["Confirmación escrita de los 10 clientes grandes.", "Consultar a Meli qué zonas va a limitar.", "Revisar de nuevo los cortes oficiales, sobre todo los de recorrido."]],
  ["Jueves 5", ["Definir la dotación de cadetes para los tres días, con refuerzo el martes.", "Identificar cadetes que vivan en zona oeste para cubrir el miércoles."]],
  ["Viernes 6", ["Cargar todos los cortes en la Pizarra.", "Avisar a los cadetes qué zonas evitar y en qué horarios."]],
];

const PRIORIDADES = [
  "Confirmar qué clientes despachan cada día.",
  "Reorganizar las colectas y los recorridos afectados por los cortes.",
  "Asegurar suficientes cadetes, sobre todo el martes 10.",
  "Cargar las restricciones en la Pizarra y comunicar los cambios antes del fin de semana.",
];

const Chevron = ({ open }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.ink2} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s ease", flexShrink: 0 }}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

function Bloque({ titulo, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontFamily: C.grotesk, fontSize: 11, fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: C.azul }}>{titulo}</div>
      {children}
    </div>
  );
}

const lista = { margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5, color: C.ink2, fontSize: 13.5, lineHeight: 1.5 };
const chip = (nivel) => ({
  fontSize: 10.5, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap", alignSelf: "flex-start",
  color: nivel === "Alto" ? C.ink : nivel === "Medio" ? C.ink2 : C.ink3,
  background: nivel === "Alto" ? "rgba(255,255,255,0.12)" : nivel === "Medio" ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
  border: `1px solid ${C.line}`,
});

export default function AvisoFeriados({ isMobile, session }) {
  const [open, setOpen] = useState(false);
  if (!session) return null;
  if (todayStr() > VENCE) return null;

  const sep = <div style={{ height: 1, background: C.line }} />;
  return (
    <section aria-label="Aviso feriados 9 al 11 de noviembre" style={{
      position: "relative", background: C.glass, border: `1px solid rgba(91,168,232,0.28)`, borderRadius: 18,
      boxShadow: "0 20px 60px rgba(0,0,0,0.28)", WebkitBackdropFilter: "blur(18px) saturate(140%)", backdropFilter: "blur(18px) saturate(140%)",
      overflow: "hidden",
    }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: isMobile ? "14px 16px" : "16px 22px", background: "linear-gradient(100deg, rgba(91,168,232,0.10), transparent 60%)", border: "none", color: C.ink, textAlign: "left", cursor: "pointer", minHeight: 44 }}>
        <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 11, background: "rgba(91,168,232,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.azul} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontFamily: C.grotesk, fontSize: 11, fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: C.azul }}>Aviso feriados</span>
          <span style={{ display: "block", fontFamily: C.grotesk, fontWeight: 600, fontSize: isMobile ? 15.5 : 17, marginTop: 3, lineHeight: 1.3 }}>9, 10 y 11 de noviembre · Visita del Papa</span>
          <span style={{ display: "block", fontSize: 12.5, color: C.ink3, marginTop: 2 }}>{open ? "Tocá para cerrar" : "Operamos los 3 días. Tocá para ver cortes, zonas y colectas."}</span>
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div style={{ padding: isMobile ? "4px 16px 18px" : "6px 22px 22px", display: "flex", flexDirection: "column", gap: 18 }}>
          <Bloque titulo="1 · Decisión operativa: trabajamos los 3 días">
            <ul style={lista}>
              <li><b style={{ color: C.ink }}>Lunes 9:</b> feriado nacional. Los vendedores no prometen por defecto, pero pueden activar las promesas. Meli nos pide operar.</li>
              <li><b style={{ color: C.ink }}>Martes 10:</b> feriado en CABA. Las promesas funcionan normal.</li>
              <li><b style={{ color: C.ink }}>Miércoles 11:</b> feriado en Provincia. Las promesas funcionan normal.</li>
            </ul>
            <div style={{ fontSize: 13.5, color: C.ink2, lineHeight: 1.5 }}>
              Meli todavía no confirmó qué zonas va a limitar. <b style={{ color: C.ink }}>Por qué trabajar el lunes:</b> el lunes 26/10 hicimos 3.031 envíos y martes y miércoles rondamos los 2.170. Si no repartimos el lunes, el martes podríamos superar los <b style={{ color: C.ink }}>5.000 envíos</b>.
            </div>
          </Bloque>
          {sep}

          <Bloque titulo="2 · Cortes y restricciones">
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              {DIAS.map((d) => (
                <div key={d.t} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", background: "rgba(255,255,255,0.025)", minWidth: 0 }}>
                  <div style={{ fontFamily: C.grotesk, fontWeight: 600, fontSize: 15 }}>{d.t}</div>
                  <div style={{ fontSize: 12, color: C.ink3, marginBottom: 8 }}>{d.sub}</div>
                  <ul style={{ ...lista, fontSize: 13 }}>{d.items.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ))}
            </div>
            <div style={{ fontWeight: 600, fontSize: 13.5, marginTop: 2 }}>Otros cortes importantes</div>
            <ul style={lista}>{OTROS.map((x) => <li key={x}>{x}</li>)}</ul>
          </Bloque>
          {sep}

          <Bloque titulo="3 · Zonas de reparto afectadas">
            <div style={{ fontSize: 13.5, color: C.ink2 }}>Unos <b style={{ color: C.ink }}>660 envíos por día</b> (~27% del volumen). El resto debería operar normal, sujeto a los cortes definitivos.</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {ZONAS.map(([z, n, q], i) => (
                <div key={z} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : "minmax(0, 1.3fr) 70px minmax(0, 2fr)", columnGap: 12, rowGap: 2, padding: "8px 0", borderTop: i ? `1px solid ${C.line}` : "none", fontSize: 13.5 }}>
                  <span style={{ fontWeight: 600 }}>{z}</span>
                  <span style={{ color: C.ink2, fontVariantNumeric: "tabular-nums", textAlign: isMobile ? "right" : "left" }}>{n}/día</span>
                  <span style={{ color: C.ink2, gridColumn: isMobile ? "1 / -1" : "auto" }}>{q}</span>
                </div>
              ))}
            </div>
          </Bloque>
          {sep}

          <Bloque titulo="4 · Colectas a reorganizar">
            <div style={{ display: "flex", flexDirection: "column" }}>
              {COLECTAS.map(([nivel, zona, clientes, accion], i) => (
                <div key={zona} style={{ display: "flex", gap: 12, padding: "9px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                  <span style={chip(nivel)}>{nivel}</span>
                  <div style={{ minWidth: 0, fontSize: 13.5, lineHeight: 1.45 }}>
                    <div style={{ fontWeight: 600 }}>{zona}</div>
                    {clientes && <div style={{ color: C.ink3, fontSize: 12.5 }}>{clientes}</div>}
                    <div style={{ color: C.ink2, marginTop: 2 }}>{accion}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13.5, color: C.ink2 }}><b style={{ color: C.ink }}>Importante:</b> el martes 10 es feriado en CABA y el miércoles 11 en Provincia. Hay que confirmar con cada cliente si despacha esos días.</div>
          </Bloque>
          {sep}

          <Bloque titulo="5 · Clientes grandes: confirmar por escrito">
            <div style={{ fontSize: 13.5, color: C.ink2 }}>Estos 10 clientes son ~49% del volumen. Hay que saber si despachan cada uno de los tres días.</div>
            <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", columnGap: 28, rowGap: 4, fontSize: 13.5, color: C.ink2 }}>
              {GRANDES.map(([n, v]) => <li key={n}><span style={{ color: C.ink }}>{n}</span> · <span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span> envíos/día</li>)}
            </ol>
          </Bloque>
          {sep}

          <Bloque titulo="6 · Pendientes y fechas">
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {PENDIENTES.map(([f, xs]) => (
                <div key={f} style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 4 }}>{f}</div>
                  <ul style={lista}>{xs.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ))}
            </div>
          </Bloque>
          {sep}

          <Bloque titulo="Las 4 prioridades">
            <ol style={{ ...lista, paddingLeft: 22 }}>{PRIORIDADES.map((x) => <li key={x} style={{ color: C.ink }}>{x}</li>)}</ol>
            <div style={{ fontSize: 13.5, color: C.ink2 }}>La idea es operar los tres días, evitar que se acumule todo el martes y anticiparnos a los cortes para no perder entregas.</div>
          </Bloque>
        </div>
      )}
    </section>
  );
}
