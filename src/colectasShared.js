// Piezas compartidas entre la tabla de Colectas (Colectas.js) y la vista Mapa (ColectasMapa.js).
// Viven acá para no duplicarlas en copias que después divergen.
import React, { useState, useEffect, useRef } from 'react';

export const BRAND = {
  navy:    "#0d1b2a",
  navyMid: "#112236",
  navyCard:"#162d42",
  navySide:"#0a1520",
  teal:    "#2ECFAA",
  white:   "#FFFFFF",
  muted:   "rgba(255,255,255,0.62)",
  faint:   "rgba(255,255,255,0.06)",
  border:  "rgba(255,255,255,0.09)",
};

// Vehículo que necesita la colecta de ese cliente — atributo FIJO del cliente (como el horario).
// NULL = sin definir: no se muestra emoji en la tabla y el pin del mapa cae al genérico 📦.
export const VEHICULOS = {
  moto:   { emoji: '🏍️', label: 'Moto' },
  auto:   { emoji: '🚗', label: 'Auto' },
  kangoo: { emoji: '🚐', label: 'Kangoo' },
};

// Normaliza nombres de LightData para matchear (doble espacio, tildes, mayúsculas)
export function normNombre(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Estado efectivo de un cliente en un día: los fijos sin estado cuentan como amarillo.
export function estadoEfectivo(cliente, reg) {
  return (cliente.fija && (!reg?.estado || reg.estado === 'blanco')) ? 'amarillo' : (reg?.estado || 'blanco');
}

// ── CHOFER PICKER ──
export function ChoferPicker({ chs, choferesList, onUpdate, hideChips }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editIdx, setEditIdx] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const all = ['A coordinar', ...choferesList];
  const filtered = query ? all.filter(c => c.toLowerCase().includes(query.toLowerCase())) : all;

  const assign = ch => {
    let next;
    if (editIdx !== null) {
      next = [...chs]; next[editIdx] = ch;
    } else {
      const base = chs.filter(x => x !== 'A coordinar');
      next = [...base, ch];
      if (!next.length) next = ['A coordinar'];
    }
    onUpdate({ choferes: next });
    setOpen(false); setQuery(''); setEditIdx(null);
  };

  const remove = (i, e) => {
    e.stopPropagation();
    const next = chs.filter((_, j) => j !== i);
    onUpdate({ choferes: next.length ? next : ['A coordinar'] });
  };

  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 150 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {!hideChips && chs.map((ch, i) => {
          const warn = ch === 'A coordinar';
          return (
            <div key={i} onClick={() => { setEditIdx(i); setQuery(''); setOpen(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 20, border: `1px solid ${warn ? '#FBBF24' : '#2ECFAA'}`, background: warn ? '#FBBF24' : '#2ECFAA', fontSize: 11, fontWeight: 700, color: '#14171c', cursor: 'pointer', userSelect: 'none' }}>
              {ch}
              {chs.length > 1 && (
                <span onClick={e => remove(i, e)} style={{ color: 'rgba(0,0,0,0.45)', fontSize: 12, lineHeight: 1 }}>✕</span>
              )}
            </div>
          );
        })}
        <button onClick={() => { setEditIdx(null); setQuery(''); setOpen(true); }}
          style={{ width: 20, height: 20, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)', background: 'none', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>+</button>
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 300, width: 210, background: '#162d42', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.55)' }}>
          <div style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>🔍</span>
            <input autoFocus value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Buscar chofer..."
              onKeyDown={e => {
                if (e.key === 'Escape') { setOpen(false); setQuery(''); }
                if (e.key === 'Enter' && filtered.length > 0) assign(filtered[0]);
              }}
              style={{ border: 'none', background: 'transparent', color: '#fff', fontSize: 12, outline: 'none', width: '100%' }} />
          </div>
          <div style={{ maxHeight: 185, overflowY: 'auto' }}>
            {!chs.every(x => x === 'A coordinar') && (
              <div onClick={() => { onUpdate({ choferes: ['A coordinar'], estado: 'blanco', confirmado_por: [] }); setOpen(false); setQuery(''); }}
                style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: '#E24B4A', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 6 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(226,75,74,0.08)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                × Desasignar
              </div>
            )}
            {filtered.slice(0, 12).map(ch => (
              <div key={ch} onClick={() => assign(ch)}
                style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', color: ch === 'A coordinar' ? '#FBBF24' : '#fff' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                {ch}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>Sin resultados</div>
            )}
            {filtered.length > 12 && (
              <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>Seguí escribiendo para filtrar...</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
