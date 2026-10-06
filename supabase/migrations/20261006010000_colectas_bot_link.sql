-- Bot de confirmación de colectas por link (piloto CABA, 2026-10-06)
-- Cada cliente tiene un link fijo (bot_token). A las 9:00 (lun-vie) el bot manda el link a su grupo.
-- El cliente toca "Sí hay" / "Hoy no" y queda en colectas_registros (amarillo / rojo).
-- Seguridad: la página pública solo llama a dos funciones que validan el token; no hay acceso a tablas.

-- 1) Config por cliente
alter table public.colectas_clientes
  add column if not exists bot_habilitado boolean not null default false,
  add column if not exists bot_token text not null default encode(gen_random_bytes(12), 'hex');
create unique index if not exists colectas_clientes_bot_token_key on public.colectas_clientes(bot_token);

-- 2) Respuesta del cliente en el registro del día
alter table public.colectas_registros
  add column if not exists link_respuesta text check (link_respuesta in ('si','no')),
  add column if not exists link_at timestamptz,
  add column if not exists link_bultos text;

-- 3) Grupo "solo envío": el bot puede mandar ahí, pero el agente no lee ni crea casos
--    (el filtro de n8n solo procesa estado='activo').
alter table public.agente_config drop constraint if exists agente_config_estado_check;
alter table public.agente_config add constraint agente_config_estado_check
  check (estado = any (array['pendiente','activo','inactivo','solo_envio']));

-- 4) Envío escalonado: un caso no sale antes de enviar_desde (evita ráfagas → ban de WhatsApp)
alter table public.casos add column if not exists enviar_desde timestamptz;

create or replace view public.casos_enviables as
 select c.id, c.chat_id, c.respuesta_enviada
   from casos c
   join agente_config g on g.tipo = 'grupo' and g.chat_id = c.chat_id
  where c.estado = 'enviando'
    and g.estado in ('activo','solo_envio')
    and g.envio_habilitado
    and (c.enviar_desde is null or c.enviar_desde <= now());

-- 5) Helpers de hora Argentina
create or replace function public.ar_now() returns timestamp
language sql stable as $$ select (now() at time zone 'America/Argentina/Buenos_Aires') $$;

-- 6) Lo que ve la página pública
create or replace function public.colecta_link_info(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  c record; r record; hoy date := ar_now()::date; ahora timestamp := ar_now();
  dow int := extract(isodow from ar_now()); abierto boolean; motivo text := null;
  dias text[] := array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  if p_token is null or length(p_token) < 16 then return json_build_object('ok', false, 'motivo', 'link_invalido'); end if;
  select * into c from colectas_clientes where bot_token = p_token and activo;
  if not found then return json_build_object('ok', false, 'motivo', 'link_invalido'); end if;
  select * into r from colectas_registros where cliente_id = c.id and fecha = hoy order by created_at limit 1;
  abierto := c.bot_habilitado and dow <= 5 and ahora::time < time '11:30';
  if not c.bot_habilitado then motivo := 'deshabilitado';
  elsif dow > 5 then motivo := 'fin_de_semana';
  elsif ahora::time >= time '11:30' then motivo := 'cerrado'; end if;
  return json_build_object(
    'ok', true,
    'nombre', c.nombre,
    'fecha', hoy,
    'fecha_label', dias[dow] || ' ' || extract(day from hoy)::int || ' de ' || meses[extract(month from hoy)::int],
    'abierto', abierto,
    'motivo', motivo,
    'respuesta', r.link_respuesta,
    'bultos', r.link_bultos
  );
end $$;

-- 7) El cliente responde
create or replace function public.colecta_link_responder(p_token text, p_respuesta text, p_bultos text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  c record; r record; hoy date := ar_now()::date; info json; nuevo_estado text; prev_chs text[];
  link_manda boolean;
begin
  if p_respuesta not in ('si','no') then return json_build_object('ok', false, 'motivo', 'respuesta_invalida'); end if;
  if p_bultos is not null and p_bultos not in ('1-10','11-30','31-60','+60') then p_bultos := null; end if;
  info := colecta_link_info(p_token);
  if not (info->>'ok')::boolean then return info; end if;
  if not (info->>'abierto')::boolean then return info; end if;

  select * into c from colectas_clientes where bot_token = p_token;
  nuevo_estado := case when p_respuesta = 'si' then 'amarillo' else 'rojo' end;

  perform pg_advisory_xact_lock(hashtext('colecta_link_' || c.id::text || hoy::text));
  select * into r from colectas_registros where cliente_id = c.id and fecha = hoy order by created_at limit 1;

  if not found then
    -- mismo precargado que hace la pantalla: los choferes del último día hábil con datos
    select choferes into prev_chs from colectas_registros
     where cliente_id = c.id and fecha < hoy and extract(isodow from fecha) < 6
       and choferes is not null and array_length(choferes, 1) > 0
     order by fecha desc limit 1;
    insert into colectas_registros (fecha, cliente_id, choferes, estado, confirmado_por, monto, direccion, zona_barrio,
                                    link_respuesta, link_at, link_bultos)
    values (hoy, c.id, coalesce(prev_chs, array['A coordinar']), nuevo_estado, '[]'::jsonb, c.monto, c.direccion, c.zona_barrio,
            p_respuesta, now(), case when p_respuesta = 'si' then p_bultos end);
  else
    -- El link solo pisa el estado si nadie del equipo lo tocó antes (blanco) o si lo había puesto el mismo link.
    -- Verde (colecta hecha) o un estado puesto a mano por el equipo nunca se pisan: queda la respuesta anotada al costado.
    link_manda := coalesce(r.estado, 'blanco') = 'blanco'
      or (r.link_respuesta is not null and r.estado = case when r.link_respuesta = 'si' then 'amarillo' else 'rojo' end);
    update colectas_registros set
      link_respuesta = p_respuesta,
      link_at = now(),
      link_bultos = case when p_respuesta = 'si' then coalesce(p_bultos, case when r.link_respuesta = 'si' then r.link_bultos end) end,
      estado = case when link_manda then nuevo_estado else estado end,
      confirmado_por = case when link_manda and nuevo_estado = 'rojo' then '[]'::jsonb else confirmado_por end
    where id = r.id;
  end if;
  return colecta_link_info(p_token);
end $$;

revoke all on function public.colecta_link_info(text) from public;
revoke all on function public.colecta_link_responder(text, text, text) from public;
grant execute on function public.colecta_link_info(text) to anon, authenticated;
grant execute on function public.colecta_link_responder(text, text, text) to anon, authenticated;

-- 8) El equipo configura el bot de un cliente (prender/apagar + grupo). Toca agente_config,
--    que el equipo no puede escribir directo: por eso va por función, y solo pasa grupos a 'solo_envio'.
create or replace function public.colecta_bot_configurar(p_cliente uuid, p_habilitado boolean, p_chat_id text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  c record; g record; chat text := nullif(trim(coalesce(p_chat_id, '')), ''); aviso text := null; viejo text;
begin
  select * into c from colectas_clientes where id = p_cliente;
  if not found then return json_build_object('ok', false, 'aviso', 'Cliente no encontrado'); end if;
  if p_habilitado and c.fija then return json_build_object('ok', false, 'aviso', 'Es un cliente fijo: no se le pregunta'); end if;
  if p_habilitado and chat is null then return json_build_object('ok', false, 'aviso', 'Primero elegí el grupo de WhatsApp'); end if;
  viejo := c.chat_id;

  update colectas_clientes set bot_habilitado = p_habilitado, chat_id = chat where id = p_cliente;

  -- grupo nuevo: habilitar solo envío (si estaba mudo). Un grupo 'activo' o 'inactivo' lo maneja Alejo desde la tiquetera.
  if p_habilitado then
    select * into g from agente_config where tipo = 'grupo' and chat_id = chat;
    if not found then
      aviso := 'El bot todavía no aparece en ese grupo';
    elsif g.estado in ('pendiente','solo_envio') then
      update agente_config set estado = 'solo_envio', envio_habilitado = true, actualizado_at = now() where id = g.id;
    elsif g.estado = 'inactivo' then
      aviso := 'Ese grupo está pausado en la tiquetera: el link no se va a mandar';
    elsif not g.envio_habilitado then
      aviso := 'Ese grupo tiene el envío apagado en la tiquetera: el link no se va a mandar';
    end if;
  end if;

  -- grupo que quedó sin uso: vuelve a mudo
  for g in select * from agente_config where tipo = 'grupo' and estado = 'solo_envio'
             and chat_id in (viejo, chat) loop
    if not exists (select 1 from colectas_clientes where chat_id = g.chat_id and bot_habilitado and activo) then
      update agente_config set estado = 'pendiente', envio_habilitado = false, actualizado_at = now() where id = g.id;
    end if;
  end loop;

  return json_build_object('ok', true, 'aviso', aviso);
end $$;

revoke all on function public.colecta_bot_configurar(uuid, boolean, text) from public, anon;
grant execute on function public.colecta_bot_configurar(uuid, boolean, text) to authenticated;

-- 9) Encolar los mensajes de las 9 (lo corre pg_cron). Un mensaje cada 20 s.
create or replace function public.colecta_bot_encolar(p_solo_chat text default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  c record; i int := 0; hoy date := ar_now()::date; inicio timestamptz := now(); msg text;
  base text := 'https://flota-logistica-iota.vercel.app/colecta.html?t=';
  saludos text[] := array[
    '¡Buen día! 👋 ¿Tienen colecta hoy? Confirmalo con un toque acá 👉 ',
    'Hola, buen día! ¿Hay colecta hoy? Respondé desde este link 👉 ',
    '¡Buenas! ¿Pasamos hoy a retirar? Confirmá acá, es un toque 👉 '];
begin
  if p_solo_chat is null and extract(isodow from ar_now()) > 5 then return 0; end if;
  for c in
    select cl.* from colectas_clientes cl
      join agente_config g on g.tipo = 'grupo' and g.chat_id = cl.chat_id
     where cl.activo and cl.bot_habilitado and not coalesce(cl.fija, false)
       and g.estado in ('activo','solo_envio') and g.envio_habilitado
       and (p_solo_chat is null or cl.chat_id = p_solo_chat)
       -- si el equipo ya lo resolvió hoy, no preguntar
       and not exists (select 1 from colectas_registros r where r.cliente_id = cl.id and r.fecha = hoy
                        and coalesce(r.estado, 'blanco') <> 'blanco')
       -- un solo link por cliente por día
       and not exists (select 1 from casos k where k.autor = 'Bot colectas' and k.chat_id = cl.chat_id
                        and k.created_at >= (hoy::timestamp at time zone 'America/Argentina/Buenos_Aires')
                        and k.mensaje like '%' || cl.id::text || '%')
     order by cl.nombre
  loop
    msg := saludos[1 + (i % 3)] || base || c.bot_token;
    insert into casos (grupo, chat_id, autor, mensaje, tipo, estado, respuesta_enviada, enviado_via, enviado_por, enviado_at, enviar_desde)
    values (c.nombre, c.chat_id, 'Bot colectas', '(aviso automático) Link de colecta a ' || c.nombre || ' [' || c.id || ']',
            'colecta', 'enviando', msg, 'colectas-bot', 'Bot 9:00', now(), inicio + make_interval(secs => i * 20));
    i := i + 1;
  end loop;
  return i;
end $$;

revoke all on function public.colecta_bot_encolar(text) from public, anon, authenticated;

-- 10) Todos los días hábiles a las 9:00 de Argentina (12:00 UTC)
select cron.unschedule('colectas_bot_9am') where exists (select 1 from cron.job where jobname = 'colectas_bot_9am');
select cron.schedule('colectas_bot_9am', '0 12 * * 1-5', $$select public.colecta_bot_encolar()$$);
