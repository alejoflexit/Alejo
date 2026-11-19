-- Facturas por link: cada cadete sube su factura desde un link propio (2026-11-19)
--
-- Flujo (decisión de Alejo 18-19/11):
--  1. Cada cadete que factura tiene un link fijo: /factura.html?t=<cadetes_tarifas.factura_token>
--     (código al azar, no el nombre). Se genera desde Liquidaciones › Config. Sin token = sin link.
--  2. Mientras Alejo no confirma la liquidación de ese cadete, el link dice "en revisión".
--  3. Alejo confirma de a uno (botón Confirmar de Liquidaciones, ya existente: pagos_cierres.estado
--     = 'confirmado' congela el total). Desde ese momento el link muestra el monto.
--  4. El cadete sube la factura (PDF o foto). La página lee del PDF tipo, número, monto y CUIT.
--     Si es PDF y el neto (facturas + notas de débito − notas de crédito) coincide con el monto
--     → factura_ok = true solo y aparece en "Listos para pagar". Si no coincide, es foto, o el
--     CUIT no es el del cadete → queda subida pero "a revisar" (Alejo la marca a mano).
--  5. Si después de eso cambia el total (descuento, extraviado) el "mandó factura" puesto por el
--     link se cae solo y el link le pide la diferencia (nota de débito o de crédito).
--
-- Reglas que hay que conservar:
--  * La página pública NO lee ni escribe tablas: solo las funciones factura_link_* (security definer),
--    que validan el token. El único permiso anónimo directo es SUBIR (insert) al bucket privado
--    'facturas' dentro de link/<token válido>/; no puede leer, listar, pisar ni borrar nada.
--  * Lo pagado no se toca: con el cierre pagado el link no acepta ni borra comprobantes.
--  * El link nunca desmarca un "mandó factura" puesto a mano por Alejo/Adrián (factura_link = false).

-- 1) Token por cadete
alter table public.cadetes_tarifas add column if not exists factura_token text;
create unique index if not exists cadetes_tarifas_factura_token on public.cadetes_tarifas (factura_token)
  where factura_token is not null;
do $$ begin
  alter table public.cadetes_tarifas add constraint cadetes_tarifas_factura_token_fmt
    check (factura_token is null or factura_token ~ '^[A-Za-z0-9_-]{20,64}$');
exception when duplicate_object then null; end $$;

-- 2) Columnas en el cierre
alter table public.pagos_cierres add column if not exists factura_monto numeric;          -- neto leído de los comprobantes
alter table public.pagos_cierres add column if not exists factura_link boolean not null default false; -- factura_ok lo puso el link

-- 3) Comprobantes subidos por el link (factura, nota de débito, nota de crédito)
-- (el tipo de cierre_id copia el de pagos_cierres.id, sea bigint o uuid)
do $$
declare tp text;
begin
  select format_type(atttypid, atttypmod) into tp from pg_attribute
  where attrelid = 'public.pagos_cierres'::regclass and attname = 'id';
  execute format($f$
    create table if not exists public.facturas_comprobantes (
      id bigint generated always as identity primary key,
      cierre_id %s not null references public.pagos_cierres(id),
      semana_label text not null,
      cadete text not null,
      tipo text not null check (tipo in ('factura', 'nd', 'nc')),
      nro text,                      -- últimos 4 del comprobante
      monto numeric,                 -- importe total leído (o escrito por el cadete si es foto)
      monto_origen text not null default 'pdf' check (monto_origen in ('pdf', 'manual')),
      cuit text,                     -- CUIT del emisor leído del PDF (solo dígitos)
      archivo text not null unique,  -- path en el bucket 'facturas'
      observacion text,
      created_at timestamptz not null default now(),
      borrado_at timestamptz
    )$f$, tp);
end $$;
-- Datos fiscales completos (para cargarlo en Xubio igual que lo carga Adrián: C-00002-00000274)
alter table public.facturas_comprobantes add column if not exists letra text;          -- A / B / C
alter table public.facturas_comprobantes add column if not exists punto_venta text;    -- 5 dígitos
alter table public.facturas_comprobantes add column if not exists numero text;         -- 8 dígitos
alter table public.facturas_comprobantes add column if not exists fecha_emision date;
-- Carga en Xubio (botón "Cargar en Xubio" de Pagar, función xubio)
alter table public.facturas_comprobantes add column if not exists xubio_id bigint;     -- transaccionid en Xubio
alter table public.facturas_comprobantes add column if not exists xubio_at timestamptz;
alter table public.facturas_comprobantes add column if not exists xubio_por text;

create index if not exists facturas_comprobantes_cierre on public.facturas_comprobantes (cierre_id) where borrado_at is null;
alter table public.facturas_comprobantes enable row level security;
drop policy if exists facturas_comprobantes_leer on public.facturas_comprobantes;
create policy facturas_comprobantes_leer on public.facturas_comprobantes for select to authenticated using (true);

-- ───────────────────────── helpers ─────────────────────────
create or replace function public.factura_norm(p text) returns text
language sql immutable as $$
  select lower(regexp_replace(translate(trim(coalesce(p, '')), 'áéíóúÁÉÍÓÚäëïöüÄËÏÖÜñÑ', 'aeiouAEIOUaeiouAEIOUnN'), '\s+', ' ', 'g'))
$$;

-- Lo que tiene que facturar el cadete: el total, salvo pago dividido (se factura solo la parte
-- que sale por transferencia). Efectivo → 0 (no factura).
create or replace function public.factura_monto_esperado(p_total numeric, p_metodo text, p_pagos jsonb) returns numeric
language sql immutable as $$
  select case
    when coalesce(jsonb_typeof(p_pagos), '') = 'array'
         and (select count(*) from jsonb_array_elements(p_pagos) e where coalesce((e->>'monto')::numeric, 0) > 0) > 1
      then (select coalesce(sum((e->>'monto')::numeric), 0) from jsonb_array_elements(p_pagos) e
            where coalesce((e->>'monto')::numeric, 0) > 0 and coalesce(e->>'via', '') <> 'efectivo')
    when p_metodo = 'efectivo' then 0
    else coalesce(p_total, 0)
  end
$$;

create or replace function public.factura_link_tarifa(p_token text) returns public.cadetes_tarifas
language sql stable security definer set search_path = public as $$
  select t.* from cadetes_tarifas t
  where p_token is not null and p_token ~ '^[A-Za-z0-9_-]{20,64}$' and t.factura_token = p_token
  limit 1
$$;
revoke all on function public.factura_link_tarifa(text) from public, anon, authenticated;

-- usado por la política de storage: ¿la carpeta link/<token>/ corresponde a un link vivo?
create or replace function public.factura_link_token_ok(p_token text) returns boolean
language sql stable security definer set search_path = public as $$
  select (factura_link_tarifa(p_token)).id is not null
$$;
revoke all on function public.factura_link_token_ok(text) from public;
grant execute on function public.factura_link_token_ok(text) to anon, authenticated;

-- Neto de los comprobantes vivos de un cierre. Devuelve null si alguno no tiene monto.
create or replace function public.factura_neto(p_cierre public.pagos_cierres.id%type) returns numeric
language sql stable security definer set search_path = public as $$
  select case when count(*) = 0 or bool_or(monto is null) then null
    else sum(case when tipo = 'nc' then -monto else monto end) end
  from facturas_comprobantes where cierre_id = p_cierre and borrado_at is null
$$;
revoke all on function public.factura_neto(public.pagos_cierres.id%type) from public, anon, authenticated;

-- Recalcula el estado de la factura de un cierre a partir de sus comprobantes.
create or replace function public.factura_link_recalcular(p_cierre public.pagos_cierres.id%type) returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  c pagos_cierres; esperado numeric; neto numeric; listo boolean; hay int; primera facturas_comprobantes;
  dudoso boolean;
begin
  select * into c from pagos_cierres where id = p_cierre for update;
  if not found then return; end if;
  esperado := factura_monto_esperado(c.total, c.metodo, to_jsonb(c.pagos));
  neto := factura_neto(p_cierre);
  select count(*) into hay from facturas_comprobantes where cierre_id = p_cierre and borrado_at is null;
  select * into primera from facturas_comprobantes where cierre_id = p_cierre and borrado_at is null and tipo = 'factura'
    order by created_at desc limit 1;
  select coalesce(bool_or(monto_origen = 'manual' or observacion is not null), false) into dudoso
    from facturas_comprobantes where cierre_id = p_cierre and borrado_at is null;
  listo := hay > 0 and neto is not null and not dudoso and abs(neto - esperado) < 1 and esperado > 0;

  if listo then
    update pagos_cierres set
      factura_ok = true,
      factura_ok_at = case when coalesce(factura_ok, false) then factura_ok_at else now() end,
      factura_link = case when coalesce(factura_ok, false) and not factura_link then false else true end,
      factura_monto = neto,
      factura_file = coalesce(primera.archivo, factura_file),
      factura_nro = coalesce(primera.nro, factura_nro)
    where id = p_cierre;
  else
    update pagos_cierres set
      -- solo se cae lo que puso el link; lo marcado a mano no se toca
      factura_ok = case when factura_link then false else factura_ok end,
      factura_ok_at = case when factura_link then null else factura_ok_at end,
      factura_link = false,
      factura_monto = neto,
      factura_file = case when hay > 0 then coalesce(primera.archivo, factura_file)
                          when factura_file like 'link/%' then null else factura_file end,
      factura_nro = case when hay > 0 then coalesce(primera.nro, factura_nro)
                         when factura_file like 'link/%' then null else factura_nro end
    where id = p_cierre;
  end if;
end $$;
revoke all on function public.factura_link_recalcular(public.pagos_cierres.id%type) from public, anon, authenticated;

-- Si cambia el total de un cierre con factura puesta por el link y ya no coincide, se cae el OK.
-- Si se reabre (borrador) también: el cadete tiene que esperar la nueva confirmación.
create or replace function public.factura_link_tg_total() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.factura_link and coalesce(new.factura_ok, false) and not coalesce(new.pagado, false) and (
       new.estado <> 'confirmado'
    or abs(coalesce(new.factura_monto, 0) - factura_monto_esperado(new.total, new.metodo, to_jsonb(new.pagos))) >= 1) then
    new.factura_ok := false; new.factura_ok_at := null; new.factura_link := false;
  end if;
  return new;
end $$;
drop trigger if exists factura_link_total on public.pagos_cierres;
create trigger factura_link_total before update of total, pagos, metodo, estado on public.pagos_cierres
  for each row execute function public.factura_link_tg_total();

-- Semana que se liquida ahora: el lunes de la semana pasada (hora de Buenos Aires).
create or replace function public.factura_link_semana_actual() returns text
language sql stable as $$
  select to_char(date_trunc('week', (now() at time zone 'America/Argentina/Buenos_Aires'))::date - 7, 'YYYY-MM-DD')
$$;

-- ───────────────────────── página pública ─────────────────────────

-- Lo que ve el cadete: semanas confirmadas sin pagar (más la actual, aunque esté en revisión o pagada).
create or replace function public.factura_link_info(p_token text) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  t cadetes_tarifas; actual text := factura_link_semana_actual(); semanas json;
begin
  t := factura_link_tarifa(p_token);
  if t.id is null then return json_build_object('ok', false, 'motivo', 'link_invalido'); end if;

  with mis as (
    select c.* from pagos_cierres c
    where factura_norm(c.cadete) = factura_norm(t.nombre_lightdata)
      and c.semana_label >= to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date - 63, 'YYYY-MM-DD')
      and coalesce(c.estado, '') <> 'excluido'
  ), elegidas as (
    select * from mis where (estado = 'confirmado' and not coalesce(pagado, false)) or semana_label = actual
  )
  select coalesce(json_agg(x order by x.semana desc), '[]'::json) into semanas from (
    select e.semana_label as semana,
      case when e.estado <> 'confirmado' then 'revision'
           when coalesce(e.pagado, false) then 'pagado'
           when factura_monto_esperado(e.total, e.metodo, to_jsonb(e.pagos)) = 0 then 'efectivo'
           when coalesce(e.factura_ok, false) then 'lista'
           else 'subir' end as estado,
      case when e.estado = 'confirmado' then factura_monto_esperado(e.total, e.metodo, to_jsonb(e.pagos)) end as monto,
      case when e.estado = 'confirmado' then factura_neto(e.id) end as neto,
      (select coalesce(json_agg(json_build_object('id', fc.id, 'tipo', fc.tipo, 'nro', fc.nro, 'monto', fc.monto,
                'origen', fc.monto_origen, 'obs', fc.observacion, 'at', fc.created_at, 'xubio', fc.xubio_id is not null) order by fc.created_at), '[]'::json)
         from facturas_comprobantes fc where fc.cierre_id = e.id and fc.borrado_at is null) as comprobantes,
      coalesce(e.factura_ok, false) and not e.factura_link as marcada_a_mano
    from elegidas e
    union all
    -- semana actual sin fila todavía: en revisión
    select actual, 'revision', null, null, '[]'::json, false
    where not exists (select 1 from mis where semana_label = actual)
  ) x;

  return json_build_object('ok', true,
    'nombre', split_part(trim(coalesce(nullif(t.nombre, ''), t.nombre_lightdata)), ' ', 1),
    'factura', coalesce(t.factura, true),
    'semanas', semanas);
end $$;
revoke all on function public.factura_link_info(text) from public;
grant execute on function public.factura_link_info(text) to anon, authenticated;

-- Registrar un comprobante ya subido a link/<token>/<semana>/...
drop function if exists public.factura_link_registrar(text, text, text, text, text, numeric, text, text);
create or replace function public.factura_link_registrar(
  p_token text, p_semana text, p_archivo text, p_tipo text,
  p_nro text default null, p_monto numeric default null, p_monto_origen text default 'pdf', p_cuit text default null,
  p_letra text default null, p_punto_venta text default null, p_numero text default null, p_fecha date default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  t cadetes_tarifas; c pagos_cierres; obs text; cuit_cadete text; n int;
begin
  t := factura_link_tarifa(p_token);
  if t.id is null then return json_build_object('ok', false, 'motivo', 'link_invalido'); end if;
  if p_semana is null or p_semana !~ '^\d{4}-\d{2}-\d{2}$' then return json_build_object('ok', false, 'motivo', 'semana_invalida'); end if;
  if p_tipo not in ('factura', 'nd', 'nc') then return json_build_object('ok', false, 'motivo', 'tipo_invalido'); end if;
  if p_archivo is null or not starts_with(p_archivo, 'link/' || p_token || '/' || p_semana || '/') or p_archivo like '%..%' then
    return json_build_object('ok', false, 'motivo', 'archivo_invalido');
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'facturas' and o.name = p_archivo) then
    return json_build_object('ok', false, 'motivo', 'archivo_no_subido');
  end if;
  if exists (select 1 from facturas_comprobantes where archivo = p_archivo) then
    return json_build_object('ok', false, 'motivo', 'ya_registrado');
  end if;

  select * into c from pagos_cierres
  where factura_norm(cadete) = factura_norm(t.nombre_lightdata) and semana_label = p_semana
    and estado = 'confirmado' order by id desc limit 1 for update;
  if not found then return json_build_object('ok', false, 'motivo', 'no_confirmada'); end if;
  if coalesce(c.pagado, false) then return json_build_object('ok', false, 'motivo', 'pagada'); end if;
  if factura_monto_esperado(c.total, c.metodo, to_jsonb(c.pagos)) = 0 then return json_build_object('ok', false, 'motivo', 'efectivo'); end if;

  select count(*) into n from facturas_comprobantes where cierre_id = c.id and created_at > now() - interval '1 day';
  if n >= 15 then return json_build_object('ok', false, 'motivo', 'demasiados'); end if;

  if p_monto is not null and (p_monto <= 0 or p_monto > 100000000) then p_monto := null; end if;
  if p_monto_origen not in ('pdf', 'manual') then p_monto_origen := 'manual'; end if;
  p_cuit := nullif(regexp_replace(coalesce(p_cuit, ''), '\D', '', 'g'), '');
  cuit_cadete := nullif(regexp_replace(coalesce(t.cuil, ''), '\D', '', 'g'), '');
  if p_cuit is not null and cuit_cadete is not null and p_cuit <> cuit_cadete then
    obs := 'CUIT del comprobante (' || p_cuit || ') distinto al del cadete';
  end if;

  p_punto_venta := nullif(regexp_replace(coalesce(p_punto_venta, ''), '\D', '', 'g'), '');
  p_numero := nullif(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), '');
  if upper(coalesce(p_letra, '')) not in ('A', 'B', 'C') then p_letra := null; end if;
  if p_fecha is not null and (p_fecha < current_date - 120 or p_fecha > current_date + 5) then p_fecha := null; end if;
  insert into facturas_comprobantes (cierre_id, semana_label, cadete, tipo, nro, monto, monto_origen, cuit, archivo, observacion,
                                     letra, punto_venta, numero, fecha_emision)
  values (c.id, p_semana, c.cadete, p_tipo,
          nullif(right(coalesce(p_numero, regexp_replace(coalesce(p_nro, ''), '\D', '', 'g')), 4), ''),
          p_monto, p_monto_origen, p_cuit, p_archivo, obs,
          upper(p_letra), lpad(right(p_punto_venta, 5), 5, '0'), lpad(right(p_numero, 8), 8, '0'), p_fecha);
  perform factura_link_recalcular(c.id);
  return json_build_object('ok', true, 'info', factura_link_info(p_token));
end $$;
revoke all on function public.factura_link_registrar(text, text, text, text, text, numeric, text, text, text, text, text, date) from public;
grant execute on function public.factura_link_registrar(text, text, text, text, text, numeric, text, text, text, text, text, date) to anon, authenticated;

-- El cadete saca un comprobante que subió mal (solo mientras no esté pagado).
create or replace function public.factura_link_borrar(p_token text, p_id bigint) returns json
language plpgsql volatile security definer set search_path = public as $$
declare t cadetes_tarifas; fc facturas_comprobantes; c pagos_cierres;
begin
  t := factura_link_tarifa(p_token);
  if t.id is null then return json_build_object('ok', false, 'motivo', 'link_invalido'); end if;
  select * into fc from facturas_comprobantes where id = p_id and borrado_at is null
    and starts_with(archivo, 'link/' || p_token || '/');
  if not found then return json_build_object('ok', false, 'motivo', 'no_existe'); end if;
  select * into c from pagos_cierres where id = fc.cierre_id;
  if coalesce(c.pagado, false) then return json_build_object('ok', false, 'motivo', 'pagada'); end if;
  if fc.xubio_id is not null then return json_build_object('ok', false, 'motivo', 'en_xubio'); end if;
  update facturas_comprobantes set borrado_at = now() where id = p_id;
  perform factura_link_recalcular(fc.cierre_id);
  return json_build_object('ok', true, 'info', factura_link_info(p_token));
end $$;
revoke all on function public.factura_link_borrar(text, bigint) from public;
grant execute on function public.factura_link_borrar(text, bigint) to anon, authenticated;

-- ───────────────────────── storage ─────────────────────────
-- El cadete puede SUBIR (solo insert) dentro de link/<su token>/. Nada más: no lee, no lista,
-- no pisa (sin update), no borra. El bucket sigue privado; Alejo/Adrián lo abren con link firmado.
drop policy if exists facturas_link_subir on storage.objects;
create policy facturas_link_subir on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'facturas'
    and (storage.foldername(name))[1] = 'link'
    and public.factura_link_token_ok((storage.foldername(name))[2])
    and lower(storage.extension(name)) in ('pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic')
  );

-- Tope de tamaño del bucket (si no tenía): 15 MB, igual que el arrastrar de Pagar.
update storage.buckets set file_size_limit = 15728640 where id = 'facturas' and file_size_limit is null;
