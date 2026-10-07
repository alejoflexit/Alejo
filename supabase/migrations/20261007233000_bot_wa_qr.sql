-- QR del bot de WhatsApp accesible desde la app (2026-10-07)
-- El guardián del VPS (vps/flexit-openwa-guardian.sh) reporta el estado de la sesión de OpenWA y,
-- cuando WhatsApp pide QR, lo publica cada ~15 s. Solo admin@flexit.app puede leer el QR (da acceso
-- completo al WhatsApp del bot). Solo el VPS puede publicar: se valida contra el hash de una clave
-- que vive únicamente en /root/flexit/bot-wa.key (evita que alguien suba un QR falso).

create table if not exists public.bot_secreto (
  id int primary key default 1 check (id = 1),
  clave_hash text not null
);
alter table public.bot_secreto enable row level security; -- sin políticas: nadie lo lee por la API
insert into public.bot_secreto (id, clave_hash)
values (1, '820cf630f9f7099e5c4bd313c591deb43c15d5eb14b0c4c3be455262520b462f')
on conflict (id) do update set clave_hash = excluded.clave_hash;

alter table public.bot_salud
  add column if not exists wa_estado text,
  add column if not exists wa_estado_at timestamptz;

create table if not exists public.bot_qr (
  id int primary key default 1 check (id = 1),
  qr text,
  qr_at timestamptz
);
insert into public.bot_qr (id) values (1) on conflict (id) do nothing;
alter table public.bot_qr enable row level security;
drop policy if exists bot_qr_admin on public.bot_qr;
create policy bot_qr_admin on public.bot_qr for select to authenticated
  using ((auth.jwt() ->> 'email') = 'admin@flexit.app');

-- Lo llama el guardián del VPS con la clave anónima + su clave privada
create or replace function public.bot_wa_reportar(p_clave text, p_estado text, p_qr text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
begin
  if p_clave is null or not exists (select 1 from bot_secreto
      where id = 1 and clave_hash = encode(sha256(convert_to(p_clave, 'UTF8')), 'hex')) then
    return json_build_object('ok', false);
  end if;
  update bot_salud set wa_estado = left(p_estado, 40), wa_estado_at = now() where id = 1;
  if p_qr is not null and length(p_qr) between 10 and 20000 then
    update bot_qr set qr = p_qr, qr_at = now() where id = 1;
  elsif p_estado in ('ready', 'connected', 'authenticated') then
    update bot_qr set qr = null, qr_at = null where id = 1;
  end if;
  return json_build_object('ok', true);
end $$;
revoke all on function public.bot_wa_reportar(text, text, text) from public;
grant execute on function public.bot_wa_reportar(text, text, text) to anon, authenticated;

-- Estado para la app (todos): ahora incluye si WhatsApp pide QR
create or replace function public.colecta_bot_estado()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'ultimo_sync', s.ultimo_sync,
    'ultimo_envio', s.ultimo_envio,
    'ok', s.ultimo_sync is not null and s.ultimo_sync >= now() - interval '40 minutes'
          and not coalesce(q.qr is not null and q.qr_at >= now() - interval '2 minutes', false),
    'aviso', case when s.ultimo_aviso_at >= (ar_now()::date::timestamp at time zone 'America/Argentina/Buenos_Aires')
                  then s.ultimo_aviso end,
    'feriado', (select nombre from feriados where fecha = ar_now()::date),
    'wa_estado', s.wa_estado,
    'wa_estado_at', s.wa_estado_at,
    'pide_qr', coalesce(q.qr is not null and q.qr_at >= now() - interval '2 minutes', false))
  from bot_salud s cross join bot_qr q where s.id = 1 and q.id = 1
$$;
revoke all on function public.colecta_bot_estado() from public, anon;
grant execute on function public.colecta_bot_estado() to authenticated;
