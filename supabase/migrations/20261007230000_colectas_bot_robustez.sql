-- Bot de colectas: robustez (2026-10-07)
-- 1) Señal de vida: cada corrida del "Sync grupos" de n8n (cada 15 min) toca agente_config.
--    Si el sync no corre hace más de 40 min, el bot está caído: a las 9 no se encola (los mensajes
--    se perderían) y queda un aviso visible en Colectas. Reintenta 9:30, 10:00 y 10:30.
-- 2) Grupo compartido por varios clientes → el mensaje nombra al cliente.
-- 3) Los casos del bot se resuelven solos al enviarse (no ensucian la tiquetera).
-- 4) Feriados nacionales: ese día no se manda.

-- ── 1) Señal de vida ──
create table if not exists public.bot_salud (
  id int primary key default 1 check (id = 1),
  ultimo_sync timestamptz,
  ultimo_envio timestamptz,
  ultimo_aviso text,
  ultimo_aviso_at timestamptz
);
insert into public.bot_salud (id, ultimo_sync) values (1, now()) on conflict (id) do nothing;
alter table public.bot_salud enable row level security;
drop policy if exists bot_salud_lectura on public.bot_salud;
create policy bot_salud_lectura on public.bot_salud for select to authenticated using (true);

-- El sync de n8n hace un upsert sobre agente_config con su key de servicio. Los cambios que hace
-- el equipo desde la app (rol authenticated) no cuentan como señal de vida.
create or replace function public.trg_bot_salud_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'authenticated' then
    update bot_salud set ultimo_sync = now() where id = 1;
  end if;
  return null;
end $$;
drop trigger if exists bot_salud_sync on public.agente_config;
create trigger bot_salud_sync after insert or update on public.agente_config
  for each statement execute function public.trg_bot_salud_sync();

-- ── 3) Casos del bot: se resuelven solos al salir ──
create or replace function public.trg_caso_bot_autoresolver() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.autor = 'Bot colectas' and new.estado = 'esperando_cliente' then
    new.estado := 'resuelto';
    new.resuelto_at := now();
    new.resuelto_por := 'Bot colectas';
    update bot_salud set ultimo_envio = now() where id = 1;
  end if;
  return new;
end $$;
drop trigger if exists caso_bot_autoresolver on public.casos;
create trigger caso_bot_autoresolver before update of estado on public.casos
  for each row execute function public.trg_caso_bot_autoresolver();

-- ── 4) Feriados nacionales (días de semana; los de fin de semana no hacen falta) ──
create table if not exists public.feriados (
  fecha date primary key,
  nombre text not null
);
alter table public.feriados enable row level security;
drop policy if exists feriados_lectura on public.feriados;
create policy feriados_lectura on public.feriados for select to authenticated using (true);
insert into public.feriados (fecha, nombre) values
  ('2026-10-12', 'Día del Respeto a la Diversidad Cultural'),
  ('2026-11-23', 'Día de la Soberanía Nacional (trasladado)'),
  ('2026-12-08', 'Inmaculada Concepción de María'),
  ('2026-12-25', 'Navidad'),
  ('2027-01-01', 'Año Nuevo'),
  ('2027-02-08', 'Carnaval'),
  ('2027-02-09', 'Carnaval'),
  ('2027-03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-04-02', 'Día del Veterano y de los Caídos en Malvinas'),
  ('2027-05-25', 'Día de la Revolución de Mayo'),
  ('2027-06-21', 'Paso a la Inmortalidad de Güemes (trasladado, a confirmar)'),
  ('2027-07-09', 'Día de la Independencia'),
  ('2027-08-16', 'Paso a la Inmortalidad de San Martín (trasladado, a confirmar)'),
  ('2027-10-11', 'Diversidad Cultural (trasladado, a confirmar)'),
  ('2027-12-08', 'Inmaculada Concepción de María')
on conflict (fecha) do nothing;

-- ── Encolar (reemplaza la versión del 06/10) ──
create or replace function public.colecta_bot_encolar(p_solo_chat text default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  c record; i int := 0; hoy date := ar_now()::date; inicio timestamptz := now(); msg text;
  s record; compartido boolean;
  base text := 'https://flota-logistica-iota.vercel.app/colecta.html?t=';
  saludos text[] := array[
    '¡Buen día! 👋 ¿Tienen colecta hoy? Confirmalo con un toque acá 👉 ',
    'Hola, buen día! ¿Hay colecta hoy? Respondé desde este link 👉 ',
    '¡Buenas! ¿Pasamos hoy a retirar? Confirmá acá, es un toque 👉 '];
begin
  if p_solo_chat is null then
    if extract(isodow from ar_now()) > 5 then return 0; end if;
    if exists (select 1 from feriados where fecha = hoy) then return 0; end if;
    -- bot sin señal: no encolar (se perderían) y dejar el aviso para el equipo
    select * into s from bot_salud where id = 1;
    if s.ultimo_sync is null or s.ultimo_sync < now() - interval '40 minutes' then
      update bot_salud set
        ultimo_aviso = 'Hoy el bot no mandó los links: WhatsApp sin señal desde '
          || coalesce(to_char(s.ultimo_sync at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), 'nunca')
          || '. Preguntá a mano o avisale a Alejo.',
        ultimo_aviso_at = now()
       where id = 1;
      return 0;
    end if;
  end if;

  for c in
    select cl.* from colectas_clientes cl
      join agente_config g on g.tipo = 'grupo' and g.chat_id = cl.chat_id
     where cl.activo and cl.bot_habilitado and not coalesce(cl.fija, false)
       and g.estado in ('activo','solo_envio') and g.envio_habilitado
       and (p_solo_chat is null or cl.chat_id = p_solo_chat)
       and not exists (select 1 from colectas_registros r where r.cliente_id = cl.id and r.fecha = hoy
                        and coalesce(r.estado, 'blanco') <> 'blanco')
       and not exists (select 1 from casos k where k.autor = 'Bot colectas' and k.chat_id = cl.chat_id
                        and k.created_at >= (hoy::timestamp at time zone 'America/Argentina/Buenos_Aires')
                        and k.mensaje like '%' || cl.id::text || '%')
     order by cl.nombre
  loop
    compartido := (select count(*) from colectas_clientes x
                    where x.chat_id = c.chat_id and x.activo and x.bot_habilitado and not coalesce(x.fija, false)) > 1;
    if compartido then
      msg := '¡Buen día! 👋 ¿Tienen colecta hoy en *' || c.nombre || '*? Confirmalo acá 👉 ' || base || c.bot_token;
    else
      msg := saludos[1 + (i % 3)] || base || c.bot_token;
    end if;
    insert into casos (grupo, chat_id, autor, mensaje, tipo, estado, respuesta_enviada, enviado_via, enviado_por, enviado_at, enviar_desde)
    values (c.nombre, c.chat_id, 'Bot colectas', '(aviso automático) Link de colecta a ' || c.nombre || ' [' || c.id || ']',
            'colecta', 'enviando', msg, 'colectas-bot', 'Bot 9:00', now(), inicio + make_interval(secs => i * 20));
    i := i + 1;
  end loop;

  -- si salió bien, el aviso de un día anterior ya no aplica
  if p_solo_chat is null and i > 0 then
    update bot_salud set ultimo_aviso = null, ultimo_aviso_at = null
     where id = 1 and ultimo_aviso_at < (hoy::timestamp at time zone 'America/Argentina/Buenos_Aires');
  end if;
  return i;
end $$;
revoke all on function public.colecta_bot_encolar(text) from public, anon, authenticated;

-- 9:00 y reintentos 9:30 / 10:00 / 10:30 (el dedupe por día evita mandar dos veces)
select cron.unschedule('colectas_bot_9am') where exists (select 1 from cron.job where jobname = 'colectas_bot_9am');
select cron.schedule('colectas_bot_9am', '0,30 12-13 * * 1-5', $$select public.colecta_bot_encolar()$$);

-- ── Estado para la app ──
create or replace function public.colecta_bot_estado()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'ultimo_sync', s.ultimo_sync,
    'ultimo_envio', s.ultimo_envio,
    'ok', s.ultimo_sync is not null and s.ultimo_sync >= now() - interval '40 minutes',
    'aviso', case when s.ultimo_aviso_at >= (ar_now()::date::timestamp at time zone 'America/Argentina/Buenos_Aires')
                  then s.ultimo_aviso end,
    'feriado', (select nombre from feriados where fecha = ar_now()::date))
  from bot_salud s where s.id = 1
$$;
revoke all on function public.colecta_bot_estado() from public, anon;
grant execute on function public.colecta_bot_estado() to authenticated;

-- Limpieza: los casos del bot que ya salieron quedan resueltos
update public.casos set estado = 'resuelto', resuelto_at = coalesce(resuelto_at, now()), resuelto_por = coalesce(resuelto_por, 'Bot colectas')
 where autor = 'Bot colectas' and estado = 'esperando_cliente';
