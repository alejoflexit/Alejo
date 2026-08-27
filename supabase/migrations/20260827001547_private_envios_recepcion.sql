create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.envios_recepcion (
  id_interno text primary key,
  recibido_por text not null,
  actualizado_en timestamptz not null default now()
);

alter table private.envios_recepcion enable row level security;
revoke all on table private.envios_recepcion from public, anon, authenticated;

create or replace function public.upsert_envios_recepcion(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into private.envios_recepcion (id_interno, recibido_por, actualizado_en)
  select trim(row_data.id_interno), trim(row_data.recibido_por), now()
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
    as row_data(id_interno text, recibido_por text)
  where trim(coalesce(row_data.id_interno, '')) <> ''
    and trim(coalesce(row_data.recibido_por, '')) <> ''
  on conflict (id_interno) do update
    set recibido_por = excluded.recibido_por,
        actualizado_en = excluded.actualizado_en;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

create or replace function public.get_envios_recepcion(p_ids text[])
returns table (id_interno text, recibido_por text)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select receipt.id_interno, receipt.recibido_por
  from private.envios_recepcion as receipt
  where receipt.id_interno = any(coalesce(p_ids, array[]::text[]));
end;
$$;

revoke all on function public.upsert_envios_recepcion(jsonb) from public, anon, authenticated;
revoke all on function public.get_envios_recepcion(text[]) from public, anon, authenticated;
grant execute on function public.upsert_envios_recepcion(jsonb) to service_role;
grant execute on function public.get_envios_recepcion(text[]) to service_role;

comment on table private.envios_recepcion is
  'Datos completos de recepción. Solo accesibles mediante RPC restringidas a service_role.';
