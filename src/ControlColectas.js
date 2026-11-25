// ControlColectas.js — bloque "Colectas" arriba de la lista de Arribos (Alejo 25/11/2026).
// Muestra lo que falta (vencidas, pendientes, sin vincular) y deja plegadas las colectadas.
// Lógica en controlColectasShared.js. Interacción con taps (iPhone): nada de long-press.
import React, { useState, useRef, useEffect } from 'react';
import { BRAND } from './colectasShared';
import { FX_FONT } from './theme';
import { buscarCuentas } from './controlColectasShared';

const C = {
  verde: '#2EE6B6', amarillo: '#F5C044', rojo: '#E8615F', gris: 'rgba(255,255,255,0.45)',
};
const ESTILO = {
  vencida:      { color: C.rojo,     bg: 'rgba(232,97,95,0.12)' },
  pendiente:    { color: C.amarillo, bg: 'rgba(245,192,68,0.10)' },
  sin_vincular: { color: C.gris,     bg: 'rgba(255,255,255,0.04)' },
  sin_datos:    { color: C.gris,     bg: 'rgba(255,255,255,0.04)' },
  colectada:    { color: C.verde,    bg: 'rgba(46,230,182,0.08)' },
};

const hora = (iso) => { try { return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// Botón de dos toques: el 1º arma, el 2º confirma; se desarma solo a los 4 s.
function BotonConfirmar({ label, confirmar, color, onOk }) {
  const [armado, setArmado] = useState(false);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const tocar = () => {
    if (armado) { clearTimeout(t.current); setArmado(false); onOk(); return; }
    setArmado(true); clearTimeout(t.current); t.current = setTimeout(() => setArmado(false), 4000);
  };
  return (
    <button onClick={tocar}
      style={{ height: 30, padding: '0 10px', borderRadius: 9, fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', touchAction: 'manipulation', fontFamily: 'inherit',
        border: `1px ${armado ? 'solid' : 'dashed'} ${color}`, background: armado ? `${color}22` : 'transparent', color }}>
      {armado ? confirmar : label}
    </button>
  );
}

function Vincular({ cuentas, onElegir, onCerrar }) {
  const [q, setQ] = useState('');
  const res = buscarCuentas(cuentas, q);
  return (
    <div style={{ marginTop: 6, padding: 8, borderRadius: 10, background: 'rgba(0,0,0,0.2)', border: `1px solid ${BRAND.border}` }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cuenta en LightData"
          style={{ flex: 1, minWidth: 0, padding: '6px 10px', fontSize: 13, borderRadius: 8, border: `1px solid ${BRAND.border}`, background: BRAND.faint, color: BRAND.white, outline: 'none' }} />
        <button onClick={onCerrar} aria-label="Cerrar"
          style={{ width: 30, borderRadius: 8, border: `1px solid ${BRAND.border}`, background: 'transparent', color: BRAND.muted, cursor: 'pointer' }}>✕</button>
      </div>
      {q && res.length === 0 && <div style={{ fontSize: 12, color: BRAND.muted, padding: '6px 2px' }}>No hay cuentas con ese nombre.</div>}
      {res.map(c => (
        <button key={c.id} onClick={() => onElegir(c)}
          style={{ display: 'flex', width: '100%', justifyContent: 'space-between', marginTop: 4, padding: '7px 8px', borderRadius: 8, border: 'none', background: BRAND.faint, color: BRAND.white, fontSize: 13, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
          <span>{c.nombre}</span><span style={{ color: BRAND.muted }}>#{c.id}</span>
        </button>
      ))}
    </div>
  );
}

function Fila({ it, cuentasLD, onMarcar, onVincular }) {
  const [vinc, setVinc] = useState(false);
  const st = ESTILO[it.estado];
  let derecha;
  if (it.estado === 'colectada') {
    derecha = it.manual
      ? <span style={{ fontSize: 12, color: C.verde }}>a mano{it.manualPor ? ` · ${it.manualPor}` : ''} {hora(it.manualAt)}</span>
      : <span style={{ fontSize: 12, color: C.verde }}>{it.cantidad} envíos</span>;
  } else if (it.estado === 'vencida') {
    derecha = <span style={{ fontSize: 12, color: C.rojo, fontWeight: 600 }}>sin colectar</span>;
  } else if (it.estado === 'pendiente') {
    derecha = <span style={{ fontSize: 12, color: C.amarillo }}>pendiente</span>;
  } else if (it.estado === 'sin_vincular') {
    derecha = <button onClick={() => setVinc(v => !v)}
      style={{ height: 30, padding: '0 10px', borderRadius: 9, fontSize: 12, cursor: 'pointer', border: `1px solid ${BRAND.border}`, background: 'transparent', color: BRAND.white, fontFamily: 'inherit' }}>Vincular cuenta</button>;
  } else {
    derecha = <span style={{ fontSize: 12, color: C.gris }}>sin datos</span>;
  }
  return (
    <div style={{ padding: '8px 10px', borderRadius: 10, background: st.bg, marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: BRAND.white, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.nombre}</div>
          <div style={{ fontSize: 11, color: BRAND.muted }}>
            {it.choferes.join(' / ')}{it.compartida ? ' · cuenta compartida con otra sucursal' : ''}
          </div>
        </div>
        {derecha}
      </div>
      {it.estado !== 'colectada' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <BotonConfirmar label="Marcar colectada" confirmar="✓ Confirmar" color={C.verde} onOk={() => onMarcar(it, true)} />
        </div>
      )}
      {it.estado === 'colectada' && it.manual && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <BotonConfirmar label="Deshacer" confirmar="Sacar marca" color={C.rojo} onOk={() => onMarcar(it, false)} />
        </div>
      )}
      {vinc && <Vincular cuentas={cuentasLD} onCerrar={() => setVinc(false)} onElegir={c => { setVinc(false); onVincular(it.clienteId, c); }} />}
    </div>
  );
}

export default function ControlColectas({ control, corte, ldOk, actualizado, tablaFalta, cuentasLD, onMarcar, onVincular }) {
  const [verColectadas, setVerColectadas] = useState(false);
  if (!control || control.total === 0) return null;
  const { items, total, colectadas, vencidas } = control;
  const pct = Math.round(colectadas / total * 100);
  const faltan = items.filter(i => i.estado !== 'colectada');
  const hechas = items.filter(i => i.estado === 'colectada');
  const colorPct = pct === 100 ? C.verde : vencidas > 0 ? C.rojo : C.amarillo;
  return (
    <div style={{ background: BRAND.navyCard, border: `1px solid ${vencidas > 0 ? 'rgba(232,97,95,0.45)' : BRAND.border}`, borderRadius: 14, padding: '16px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: BRAND.white }}>Colectas: {colectadas} de {total} colectadas</span>
        <span style={{ fontFamily: FX_FONT.display, fontSize: 24, fontWeight: 800, color: colorPct }}>{pct}%</span>
      </div>
      <div style={{ height: 12, borderRadius: 20, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 20, background: pct === 100 ? C.verde : `linear-gradient(90deg,${C.amarillo},${C.verde})`, transition: 'width 0.3s' }} />
      </div>
      <div style={{ fontSize: 12, color: BRAND.muted, marginTop: 8 }}>
        Corte {corte}{faltan.length ? ` · faltan ${faltan.length}` : ''}
        {ldOk ? (actualizado ? ` · LightData ${hora(actualizado)}` : '') : ' · no se pudo leer LightData'}
      </div>
      {tablaFalta && (
        <div style={{ fontSize: 12, color: C.amarillo, marginTop: 6 }}>Falta correr la migración de control de colectas: no se pueden guardar vínculos ni marcas.</div>
      )}
      {faltan.map(it => <Fila key={it.clienteId} it={it} cuentasLD={cuentasLD} onMarcar={onMarcar} onVincular={onVincular} />)}
      {faltan.length === 0 && <div style={{ fontSize: 12, color: C.verde, marginTop: 10, fontWeight: 600 }}>✓ Se colectó todo</div>}
      {hechas.length > 0 && (
        <>
          <button onClick={() => setVerColectadas(v => !v)} aria-expanded={verColectadas}
            style={{ marginTop: 10, padding: '6px 0', background: 'transparent', border: 'none', color: C.verde, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ display: 'inline-block', transform: verColectadas ? 'rotate(180deg)' : 'none', fontSize: 11 }}>▼</span>
            {verColectadas ? 'Ocultar colectadas' : `Ver las ${hechas.length} colectadas`}
          </button>
          {verColectadas && hechas.map(it => <Fila key={it.clienteId} it={it} cuentasLD={cuentasLD} onMarcar={onMarcar} onVincular={onVincular} />)}
        </>
      )}
    </div>
  );
}
