import React from "react";

// Piezas compartidas de los escáneres (Palermo A/B, Doble bulto, ingreso de Devoluciones).
// Diseño aprobado por Alejo el 20/11/2026: cámara a pantalla completa estilo Flex, vidrio esmerilado
// estilo iOS con el degradé de la app (índigo → petróleo) y acento verde agua. Referencia: lienzo
// "Escáneres estilo Flex". Solo presentación: cada escáner mantiene su lógica.

const I = ({ children, size = 20, sw = 2, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
export const IcoAtras = (p) => <I {...p}><path d="m15 18-6-6 6-6" /></I>;
export const IcoCerrar = (p) => <I size={18} {...p}><path d="M18 6 6 18M6 6l12 12" /></I>;
export const IcoTeclado = (p) => <I size={22} sw={1.8} {...p}><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M8 14h8" /></I>;
export const IcoLista = (p) => <I size={22} sw={1.8} {...p}><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></I>;
export const IcoPin = (p) => <I size={16} {...p}><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" /><circle cx="12" cy="9" r="2.5" /></I>;
export const IcoCaja = (p) => <I size={16} {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="M3 8l9 5 9-5M12 13v8" /></I>;
export const IcoEstante = (p) => <I size={16} {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18" /></I>;
export const IcoAviso = (p) => <I size={16} {...p}><path d="M12 3 2 21h20Z" /><path d="M12 10v5M12 18h.01" /></I>;
export const IcoOk = (p) => <I size={16} sw={2.4} {...p}><path d="M20 6 9 17l-5-5" /></I>;
export const IcoEscanear = (p) => <I size={22} {...p}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 12h10" /></I>;

// Barra de arriba: botón circular para volver, título centrado, algo a la derecha (pastilla)
export function EscArriba({ titulo, onVolver, derecha, volverLabel = "Volver" }) {
  return (
    <div className="esc-arriba">
      <button className="esc-circ" onClick={onVolver} aria-label={volverLabel}><IcoAtras /></button>
      <div className="esc-titulo">{titulo}</div>
      <div className="esc-der">{derecha}</div>
    </div>
  );
}
export const EscPastilla = ({ children, onClick }) => (onClick
  ? <button className="esc-pill" onClick={onClick}>{children}</button>
  : <span className="esc-pill">{children}</span>);

// Esquinas del visor: casi invisibles (pedido de Alejo 20/11); se marcan solo al leer una etiqueta
export const EscMarco = ({ estado }) => <div className={"esc-marco" + (estado ? " " + estado : "")}><i /><i /><i /><i /></div>;

// Mensaje flotante sobre la cámara (vidrio)
export const EscAyuda = ({ children, tono }) => <div className="esc-ayuda-wrap"><div className={"esc-ayuda" + (tono ? " " + tono : "")}>{children}</div></div>;

// Barra flotante de abajo: dos contadores y el botón del medio
function Seg({ n, label, punto, onClick }) {
  const C = onClick ? "button" : "div";
  return (
    <C className="esc-seg" onClick={onClick}>
      <span className="esc-seg-n">{punto ? <i style={{ background: punto }} /> : null}<b>{n}</b></span>
      <small>{label}</small>
    </C>
  );
}
export function EscBarra({ izq, der, onCentro, centroLabel = "Tipear código", centro }) {
  return (
    <div className="esc-barra">
      <Seg {...izq} />
      <button className="esc-centro" onClick={onCentro} aria-label={centroLabel}>{centro || <IcoTeclado />}</button>
      <Seg {...der} />
    </div>
  );
}

// Hoja de abajo: rayita, botón para cerrar, título
export function EscHoja({ titulo, onCerrar, cerrarLabel = "Descartar", children, className = "" }) {
  return (
    <div className={"esc-hoja " + className}>
      <div className="esc-raya" />
      <div className="esc-hoja-cab">
        {onCerrar ? <button className="esc-circ chico" onClick={onCerrar} aria-label={cerrarLabel}><IcoCerrar /></button> : <span style={{ width: 36 }} />}
        <div className="esc-hoja-tit">{titulo}</div>
        <span style={{ width: 36 }} />
      </div>
      {children}
    </div>
  );
}
export const EscEtiqueta = ({ icono, children, tono }) => <div className={"esc-etq" + (tono ? " " + tono : "")}>{icono}<span>{children}</span></div>;
export const EscGrupo = ({ children }) => <div className="esc-grupo">{children}</div>;
export const EscFila = ({ k, v, onClick }) => {
  const C = onClick ? "button" : "div";
  return <C className="esc-fila" onClick={onClick}><span className="k">{k}</span><span className="v">{v}</span></C>;
};

export const ESC_CSS = `
.esc{position:fixed;top:0;left:0;width:100vw;height:100vh;height:100dvh;z-index:90;overflow:hidden;background:#0b0a1e;color:#fff;font-family:-apple-system,'SF Pro Text','SF Pro Display',Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.esc *{box-sizing:border-box}
.esc-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;transition:opacity .18s}
.esc-vineta{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 90% at 50% 50%,rgba(0,0,0,0) 55%,rgba(11,10,30,.6) 100%)}
.esc-abriendo{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.55);font-size:15px}
.esc-vidrio,.esc-circ,.esc-pill,.esc-ayuda,.esc-barra{background:linear-gradient(160deg,rgba(34,30,96,.55) 0%,rgba(10,37,52,.55) 100%);-webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);border:1px solid rgba(160,170,255,.18)}
.esc-arriba{position:absolute;left:16px;right:16px;top:calc(env(safe-area-inset-top) + 10px);display:flex;align-items:center;gap:10px;z-index:4}
.esc-circ{width:44px;height:44px;border-radius:22px;display:flex;align-items:center;justify-content:center;padding:0;color:#fff;cursor:pointer;flex:none;touch-action:manipulation}
.esc-circ.chico{width:36px;height:36px;border-radius:18px}
.esc-titulo{flex:1;text-align:center;font-size:17px;font-weight:600;letter-spacing:-.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.esc-der{min-width:44px;display:flex;justify-content:flex-end}
.esc-pill{height:32px;padding:0 12px;border-radius:16px;color:#fff;font:inherit;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;cursor:default}
button.esc-pill{cursor:pointer}
.esc-marco{position:absolute;left:50%;top:44%;width:min(60vw,240px);aspect-ratio:1/1;transform:translate(-50%,-50%);pointer-events:none}
.esc-marco i{position:absolute;width:28px;height:28px;border:0 solid rgba(255,255,255,.18);transition:border-color .2s}
.esc-marco i:nth-child(1){left:0;top:0;border-left-width:2px;border-top-width:2px;border-top-left-radius:22px}
.esc-marco i:nth-child(2){right:0;top:0;border-right-width:2px;border-top-width:2px;border-top-right-radius:22px}
.esc-marco i:nth-child(3){left:0;bottom:0;border-left-width:2px;border-bottom-width:2px;border-bottom-left-radius:22px}
.esc-marco i:nth-child(4){right:0;bottom:0;border-right-width:2px;border-bottom-width:2px;border-bottom-right-radius:22px}
.esc-marco.ok i{border-color:#2EE6B6}.esc-marco.aviso i{border-color:#ffcc4d}
.esc-ayuda-wrap{position:absolute;left:16px;right:16px;top:calc(44% + min(30vw,120px) + 22px);display:flex;justify-content:center;z-index:3;pointer-events:none}
.esc-ayuda{padding:8px 14px;border-radius:18px;font-size:14px;font-weight:500;color:rgba(255,255,255,.92);text-align:center;max-width:100%}
.esc-ayuda.ok{border-color:rgba(46,230,182,.5)}.esc-ayuda.aviso{border-color:rgba(255,204,77,.6);color:#ffe7a3}
.esc-barra{position:absolute;left:16px;right:16px;bottom:calc(env(safe-area-inset-bottom) + 14px);height:68px;border-radius:34px;display:flex;align-items:center;padding:0 8px;box-shadow:0 12px 40px rgba(0,0,0,.45);z-index:5}
.esc-seg{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;background:none;border:0;color:#fff;font:inherit;padding:0;height:100%;cursor:default}
button.esc-seg{cursor:pointer}
.esc-seg-n{display:flex;align-items:center;gap:6px}
.esc-seg-n i{width:8px;height:8px;border-radius:4px;display:block}
.esc-seg-n b{font-size:22px;font-weight:700;letter-spacing:-.4px;font-variant-numeric:tabular-nums}
.esc-seg small{font-size:11px;font-weight:500;color:rgba(255,255,255,.6);white-space:nowrap}
.esc-centro{width:52px;height:52px;border-radius:26px;flex:none;border:1px solid rgba(46,230,182,.35);background:linear-gradient(160deg,rgba(46,230,182,.30),rgba(90,80,220,.35));color:#fff;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;touch-action:manipulation}
.esc-hoja{position:absolute;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom) + 96px);max-height:calc(100% - 180px);overflow:auto;border-radius:34px;padding:8px 16px 16px;display:flex;flex-direction:column;gap:12px;z-index:6;background:linear-gradient(180deg,rgba(24,20,70,.9) 0%,rgba(9,22,42,.9) 55%,rgba(8,38,52,.9) 100%);-webkit-backdrop-filter:blur(40px) saturate(180%);backdrop-filter:blur(40px) saturate(180%);border:1px solid rgba(160,170,255,.16);box-shadow:0 -10px 50px rgba(0,0,0,.5);animation:esc-sube .18s ease-out}
.esc-hoja>*{width:100%;max-width:520px;margin-left:auto;margin-right:auto}
@keyframes esc-sube{from{transform:translateY(16px);opacity:.6}to{transform:none;opacity:1}}
.esc-raya{align-self:center;width:36px!important;height:5px;border-radius:3px;background:rgba(255,255,255,.28);flex:none}
.esc-hoja-cab{display:flex;align-items:center;gap:10px}
.esc-hoja-tit{flex:1;text-align:center;font-size:17px;font-weight:600;letter-spacing:-.2px}
.esc-etq{display:flex;align-items:center;gap:8px;color:rgba(255,255,255,.85);font-size:15px;font-weight:600;padding:0 4px}
.esc-etq svg{color:rgba(255,255,255,.6);flex:none}
.esc-etq.aviso,.esc-etq.aviso svg{color:#ffcc4d}.esc-etq.ok,.esc-etq.ok svg{color:#2EE6B6}
.esc-grupo{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.05);border-radius:18px;overflow:hidden}
.esc-fila{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 16px;background:none;border:0;color:#fff;font:inherit;text-align:left}
.esc-fila+.esc-fila{border-top:1px solid rgba(255,255,255,.08)}
button.esc-fila{cursor:pointer}
.esc-fila .k{font-size:16px;font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis}
.esc-fila .v{font-size:15px;color:rgba(255,255,255,.6);text-align:right;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.esc-botones{display:flex;gap:10px}
.esc-btn{flex:1;min-height:56px;border-radius:28px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:#fff;font:inherit;font-size:17px;font-weight:600;cursor:pointer;touch-action:manipulation;padding:0 14px}
.esc-btn.suave{min-height:50px;border:0;font-size:16px;font-weight:500;color:rgba(255,255,255,.85)}
.esc-btn:disabled{opacity:.45;cursor:default}
.esc-btn:active:not(:disabled){transform:scale(.98)}
.esc-btn.glow-a{background:radial-gradient(120% 140% at 20% 100%,rgba(48,209,88,.75) 0%,rgba(0,0,0,0) 60%),radial-gradient(120% 140% at 90% 0%,rgba(48,209,88,.25) 0%,rgba(0,0,0,0) 55%),rgba(255,255,255,.08)}
.esc-btn.glow-b{background:radial-gradient(120% 140% at 20% 100%,rgba(255,159,10,.75) 0%,rgba(0,0,0,0) 60%),radial-gradient(120% 140% at 90% 0%,rgba(255,159,10,.25) 0%,rgba(0,0,0,0) 55%),rgba(255,255,255,.08)}
.esc-btn.glow-teal{background:radial-gradient(120% 140% at 20% 100%,rgba(46,230,182,.55) 0%,rgba(0,0,0,0) 60%),radial-gradient(120% 140% at 90% 0%,rgba(110,90,255,.45) 0%,rgba(0,0,0,0) 55%),rgba(255,255,255,.08)}
.esc-btn.glow-amb{background:radial-gradient(120% 140% at 20% 100%,rgba(255,204,77,.7) 0%,rgba(0,0,0,0) 60%),radial-gradient(120% 140% at 90% 0%,rgba(255,159,10,.3) 0%,rgba(0,0,0,0) 55%),rgba(255,255,255,.08)}
.esc-input{width:100%;height:50px;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;font:inherit;font-size:16px;padding:0 14px;outline:none}
.esc-input:focus{border-color:rgba(46,230,182,.6)}
.esc-lugar{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 18px;border-radius:18px;border:1px solid rgba(46,230,182,.25);background:radial-gradient(130% 160% at 100% 50%,rgba(46,230,182,.32) 0%,rgba(0,0,0,0) 60%),rgba(255,255,255,.06)}
.esc-lugar b{font-size:48px;line-height:1;font-weight:700;letter-spacing:-1.5px}
.esc-nota{font-size:13px;color:rgba(255,255,255,.55);text-align:center}
.esc-sub{font-size:14px;line-height:1.45;color:rgba(255,255,255,.7);padding:0 4px}
@media (prefers-reduced-motion:reduce){.esc-hoja{animation:none}}
`;
