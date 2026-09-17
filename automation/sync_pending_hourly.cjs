// Run with TZ=America/Argentina/Buenos_Aires and the existing sync credentials.
// Serial, bounded exports; never deletes historical records.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
process.env.TZ = 'America/Argentina/Buenos_Aires';
const dateKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const parse = value => {
  const match = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  const key = match ? `${match[3]}-${match[2]}-${match[1]}` : String(value || '').slice(0,10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) && Number.isFinite(Date.parse(key)) ? key : null;
};
async function main() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_KEY;
  if (!url || !key) throw Error('Missing existing Supabase environment');
  const today = new Date(); const start = new Date(today); start.setDate(start.getDate()-13);
  const oldDates = new Set(); let missingDates=0;
  for(let offset=0;;offset+=1000) {
    const res=await fetch(`${url}/rest/v1/envios_busqueda?select=id_interno,estado,fecha_flexit&order=id_interno&limit=1000&offset=${offset}`, {headers:{apikey:key,Authorization:`Bearer ${key}`}});
    if(!res.ok) throw Error(`Historical pending read failed: ${res.status}`);
    const rows=await res.json();
    for(const row of rows) {
      if(/^(entregado|devuelto al cliente)/i.test(String(row.estado||'').trim())) continue;
      const date=parse(row.fecha_flexit);
      if(!date) missingDates++;
      else if(date<dateKey(start)) oldDates.add(date);
    }
    if(rows.length<1000)break;
  }
  if(missingDates) throw Error(`${missingDates} pending records have no usable origin date; full refresh cannot be guaranteed`);
  const windows=[];
  // Recent exports split in two seven-day windows to avoid LightData large-range failures.
  for(let day=new Date(start);day<=today;) {
    const end=new Date(day);end.setDate(end.getDate()+6);
    if(end>today)end.setTime(today.getTime());
    windows.push([dateKey(day),dateKey(end)]);day=new Date(end);day.setDate(day.getDate()+1);
  }
  for(const date of [...oldDates].sort()) windows.push([date,date]);
  const began=Date.now();
  for(const [from,to] of windows) {
    const remaining=45*60000-(Date.now()-began);
    if(remaining<=0)throw Error('45 minute budget exceeded; remaining historic windows not refreshed');
    const format=s=>s.split('-').reverse().join('/');
    const run=spawnSync(process.execPath,[path.join(__dirname,'sync_envios_agente.js')],{stdio:'inherit',timeout:Math.min(remaining,10*60000),env:{...process.env,SYNC_FROM:format(from),SYNC_TO:format(to),BACKFILL_DETAILS:'false',BACKFILL_RECEIPTS:'false'}});
    if(run.error || run.status!==0)throw Error(`Refresh failed for ${from} to ${to}`);
  }
  console.log(`Hourly refresh completed: ${windows.length} windows; ${new Date().toISOString()}`);
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
