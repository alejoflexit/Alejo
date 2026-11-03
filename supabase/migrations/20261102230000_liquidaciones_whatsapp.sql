-- Mensajes de liquidación por WhatsApp desde el número de Alejo (2026-11-02)
--
-- Flujo: en Liquidaciones › Semana, Alejo abre "Enviar por WhatsApp", revisa la tanda (texto por
-- cadete, número), pone OK → liq_wa_encolar() deja una fila por cadete en liq_envios, escalonadas
-- 25–60 s al azar. El worker del VPS (vps/flexit-liq-wa.sh, cron cada minuto) enciende la sesión
-- OpenWA vinculada al WhatsApp PERSONAL de Alejo, toma de a una (liq_wa_tomar) y reporta
-- (liq_wa_resultado). Al salir bien, la fila de Liquidaciones queda "✓ Avisado" (pagos_avisos).
--
-- Reglas que hay que conservar:
--  * Nada se manda solo: solo lo que Alejo encola con OK. No hay pg_cron que encole.
--  * Un mensaje por cadete por semana. Lo enviado no se reenvía; lo que falló se puede reintentar.
--  * Si un envío queda "enviando" > 5 min (no sabemos si salió), pasa a error y NO se reintenta solo
--    (misma lección que el bot de colectas: reintentar a ciegas duplica).
--  * Ventana 8:00–21:00 AR y tope de 150 por día (antispam: OpenWA no es API oficial).
--  * El worker se autentica con la misma clave que el guardián del bot (/root/flexit/bot-wa.key,
--    hash en bot_secreto). La app solo con admin@flexit.app.

-- 1) Número de WhatsApp de cada cadete (chat id de WhatsApp: 549XXXXXXXXXX@c.us)
alter table public.cadetes_tarifas add column if not exists whatsapp text;

-- 2) Cola de envíos
create table if not exists public.liq_envios (
  id bigint generated always as identity primary key,
  semana_label text not null,           -- lunes de la semana liquidada (YYYY-MM-DD), igual que pagos_avisos
  cadete text not null,                 -- nombre como en Liquidaciones (pagos_avisos.cadete)
  chat_id text not null,
  texto text not null,
  estado text not null default 'en_cola' check (estado in ('en_cola', 'enviando', 'enviado', 'error', 'cancelado')),
  enviar_desde timestamptz not null default now(),
  tomado_at timestamptz,
  enviado_at timestamptz,
  error text,
  creado_por text,
  created_at timestamptz not null default now()
);
create index if not exists liq_envios_cola on public.liq_envios (estado, enviar_desde);
create index if not exists liq_envios_semana on public.liq_envios (semana_label);
-- un solo mensaje vivo/enviado por cadete y semana
create unique index if not exists liq_envios_uno_por_semana on public.liq_envios (semana_label, cadete)
  where estado in ('en_cola', 'enviando', 'enviado');

alter table public.liq_envios enable row level security;
drop policy if exists liq_envios_admin on public.liq_envios;
create policy liq_envios_admin on public.liq_envios for select to authenticated
  using ((auth.jwt() ->> 'email') = 'admin@flexit.app');

-- 3) Estado de la sesión personal (singleton) — el QR da acceso a TU WhatsApp: solo admin lo lee
create table if not exists public.liq_wa_salud (
  id int primary key default 1 check (id = 1),
  estado text,
  estado_at timestamptz,
  qr text,
  qr_at timestamptz,
  encender_hasta timestamptz,           -- la app pide "conectá" hasta esta hora (vincular / mandar)
  contactos_at timestamptz,
  ultimo_error text
);
insert into public.liq_wa_salud (id) values (1) on conflict (id) do nothing;
alter table public.liq_wa_salud enable row level security;
drop policy if exists liq_wa_salud_admin on public.liq_wa_salud;
create policy liq_wa_salud_admin on public.liq_wa_salud for select to authenticated
  using ((auth.jwt() ->> 'email') = 'admin@flexit.app');

-- 4) Contactos de tu WhatsApp (solo nombre + número) para sugerir el número de cada cadete
create table if not exists public.liq_wa_contactos (
  chat_id text primary key,
  nombre text,
  actualizado timestamptz not null default now()
);
alter table public.liq_wa_contactos enable row level security;
drop policy if exists liq_wa_contactos_admin on public.liq_wa_contactos;
create policy liq_wa_contactos_admin on public.liq_wa_contactos for select to authenticated
  using ((auth.jwt() ->> 'email') = 'admin@flexit.app');

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.liq_wa_es_admin() returns boolean
language sql stable as $$ select coalesce(auth.jwt() ->> 'email', '') = 'admin@flexit.app' $$;

create or replace function public.liq_wa_clave_ok(p_clave text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_clave is not null and exists (select 1 from bot_secreto
    where id = 1 and clave_hash = encode(sha256(convert_to(p_clave, 'UTF8')), 'hex'))
$$;
revoke all on function public.liq_wa_clave_ok(text) from public, anon, authenticated;

-- ───────────────────────── App (admin) ─────────────────────────

-- Encolar la tanda. p_items = [{cadete, chat_id, texto}]. Devuelve cuántos encoló y a quién salteó.
create or replace function public.liq_wa_encolar(p_semana text, p_items json)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  it json; base timestamptz; t timestamptz; ult timestamptz; n int := 0; salteados json[] := '{}';
  v_cadete text; v_chat text; v_texto text;
begin
  if not liq_wa_es_admin() then raise exception 'solo admin'; end if;
  if p_semana !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'semana inválida'; end if;
  if json_array_length(p_items) > 150 then raise exception 'máximo 150 mensajes por tanda'; end if;

  select greatest(now() + interval '5 seconds', coalesce(max(enviar_desde), now()))
    into base from liq_envios where estado = 'en_cola';
  t := base;

  for it in select * from json_array_elements(p_items) loop
    v_cadete := trim(it ->> 'cadete'); v_chat := trim(it ->> 'chat_id'); v_texto := it ->> 'texto';
    if v_cadete is null or v_cadete = '' or v_texto is null or length(trim(v_texto)) = 0 or length(v_texto) > 2000 then
      salteados := salteados || json_build_object('cadete', v_cadete, 'motivo', 'datos incompletos'); continue;
    end if;
    if v_chat is null or v_chat !~ '^549\d{10}@c\.us$' then
      salteados := salteados || json_build_object('cadete', v_cadete, 'motivo', 'número inválido'); continue;
    end if;
    if exists (select 1 from liq_envios where semana_label = p_semana and cadete = v_cadete
               and estado in ('en_cola', 'enviando', 'enviado')) then
      salteados := salteados || json_build_object('cadete', v_cadete, 'motivo', 'ya enviado o en cola'); continue;
    end if;
    insert into liq_envios (semana_label, cadete, chat_id, texto, enviar_desde, creado_por)
    values (p_semana, v_cadete, v_chat, v_texto, t, auth.jwt() ->> 'email');
    n := n + 1; ult := t;
    t := t + make_interval(secs => 25 + floor(random() * 36)::int);   -- 25–60 s entre mensajes
  end loop;

  if n > 0 then
    update liq_wa_salud set encender_hasta = greatest(coalesce(encender_hasta, now()), now() + interval '20 minutes') where id = 1;
  end if;
  return json_build_object('encolados', n, 'salteados', to_json(salteados), 'termina_aprox', ult);
end $$;
revoke all on function public.liq_wa_encolar(text, json) from public, anon;
grant execute on function public.liq_wa_encolar(text, json) to authenticated;

-- Frenar lo que falta mandar (todo, o solo de una semana)
create or replace function public.liq_wa_cancelar(p_semana text default null)
returns int language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not liq_wa_es_admin() then raise exception 'solo admin'; end if;
  update liq_envios set estado = 'cancelado'
   where estado = 'en_cola' and (p_semana is null or semana_label = p_semana);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.liq_wa_cancelar(text) from public, anon;
grant execute on function public.liq_wa_cancelar(text) to authenticated;

-- Pedirle al VPS que encienda la sesión (para escanear el QR o actualizar contactos)
create or replace function public.liq_wa_encender(p_minutos int default 15)
returns json language plpgsql volatile security definer set search_path = public as $$
begin
  if not liq_wa_es_admin() then raise exception 'solo admin'; end if;
  update liq_wa_salud set encender_hasta = now() + make_interval(mins => least(greatest(p_minutos, 1), 30)),
                          contactos_at = null   -- fuerza a re-leer contactos al conectar
   where id = 1;
  return json_build_object('ok', true);
end $$;
revoke all on function public.liq_wa_encender(int) from public, anon;
grant execute on function public.liq_wa_encender(int) to authenticated;

-- ───────────────────────── Worker del VPS (clave) ─────────────────────────

-- ¿Qué tiene que hacer el worker? (sin efectos)
create or replace function public.liq_wa_plan(p_clave text)
returns json language plpgsql stable security definer set search_path = public as $$
declare s record;
begin
  if not liq_wa_clave_ok(p_clave) then return json_build_object('ok', false); end if;
  select * into s from liq_wa_salud where id = 1;
  return json_build_object('ok', true,
    'encender', coalesce(s.encender_hasta > now(), false)
                or exists (select 1 from liq_envios where estado in ('en_cola', 'enviando')),
    'contactos', s.contactos_at is null or s.contactos_at < now() - interval '6 hours');
end $$;
revoke all on function public.liq_wa_plan(text) from public;
grant execute on function public.liq_wa_plan(text) to anon, authenticated;

-- Tomar el próximo mensaje que ya puede salir (o nada)
create or replace function public.liq_wa_tomar(p_clave text)
returns json language plpgsql volatile security definer set search_path = public as $$
declare r record; hora int := extract(hour from ar_now());
begin
  if not liq_wa_clave_ok(p_clave) then return json_build_object('ok', false); end if;
  -- lo que quedó colgado "enviando": no sabemos si salió → error, sin reintento automático
  update liq_envios set estado = 'error', error = 'sin confirmación del envío (revisá en el celu si llegó)'
   where estado = 'enviando' and tomado_at < now() - interval '5 minutes';
  if hora < 8 or hora >= 21 then return json_build_object('ok', true, 'motivo', 'fuera de horario'); end if;
  if (select count(*) from liq_envios where estado = 'enviado'
        and enviado_at >= (ar_now()::date::timestamp at time zone 'America/Argentina/Buenos_Aires')) >= 150 then
    return json_build_object('ok', true, 'motivo', 'tope diario');
  end if;
  if exists (select 1 from liq_envios where estado = 'enviando') then
    return json_build_object('ok', true, 'motivo', 'hay uno en curso');
  end if;
  select * into r from liq_envios where estado = 'en_cola' and enviar_desde <= now()
   order by enviar_desde, id limit 1 for update skip locked;
  if not found then return json_build_object('ok', true); end if;
  update liq_envios set estado = 'enviando', tomado_at = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'chat_id', r.chat_id, 'texto', r.texto);
end $$;
revoke all on function public.liq_wa_tomar(text) from public;
grant execute on function public.liq_wa_tomar(text) to anon, authenticated;

-- Resultado de un envío. OK → marca "Avisado" en Liquidaciones.
create or replace function public.liq_wa_resultado(p_clave text, p_id bigint, p_ok boolean, p_error text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare r record;
begin
  if not liq_wa_clave_ok(p_clave) then return json_build_object('ok', false); end if;
  select * into r from liq_envios where id = p_id and estado = 'enviando';
  if not found then return json_build_object('ok', false, 'motivo', 'no está enviando'); end if;
  if p_ok then
    update liq_envios set estado = 'enviado', enviado_at = now(), error = null where id = p_id;
    if not exists (select 1 from pagos_avisos where semana_label = r.semana_label and cadete = r.cadete) then
      insert into pagos_avisos (semana_label, cadete) values (r.semana_label, r.cadete);
    end if;
  else
    update liq_envios set estado = 'error', error = left(coalesce(p_error, 'falló el envío'), 300) where id = p_id;
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.liq_wa_resultado(text, bigint, boolean, text) from public;
grant execute on function public.liq_wa_resultado(text, bigint, boolean, text) to anon, authenticated;

-- Estado de la sesión + QR (cuando WhatsApp pide vincular)
create or replace function public.liq_wa_reportar(p_clave text, p_estado text, p_qr text default null, p_error text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
begin
  if not liq_wa_clave_ok(p_clave) then return json_build_object('ok', false); end if;
  update liq_wa_salud set estado = left(p_estado, 40), estado_at = now(),
         ultimo_error = coalesce(left(p_error, 300), ultimo_error) where id = 1;
  if p_qr is not null and length(p_qr) between 10 and 20000 then
    update liq_wa_salud set qr = p_qr, qr_at = now() where id = 1;
  elsif p_estado in ('ready', 'connected', 'authenticated', 'stopped') then
    update liq_wa_salud set qr = null, qr_at = null where id = 1;
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.liq_wa_reportar(text, text, text, text) from public;
grant execute on function public.liq_wa_reportar(text, text, text, text) to anon, authenticated;

-- Contactos (reemplaza la lista entera). p_items = [{chat_id, nombre}]
create or replace function public.liq_wa_contactos_subir(p_clave text, p_items json)
returns json language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if not liq_wa_clave_ok(p_clave) then return json_build_object('ok', false); end if;
  delete from liq_wa_contactos where true;
  insert into liq_wa_contactos (chat_id, nombre)
  select distinct on (x ->> 'chat_id') x ->> 'chat_id', left(x ->> 'nombre', 120)
    from json_array_elements(p_items) x
   where (x ->> 'chat_id') ~ '^\d{8,15}@c\.us$' and coalesce(x ->> 'nombre', '') <> '';
  get diagnostics n = row_count;
  update liq_wa_salud set contactos_at = now() where id = 1;
  return json_build_object('ok', true, 'contactos', n);
end $$;
revoke all on function public.liq_wa_contactos_subir(text, json) from public;
grant execute on function public.liq_wa_contactos_subir(text, json) to anon, authenticated;
