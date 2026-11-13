-- Extraviados para todo el equipo (2026-11-13, pedido de Alejo).
-- La sección sale de Liquidaciones y queda propia: cualquier usuario logueado carga, tilda
-- "Descontar" y elige cuotas. Como pagos_ajustes / pagos_cierres / cadetes_tarifas siguen siendo
-- solo admin, todo lo que toca pagos pasa por funciones SECURITY DEFINER que validan las reglas:
--   * extraviado_descontar(id): crea una cuota por semana en pagos_ajustes. No toca semanas ya
--     PAGADAS a ese chofer; si está confirmado (no pagado) ajusta el total congelado del cierre.
--   * extraviado_quitar(id): saca las cuotas no pagadas (las pagadas quedan).
--   * extraviados_cuotas(): estado de cada cuota (sin exponer montos de liquidación).
--   * extraviados_cadetes(): nombres con los que cobra cada transportista + alias de LightData.
-- Correr DESPUÉS de 20261113150000_extraviados.sql. Idempotente.

-- 1) La tabla la usa todo el equipo logueado
drop policy if exists "solo admin" on public.extraviados;
drop policy if exists "equipo" on public.extraviados;
create policy "equipo" on public.extraviados for all to authenticated using (true) with check (true);

-- nombre normalizado igual que norm() del front (minúsculas, sin acentos, espacios simples)
create or replace function public.fx_norm(t text) returns text language sql immutable as $$
  select btrim(regexp_replace(translate(lower(coalesce(t, '')), 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun'), '\s+', ' ', 'g'))
$$;

-- 2) Descontar
create or replace function public.extraviado_descontar(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.extraviados%rowtype;
  monto numeric; n int; base numeric; m numeric; i int; sem date;
  c record; ya int; tipo_txt text; ref text; creadas int := 0; aviso_factura text[] := '{}';
begin
  if auth.uid() is null then raise exception 'Necesitás estar logueado'; end if;
  select * into r from public.extraviados where id = p_id for update;
  if not found then raise exception 'No existe el extraviado %', p_id; end if;
  select count(*) into ya from public.pagos_ajustes where extraviado_id = p_id;
  if ya > 0 then raise exception 'Ya tiene cuotas cargadas'; end if;
  if coalesce(r.cadete, '') = '' then raise exception 'Elegí el transportista antes de descontar'; end if;
  if r.semana_inicio is null then raise exception 'Elegí la semana de la primera cuota'; end if;
  monto := round(coalesce(nullif(r.valor_manual, 0), r.valor_declarado, 0));
  if monto <= 0 then raise exception 'Todavía no hay valor: esperá el de LightData o cargalo a mano'; end if;
  n := greatest(1, least(12, coalesce(r.cuotas, 1)));
  base := floor(monto / n);

  -- ninguna cuota puede caer en una semana ya pagada a ese chofer
  for i in 0..n - 1 loop
    sem := r.semana_inicio + 7 * i;
    if exists (select 1 from public.pagos_cierres pc where pc.semana_label = to_char(sem, 'YYYY-MM-DD')
               and public.fx_norm(pc.cadete) = public.fx_norm(r.cadete) and pc.pagado) then
      raise exception 'La semana del % ya se le pagó a %: elegí una semana posterior', to_char(sem, 'DD/MM'), r.cadete;
    end if;
  end loop;

  tipo_txt := case when r.tipo = 'roto' then 'Roto' else 'Extraviado' end;
  ref := concat_ws(' · ', to_char(r.fecha, 'DD/MM'), nullif(r.cliente, ''), nullif(r.codigo, ''));
  for i in 0..n - 1 loop
    sem := r.semana_inicio + 7 * i;
    m := case when i = n - 1 then monto - base * (n - 1) else base end;
    insert into public.pagos_ajustes (semana_label, cadete, concepto, monto, extraviado_id, cuota)
    values (to_char(sem, 'YYYY-MM-DD'), r.cadete,
            left(tipo_txt || ' ' || ref || case when n > 1 then format(' (cuota %s/%s)', i + 1, n) else '' end, 200),
            m, p_id, i + 1);
    creadas := creadas + 1;
    -- chofer confirmado y no pagado: el total del cierre está congelado → se ajusta (igual que Liquidaciones)
    for c in select * from public.pagos_cierres pc where pc.semana_label = to_char(sem, 'YYYY-MM-DD')
             and public.fx_norm(pc.cadete) = public.fx_norm(r.cadete) and pc.estado = 'confirmado' and not coalesce(pc.pagado, false) loop
      update public.pagos_cierres set total = coalesce(total, 0) - m,
        detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('ajuste', coalesce((detalle->>'ajuste')::numeric, 0) + m)
      where id = c.id;
      if coalesce(c.factura_ok, false) then aviso_factura := aviso_factura || to_char(sem, 'DD/MM'); end if;
    end loop;
  end loop;

  update public.extraviados set descontar = true, actualizado_at = now() where id = p_id;
  return jsonb_build_object('cuotas', creadas, 'monto', monto, 'factura_marcada', to_jsonb(aviso_factura));
end $$;

-- 3) Quitar (solo cuotas no pagadas)
create or replace function public.extraviado_quitar(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a record; c record; borradas int := 0; pagadas int := 0; pagada boolean;
begin
  if auth.uid() is null then raise exception 'Necesitás estar logueado'; end if;
  perform 1 from public.extraviados where id = p_id for update;
  for a in select * from public.pagos_ajustes where extraviado_id = p_id loop
    select exists (select 1 from public.pagos_cierres pc where pc.semana_label = a.semana_label
                   and public.fx_norm(pc.cadete) = public.fx_norm(a.cadete) and pc.pagado) into pagada;
    if pagada then pagadas := pagadas + 1; continue; end if;
    for c in select * from public.pagos_cierres pc where pc.semana_label = a.semana_label
             and public.fx_norm(pc.cadete) = public.fx_norm(a.cadete) and pc.estado = 'confirmado' and not coalesce(pc.pagado, false) loop
      update public.pagos_cierres set total = coalesce(total, 0) + a.monto,
        detalle = coalesce(detalle, '{}'::jsonb) || jsonb_build_object('ajuste', coalesce((detalle->>'ajuste')::numeric, 0) - a.monto)
      where id = c.id;
    end loop;
    delete from public.pagos_ajustes where id = a.id;
    borradas := borradas + 1;
  end loop;
  if pagadas = 0 then update public.extraviados set descontar = false, actualizado_at = now() where id = p_id; end if;
  return jsonb_build_object('borradas', borradas, 'pagadas', pagadas);
end $$;

-- 4) Estado de las cuotas
create or replace function public.extraviados_cuotas()
returns table (extraviado_id bigint, semana_label text, monto numeric, cuota int, pagado boolean)
language sql stable security definer set search_path = public as $$
  select a.extraviado_id, a.semana_label, a.monto, a.cuota,
         exists (select 1 from public.pagos_cierres pc where pc.semana_label = a.semana_label
                 and public.fx_norm(pc.cadete) = public.fx_norm(a.cadete) and pc.pagado)
  from public.pagos_ajustes a
  where a.extraviado_id is not null and auth.uid() is not null
$$;

-- 5) Transportistas (nombre con el que cobra) + alias de LightData, sin tarifas
create or replace function public.extraviados_cadetes()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then '{}'::jsonb else jsonb_build_object(
    'tarifas', coalesce((select jsonb_agg(jsonb_build_object('nombre_lightdata', t.nombre_lightdata) order by t.nombre_lightdata)
                         from public.cadetes_tarifas t where coalesce(t.activo, true) and t.nombre_lightdata is not null), '[]'::jsonb),
    'alias', coalesce((select jsonb_agg(jsonb_build_object('nombre_lightdata', al.nombre_lightdata, 'regla', al.regla, 'paga_como', al.paga_como))
                       from public.pagos_cadete_alias al), '[]'::jsonb)) end
$$;

revoke all on function public.extraviado_descontar(bigint), public.extraviado_quitar(bigint),
  public.extraviados_cuotas(), public.extraviados_cadetes() from public, anon;
grant execute on function public.extraviado_descontar(bigint), public.extraviado_quitar(bigint),
  public.extraviados_cuotas(), public.extraviados_cadetes() to authenticated;
