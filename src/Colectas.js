import React, { useState, useEffect, useRef, useCallback } from 'react';

const SUPABASE_URL = "https://svlagoosmxxcsbevkrhy.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2bGFnb29zbXh4Y3NiZXZrcmh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMTE1ODMsImV4cCI6MjA5NDg4NzU4M30.h0cyc0TI8yEZSny-udR2-5tzihd5jvJRTiFEbkCnVng";

const BRAND = {
  navy:    "#0d1b2a",
  navyMid: "#112236",
  navyCard:"#162d42",
  navySide:"#0a1520",
  teal:    "#2ECFAA",
  white:   "#FFFFFF",
  muted:   "rgba(255,255,255,0.45)",
  faint:   "rgba(255,255,255,0.06)",
  border:  "rgba(255,255,255,0.09)",
};

const SECCIONES = ['CABA', 'SUR', 'NOROESTE', 'SABADOS'];
const DEFAULT_CHOFERES = ['Alric','Capra','Cepero','Vaccaro','Dani Vargas','Gonzalo','Maxi','Renzo','Cris','Pedro'];

async function sbFetch(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "return=representation",
      ...options.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : [];
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMonto(n) {
  return n ? '$' + Number(n).toLocaleString('es-AR') : '—';
}

function getWeekRange(fechaStr) {
  const d = new Date(fechaStr + 'T12:00:00');
  const day = d.getDay();
  const mon = new Date(d);
  mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const sat = new Date(mon);
  sat.setDate(mon.getDate() + 5);
  const fmt = dt => dt.toISOString().slice(0, 10);
  const fmtD = dt => `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}`;
  return { start: fmt(mon), end: fmt(sat), label: `${fmtD(mon)} – ${fmtD(sat)}` };
}

const thSt = {
  padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
  color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em',
  borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap',
};

export default function Colectas() {
  const [navView, setNavView] = useState('colectas'); // 'colectas' | 'pagos' | 'clientes' | 'choferes'
  const [tab, setTab] = useState('CABA');
  const [fecha, setFecha] = useState(todayStr);
  const [clientes, setClientes] = useState([]);
  const [registros, setRegistros] = useState({});
  const [saveStatus, setSaveStatus] = useState('saved');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Pagos
  const [semanaFecha, setSemanaFecha] = useState(todayStr);
  const [pagosData, setPagosData] = useState([]);
  const [loadingPagos, setLoadingPagos] = useState(false);

  // Clientes ABM
  const emptyForm = { nombre:'', direccion:'', zona_barrio:'', seccion:'CABA', hora_habitual:'', monto:'', activo:true };
  const [clienteForm, setClienteForm] = useState(emptyForm);
  const [editId, setEditId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [clienteFiltroSec, setClienteFiltroSec] = useState('todos');

  // Choferes list
  const [choferesList, setChoferesList] = useState(() => {
    try { const s = localStorage.getItem('flexit_choferes'); return s ? JSON.parse(s) : DEFAULT_CHOFERES; }
    catch { return DEFAULT_CHOFERES; }
  });

  const saveTimer = useRef(null);
  const registrosRef = useRef({});
  const pendingSavesRef = useRef(new Map());

  useEffect(() => { registrosRef.current = registros; }, [registros]);

  useEffect(() => {
    try { localStorage.setItem('flexit_choferes', JSON.stringify(choferesList)); } catch {}
  }, [choferesList]);

  // Load clients
  useEffect(() => {
    sbFetch('colectas_clientes?select=*&order=seccion.asc,nombre.asc')
      .then(setClientes)
      .catch(e => setError('Error cargando clientes: ' + e.message));
  }, []);

  // Load records for date
  useEffect(() => {
    if (!fecha) return;
    setLoading(true);
    setRegistros({});
    sbFetch(`colectas_registros?select=*&fecha=eq.${fecha}`)
      .then(rows => {
        const map = {};
        rows.forEach(r => {
          map[r.cliente_id] = {
            id: r.id,
            choferes: r.choferes?.length ? r.choferes : ['A coordinar'],
            confirmado: r.confirmado || false,
          };
        });
        setRegistros(map);
      })
      .catch(e => setError('Error cargando registros: ' + e.message))
      .finally(() => setLoading(false));
  }, [fecha]);

  // Flush pending saves
  const flushSaves = useCallback(async () => {
    const saves = [...pendingSavesRef.current.entries()];
    if (!saves.length) return;
    pendingSavesRef.current.clear();
    try {
      for (const [clienteId, data] of saves) {
        const existing = registrosRef.current[clienteId];
        if (existing?.id) {
          await sbFetch(`colectas_registros?id=eq.${existing.id}`, {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ choferes: data.choferes, confirmado: data.confirmado }),
          });
        } else {
          const result = await sbFetch('colectas_registros', {
            method: 'POST',
            body: JSON.stringify({ fecha, cliente_id: clienteId, choferes: data.choferes, confirmado: data.confirmado }),
          });
          const row = Array.isArray(result) ? result[0] : result;
          if (row?.id) {
            setRegistros(prev => ({ ...prev, [clienteId]: { ...prev[clienteId], id: row.id } }));
          }
        }
      }
      setSaveStatus('saved');
    } catch(e) {
      setSaveStatus('error');
      console.error('Save error:', e);
    }
  }, [fecha]);

  const updateRegistro = useCallback((clienteId, updates) => {
    setRegistros(prev => {
      const current = prev[clienteId] || { choferes: ['A coordinar'], confirmado: false };
      const next = { ...current, ...updates };
      pendingSavesRef.current.set(clienteId, next);
      setSaveStatus('saving');
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushSaves, 700);
      return { ...prev, [clienteId]: next };
    });
  }, [flushSaves]);

  // Pagos — se carga cuando navView === 'pagos'
  useEffect(() => {
    if (navView !== 'pagos') return;
    setLoadingPagos(true);
    const { start, end } = getWeekRange(semanaFecha);
    sbFetch(`colectas_registros?select=*,colectas_clientes(nombre,monto)&fecha=gte.${start}&fecha=lte.${end}`)
      .then(regs => {
        const map = {};
        regs.forEach(r => {
          const monto = Number(r.colectas_clientes?.monto || 0);
          (r.choferes || []).forEach(ch => {
            if (!ch || ch === 'A coordinar') return;
            if (!map[ch]) map[ch] = { cadete: ch, total: 0, confirmadas: 0, monto: 0 };
            map[ch].total++;
            if (r.confirmado) { map[ch].confirmadas++; map[ch].monto += monto; }
          });
        });
        setPagosData(Object.values(map).sort((a, b) => b.monto - a.monto));
      })
      .catch(e => setError(e.message))
      .finally(() => setLoadingPagos(false));
  }, [navView, semanaFecha]);

  // Save cliente
  const saveCliente = async () => {
    const payload = {
      ...clienteForm,
      hora_habitual: clienteForm.hora_habitual !== '' ? Number(clienteForm.hora_habitual) : null,
      monto: clienteForm.monto !== '' ? Number(clienteForm.monto) : null,
    };
    try {
      if (editId) {
        await sbFetch(`colectas_clientes?id=eq.${editId}`, {
          method: 'PATCH', headers: { 'Prefer':'return=minimal' }, body: JSON.stringify(payload),
        });
      } else {
        await sbFetch('colectas_clientes', { method: 'POST', body: JSON.stringify(payload) });
      }
      const updated = await sbFetch('colectas_clientes?select=*&order=seccion.asc,nombre.asc');
      setClientes(updated);
      setShowForm(false);
      setEditId(null);
      setClienteForm(emptyForm);
    } catch(e) { setError('Error: ' + e.message); }
  };

  const editCliente = c => {
    setEditId(c.id);
    setClienteForm({ nombre:c.nombre, direccion:c.direccion, zona_barrio:c.zona_barrio||'', seccion:c.seccion, hora_habitual:c.hora_habitual??'', monto:c.monto??'', activo:c.activo });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleActivo = async c => {
    await sbFetch(`colectas_clientes?id=eq.${c.id}`, {
      method:'PATCH', headers:{'Prefer':'return=minimal'}, body: JSON.stringify({ activo: !c.activo }),
    });
    setClientes(prev => prev.map(x => x.id === c.id ? { ...x, activo: !x.activo } : x));
  };

  // Helpers
  const seccionClientes = clientes.filter(c => c.seccion === tab && c.activo);

  function getGroups(list) {
    const groups = {}, order = [];
    list.forEach(c => {
      const reg = registros[c.id];
      const chs = reg?.choferes?.length ? reg.choferes : ['A coordinar'];
      chs.forEach(ch => {
        if (!groups[ch]) { groups[ch] = []; order.push(ch); }
        if (!groups[ch].find(x => x.id === c.id)) groups[ch].push(c);
      });
    });
    const uniq = [...new Set(order)];
    return { groups, order: ['A coordinar', ...uniq.filter(c => c !== 'A coordinar')].filter(c => groups[c]) };
  }

  function buildMsg(chofer) {
    const rows = seccionClientes.filter(c => registros[c.id]?.choferes?.includes(chofer));
    const d = new Date(fecha + 'T12:00:00');
    const fechaFmt = d.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'numeric' });
    let msg = `🚚 *Colectas ${tab} – ${fechaFmt}*\n\n`;
    rows.forEach(c => {
      msg += `• ${c.nombre} – ${c.direccion}`;
      if (c.hora_habitual) msg += ` (${c.hora_habitual}hs)`;
      msg += '\n';
    });
    msg += '\n✅ Confirmá cuando llegues a cada local.';
    return msg;
  }

  const inpSt = {
    padding:'7px 10px', fontSize:12, border:`1px solid ${BRAND.border}`,
    borderRadius:8, background:BRAND.faint, color:BRAND.white, outline:'none',
  };

  // ── ZONA RENDER ──
  function renderZona() {
    if (loading) return <div style={{ color:BRAND.muted, padding:'3rem', textAlign:'center' }}>Cargando...</div>;

    if (!seccionClientes.length) return (
      <div style={{ color:BRAND.muted, padding:'3rem', textAlign:'center' }}>
        <div style={{ fontSize:32, marginBottom:8 }}>📦</div>
        <div>No hay clientes activos en {tab}.</div>
        <button onClick={() => setNavView('clientes')}
          style={{ marginTop:12, padding:'6px 16px', borderRadius:8, border:`1px solid ${BRAND.teal}`, background:'transparent', color:BRAND.teal, cursor:'pointer', fontSize:13 }}>
          Ir a Clientes →
        </button>
      </div>
    );

    const { groups, order } = getGroups(seccionClientes);
    const sinAsignar = groups['A coordinar']?.length || 0;

    return (
      <>
        {/* Toolbar */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:BRAND.muted }}>
            <span>📅</span>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              style={{ ...inpSt, padding:'5px 10px' }} />
          </div>
          {sinAsignar > 0 && (
            <div style={{ padding:'3px 12px', borderRadius:20, background:'rgba(251,191,36,0.12)', border:'1px solid rgba(251,191,36,0.3)', color:'#FBBF24', fontSize:12, fontWeight:600 }}>
              ⚠️ {sinAsignar} sin asignar
            </div>
          )}
          <div style={{ marginLeft:'auto', fontSize:12, color: saveStatus==='error'?'#E24B4A':saveStatus==='saving'?BRAND.muted:'#2ECFAA' }}>
            {saveStatus==='saving' && '💾 Guardando...'}
            {saveStatus==='saved'  && '✓ Guardado'}
            {saveStatus==='error'  && '✗ Error al guardar'}
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX:'auto', borderRadius:10, border:`1px solid ${BRAND.border}` }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:580 }}>
            <thead>
              <tr style={{ background:BRAND.navyMid }}>
                {['','Cliente','Chofer(es)','Dirección','Zona','$$$'].map((h,i) => (
                  <th key={i} style={{ ...thSt, width:i===0?36:undefined }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {order.map(chofer => {
                const isWarn = chofer === 'A coordinar';
                const rows = groups[chofer];
                return (
                  <React.Fragment key={chofer}>
                    {/* Group header */}
                    <tr style={{ background: isWarn ? 'rgba(251,191,36,0.06)' : 'rgba(255,255,255,0.02)' }}>
                      <td colSpan={6} style={{ padding:'6px 12px', borderBottom:`1px solid ${BRAND.border}` }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                          <span style={{ fontSize:12, fontWeight:600, color:isWarn?'#FBBF24':BRAND.muted }}>
                            {isWarn ? '⚠️' : '👤'} {chofer}{' '}
                            <span style={{ fontWeight:400, opacity:0.6 }}>({rows.length})</span>
                          </span>
                          {!isWarn && (
                            <button
                              onClick={() => window.open('https://wa.me/?text='+encodeURIComponent(buildMsg(chofer)),'_blank')}
                              style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:6, border:'1px solid #25D366', color:'#25D366', background:'transparent', fontSize:11, fontWeight:600, cursor:'pointer' }}>
                              📱 {chofer}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Data rows */}
                    {rows.map(c => {
                      const reg = registros[c.id] || { choferes:['A coordinar'], confirmado:false };
                      const chs = reg.choferes?.length ? reg.choferes : ['A coordinar'];
                      const confirmed = reg.confirmado;
                      const unassigned = chs.every(x => x === 'A coordinar');
                      return (
                        <tr key={c.id} style={{ background: confirmed?'rgba(46,207,170,0.05)':unassigned?'rgba(251,191,36,0.03)':BRAND.navy, borderBottom:`1px solid ${BRAND.border}` }}>
                          {/* Confirm */}
                          <td style={{ padding:'8px 12px', width:36 }}>
                            <button onClick={() => updateRegistro(c.id, { confirmado:!confirmed })}
                              style={{ width:24, height:24, borderRadius:'50%', border:`2px solid ${confirmed?'#2ECFAA':'rgba(255,255,255,0.2)'}`, background:confirmed?'#2ECFAA':'transparent', cursor:'pointer', color:'#0d1b2a', fontWeight:700, fontSize:13, display:'flex', alignItems:'center', justifyContent:'center' }}>
                              {confirmed ? '✓' : ''}
                            </button>
                          </td>
                          {/* Nombre */}
                          <td style={{ padding:'8px 12px', fontWeight:500, fontSize:13 }}>
                            {c.nombre}
                            {chs.length > 1 && (
                              <span style={{ marginLeft:6, fontSize:10, padding:'1px 6px', borderRadius:10, background:'rgba(251,191,36,0.15)', color:'#FBBF24' }}>dividida</span>
                            )}
                          </td>
                          {/* Choferes */}
                          <td style={{ padding:'8px 12px', minWidth:140 }}>
                            <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                              {chs.map((ch, i) => (
                                <div key={i} style={{ display:'flex', alignItems:'center', gap:3 }}>
                                  <select
                                    value={ch}
                                    onChange={e => { const n=[...chs]; n[i]=e.target.value; updateRegistro(c.id,{choferes:n}); }}
                                    style={{ ...inpSt, padding:'3px 7px', fontSize:11, border:`1px solid ${ch==='A coordinar'?'rgba(251,191,36,0.4)':BRAND.border}`, background:ch==='A coordinar'?'rgba(251,191,36,0.08)':BRAND.faint, color:ch==='A coordinar'?'#FBBF24':BRAND.white }}>
                                    <option value="A coordinar">A coordinar</option>
                                    {choferesList.map(x => <option key={x} value={x}>{x}</option>)}
                                  </select>
                                  {chs.length > 1 && (
                                    <button onClick={() => updateRegistro(c.id,{choferes:chs.filter((_,j)=>j!==i)})} style={{ background:'none', border:'none', color:BRAND.muted, cursor:'pointer', fontSize:13, padding:'0 2px' }}>✕</button>
                                  )}
                                </div>
                              ))}
                              <button onClick={() => updateRegistro(c.id,{choferes:[...chs,'A coordinar']})}
                                style={{ width:20, height:20, borderRadius:'50%', border:`1px solid ${BRAND.border}`, background:'none', color:BRAND.muted, cursor:'pointer', fontSize:15, display:'flex', alignItems:'center', justifyContent:'center', alignSelf:'flex-start' }}>
                                +
                              </button>
                            </div>
                          </td>
                          {/* Dirección */}
                          <td style={{ padding:'8px 12px', fontSize:12, color:BRAND.muted, maxWidth:180, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {c.direccion}
                          </td>
                          {/* Zona */}
                          <td style={{ padding:'8px 12px' }}>
                            {c.zona_barrio && (
                              <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:'rgba(58,143,212,0.15)', color:'#3A8FD4' }}>
                                {c.zona_barrio}
                              </span>
                            )}
                          </td>
                          {/* Monto */}
                          <td style={{ padding:'8px 12px', fontWeight:500, fontSize:13, whiteSpace:'nowrap' }}>
                            {fmtMonto(c.monto)}
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  // ── PAGOS RENDER ──
  function renderPagos() {
    const { label } = getWeekRange(semanaFecha);
    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20, flexWrap:'wrap' }}>
          <span style={{ fontSize:13, color:BRAND.muted }}>Semana:</span>
          <input type="date" value={semanaFecha} onChange={e => setSemanaFecha(e.target.value)}
            style={{ ...inpSt, padding:'5px 10px' }} />
          <span style={{ fontSize:13, color:BRAND.teal, fontWeight:600 }}>{label}</span>
        </div>

        {loadingPagos && <div style={{ color:BRAND.muted, padding:'2rem', textAlign:'center' }}>Calculando...</div>}
        {!loadingPagos && pagosData.length === 0 && (
          <div style={{ color:BRAND.muted, padding:'3rem', textAlign:'center' }}>
            <div style={{ fontSize:32, marginBottom:8 }}>💰</div>
            Sin colectas confirmadas para esta semana.
          </div>
        )}

        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {pagosData.map(p => (
            <div key={p.cadete} style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:12, padding:'1rem 1.25rem' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:700 }}>{p.cadete}</div>
                  <div style={{ fontSize:12, color:BRAND.muted, marginTop:2 }}>{label}</div>
                </div>
                <div style={{ fontSize:22, fontWeight:700, color:BRAND.teal }}>{fmtMonto(p.monto)}</div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                {[
                  ['Asignadas', p.total, BRAND.white],
                  ['Confirmadas', p.confirmadas, '#2ECFAA'],
                  ['Promedio', p.confirmadas ? fmtMonto(Math.round(p.monto/p.confirmadas)) : '—', BRAND.white],
                ].map(([lbl, val, color]) => (
                  <div key={lbl} style={{ background:BRAND.navyMid, borderRadius:8, padding:'10px', textAlign:'center' }}>
                    <div style={{ fontSize:11, color:BRAND.muted, marginBottom:4 }}>{lbl}</div>
                    <div style={{ fontSize:18, fontWeight:700, color }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── CLIENTES RENDER ──
  function renderClientes() {
    const filtrados = clienteFiltroSec === 'todos' ? clientes : clientes.filter(c => c.seccion === clienteFiltroSec);

    const tabBtn = active => ({
      padding:'4px 12px', fontSize:12, fontWeight:600, borderRadius:20, cursor:'pointer',
      border:`1px solid ${active?BRAND.teal:BRAND.border}`,
      background:active?'rgba(46,207,170,0.12)':BRAND.faint,
      color:active?BRAND.teal:BRAND.muted,
    });

    return (
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16, flexWrap:'wrap' }}>
          <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
            {['todos', ...SECCIONES].map(s => (
              <button key={s} onClick={() => setClienteFiltroSec(s)} style={tabBtn(clienteFiltroSec===s)}>
                {s === 'todos' ? 'Todos' : s}
              </button>
            ))}
          </div>
          <button onClick={() => { setShowForm(true); setEditId(null); setClienteForm(emptyForm); }}
            style={{ marginLeft:'auto', padding:'6px 14px', borderRadius:8, border:`1px solid ${BRAND.teal}`, background:'rgba(46,207,170,0.1)', color:BRAND.teal, fontSize:13, fontWeight:600, cursor:'pointer' }}>
            + Agregar cliente
          </button>
        </div>

        {showForm && (
          <div style={{ background:BRAND.navyCard, border:'1px solid rgba(46,207,170,0.3)', borderRadius:12, padding:'1.25rem', marginBottom:16 }}>
            <div style={{ fontSize:14, fontWeight:700, marginBottom:12 }}>{editId ? 'Editar cliente' : 'Nuevo cliente'}</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:10 }}>
              {[['nombre','Nombre','text'],['direccion','Dirección','text'],['zona_barrio','Zona/Barrio','text'],['hora_habitual','Hora habitual','number'],['monto','Monto ($)','number']].map(([key,lbl,type]) => (
                <div key={key}>
                  <div style={{ fontSize:11, color:BRAND.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>{lbl}</div>
                  <input type={type} value={clienteForm[key]} onChange={e => setClienteForm(p => ({...p,[key]:e.target.value}))}
                    style={{ ...inpSt, width:'100%' }} placeholder={lbl} />
                </div>
              ))}
              <div>
                <div style={{ fontSize:11, color:BRAND.muted, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.06em' }}>Sección</div>
                <select value={clienteForm.seccion} onChange={e => setClienteForm(p => ({...p,seccion:e.target.value}))}
                  style={{ ...inpSt, width:'100%' }}>
                  {SECCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:'flex', gap:8, marginTop:14 }}>
              <button onClick={saveCliente}
                style={{ padding:'7px 18px', borderRadius:8, border:'none', background:BRAND.teal, color:'#0d1b2a', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                {editId ? 'Guardar cambios' : 'Agregar'}
              </button>
              <button onClick={() => { setShowForm(false); setEditId(null); }}
                style={{ padding:'7px 14px', borderRadius:8, border:`1px solid ${BRAND.border}`, background:'none', color:BRAND.muted, fontSize:13, cursor:'pointer' }}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div style={{ overflowX:'auto', borderRadius:10, border:`1px solid ${BRAND.border}` }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:480 }}>
            <thead>
              <tr style={{ background:BRAND.navyMid }}>
                {['Cliente / Dirección','Sección','Zona','Monto','Estado',''].map((h,i) => (
                  <th key={i} style={thSt}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(c => (
                <tr key={c.id} style={{ background:BRAND.navy, borderBottom:`1px solid ${BRAND.border}` }}>
                  <td style={{ padding:'8px 12px' }}>
                    <div style={{ fontWeight:500, fontSize:13 }}>{c.nombre}</div>
                    <div style={{ fontSize:11, color:BRAND.muted, marginTop:2 }}>{c.direccion}</div>
                  </td>
                  <td style={{ padding:'8px 12px' }}>
                    <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:'rgba(58,143,212,0.15)', color:'#3A8FD4' }}>{c.seccion}</span>
                  </td>
                  <td style={{ padding:'8px 12px', fontSize:12, color:BRAND.muted }}>{c.zona_barrio||'—'}</td>
                  <td style={{ padding:'8px 12px', fontWeight:500, fontSize:13, whiteSpace:'nowrap' }}>{fmtMonto(c.monto)}</td>
                  <td style={{ padding:'8px 12px' }}>
                    <span style={{ fontSize:11, padding:'2px 8px', borderRadius:20, background:c.activo?'rgba(46,207,170,0.12)':'rgba(255,255,255,0.05)', color:c.activo?'#2ECFAA':BRAND.muted }}>
                      {c.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ padding:'8px 12px' }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={() => editCliente(c)}
                        style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${BRAND.border}`, background:'none', color:BRAND.muted, fontSize:11, cursor:'pointer' }}>
                        Editar
                      </button>
                      <button onClick={() => toggleActivo(c)}
                        style={{ padding:'3px 10px', borderRadius:6, border:`1px solid ${c.activo?'rgba(226,75,74,0.3)':'rgba(46,207,170,0.3)'}`, background:'none', color:c.activo?'#E24B4A':'#2ECFAA', fontSize:11, cursor:'pointer' }}>
                        {c.activo ? 'Desactivar' : 'Activar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtrados.length === 0 && (
                <tr><td colSpan={6} style={{ padding:'2rem', textAlign:'center', color:BRAND.muted }}>Sin clientes para este filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── CHOFERES RENDER ──
  function renderChoferes() {
    return (
      <div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>👤 Choferes disponibles</div>
          <div style={{ fontSize:13, color:BRAND.muted }}>
            Lista que aparece en el selector al asignar colectas.
          </div>
        </div>

        <div style={{ background:BRAND.navyCard, border:`1px solid ${BRAND.border}`, borderRadius:12, padding:'1.25rem', marginBottom:16 }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:14 }}>
            {choferesList.map(ch => (
              <div key={ch} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:20, background:BRAND.navyMid, border:`1px solid ${BRAND.border}`, fontSize:13 }}>
                <span>👤</span>
                <span>{ch}</span>
                <button onClick={() => setChoferesList(prev => prev.filter(x => x !== ch))}
                  style={{ background:'none', border:'none', color:BRAND.muted, cursor:'pointer', fontSize:14, padding:'0 0 0 4px', lineHeight:1, display:'flex', alignItems:'center' }}>✕</button>
              </div>
            ))}
            {choferesList.length === 0 && (
              <div style={{ color:BRAND.muted, fontSize:13 }}>No hay choferes cargados.</div>
            )}
          </div>

          <form onSubmit={e => {
            e.preventDefault();
            const name = e.target.chofer.value.trim();
            if (name && !choferesList.includes(name)) setChoferesList(prev => [...prev, name]);
            e.target.chofer.value = '';
          }} style={{ display:'flex', gap:8 }}>
            <input name="chofer" placeholder="Nombre del chofer..." style={{ ...inpSt, padding:'7px 12px', flex:1, maxWidth:240 }} />
            <button type="submit"
              style={{ padding:'7px 16px', borderRadius:8, border:`1px solid ${BRAND.teal}`, background:'rgba(46,207,170,0.1)', color:BRAND.teal, cursor:'pointer', fontSize:13, fontWeight:600 }}>
              + Agregar
            </button>
          </form>
        </div>

        <div style={{ fontSize:12, color:BRAND.muted, padding:'10px 14px', background:'rgba(255,255,255,0.03)', borderRadius:8, border:`1px solid ${BRAND.border}` }}>
          💡 Los choferes se guardan en este dispositivo. Si cambiás de computadora, tenés que cargarlos de nuevo.
        </div>
      </div>
    );
  }

  // ── SIDEBAR CONFIG ──
  const sidebarItems = [
    { section: 'OPERACIÓN', items: [
      { id: 'colectas', icon: '📦', label: 'Colectas' },
      { id: 'pagos',    icon: '💰', label: 'Pagos' },
    ]},
    { section: 'CONFIG', items: [
      { id: 'clientes', icon: '📋', label: 'Clientes' },
      { id: 'choferes', icon: '👤', label: 'Choferes' },
    ]},
  ];

  // Zone tabs (solo cuando navView === 'colectas')
  const zoneTabs = (
    <div style={{ display:'flex', gap:0, marginBottom:20, borderBottom:`1px solid ${BRAND.border}` }}>
      {SECCIONES.map(s => {
        const active = tab === s;
        return (
          <button key={s} onClick={() => setTab(s)} style={{
            padding:'8px 18px', fontSize:13, fontWeight:600, cursor:'pointer', border:'none',
            background:'transparent', color: active ? BRAND.teal : BRAND.muted,
            borderBottom: active ? `2px solid ${BRAND.teal}` : '2px solid transparent',
            marginBottom:-1, transition:'color 0.15s',
          }}>
            {s}
          </button>
        );
      })}
    </div>
  );

  const viewTitles = {
    colectas: 'Colectas',
    pagos: 'Pagos a cadetes',
    clientes: 'Clientes',
    choferes: 'Choferes',
  };

  // ── MAIN RENDER ──
  return (
    <div style={{ display:'flex', gap:0, minHeight:'60vh', borderRadius:14, overflow:'hidden', border:`1px solid ${BRAND.border}` }}>

      {/* SIDEBAR */}
      <div style={{
        width:152, flexShrink:0, background:BRAND.navySide,
        borderRight:`1px solid ${BRAND.border}`,
        padding:'18px 0',
        display:'flex', flexDirection:'column', gap:0,
      }}>
        {sidebarItems.map(group => (
          <div key={group.section} style={{ marginBottom:8 }}>
            <div style={{
              fontSize:10, fontWeight:700, letterSpacing:'0.1em',
              color:'rgba(255,255,255,0.22)', padding:'0 14px 6px',
              textTransform:'uppercase',
            }}>
              {group.section}
            </div>
            {group.items.map(item => {
              const active = navView === item.id;
              return (
                <button key={item.id} onClick={() => setNavView(item.id)} style={{
                  display:'flex', alignItems:'center', gap:8,
                  width:'100%', padding:'8px 14px', border:'none', cursor:'pointer',
                  background: active ? 'rgba(46,207,170,0.1)' : 'transparent',
                  color: active ? BRAND.teal : BRAND.muted,
                  fontSize:13, fontWeight: active ? 600 : 400,
                  borderLeft: active ? `2px solid ${BRAND.teal}` : '2px solid transparent',
                  textAlign:'left', transition:'all 0.15s',
                }}>
                  <span style={{ fontSize:14 }}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex:1, padding:'20px 24px', background:BRAND.navy, minWidth:0 }}>
        <div style={{ fontSize:16, fontWeight:700, letterSpacing:'-0.01em', marginBottom:16, color:BRAND.white }}>
          {viewTitles[navView]}
        </div>

        {error && (
          <div style={{ background:'rgba(226,75,74,0.15)', color:'#E24B4A', border:'1px solid rgba(226,75,74,0.3)', padding:'10px 14px', borderRadius:8, fontSize:13, marginBottom:'1rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            {error}
            <button onClick={() => setError('')} style={{ background:'none', border:'none', color:'#E24B4A', cursor:'pointer', fontSize:16 }}>✕</button>
          </div>
        )}

        {navView === 'colectas' && <>{zoneTabs}{renderZona()}</>}
        {navView === 'pagos'    && renderPagos()}
        {navView === 'clientes' && renderClientes()}
        {navView === 'choferes' && renderChoferes()}
      </div>
    </div>
  );
}
