-- Seguridad Etapa 1 (13/11/2026): cerrar lo que se podía usar SIN login.
-- Base: consulta en vivo de Alejo del 13/11 (políticas abiertas + funciones SECURITY DEFINER con
-- EXECUTE para anon). Ver ESTADO-SEGURIDAD.md.
--
-- ORDEN OBLIGATORIO: correr esto DESPUÉS de que esté desplegado el commit que pasa las lecturas
-- de App.js / Zonas.js / Analisis.js a authedFetch. Al revés, Métricas, Zonas y Análisis quedan
-- vacías para todos.
--
-- Efecto: quien no inició sesión deja de ver Métricas, Zonas y Análisis. Con sesión, todo igual.
-- Idempotente. No borra datos.

-- 1) Lectura: de public/anon a authenticated (se mantiene el mismo filtro de la política)
do $$
declare
  t text;
  p record;
  tablas text[] := array[
    'semanas', 'semanas_zonas', 'zonas_cp', 'zonas_regiones', 'localidad_zonas', 'localidad_zona_alias',
    'cadete_topes', 'recorridos', 'recorrido_personas', 'corte_dia', 'analista_informes',
    'alertas_transito', 'transito_estado'
  ];
begin
  foreach t in array tablas loop
    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT' and (roles && array['public', 'anon']::name[])
    loop
      execute format('alter policy %I on public.%I to authenticated', p.policyname, t);
      raise notice 'cerrada: %.%', t, p.policyname;
    end loop;
  end loop;
end $$;

-- 2) reportes_bug: solo se reporta con sesión (la Tiquetera ya la pide)
do $$
declare p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'reportes_bug' and cmd = 'INSERT' and (roles && array['public', 'anon']::name[])
  loop
    execute format('alter policy %I on public.reportes_bug to authenticated', p.policyname);
  end loop;
end $$;

-- 3) Funciones que escriben métricas: solo el proceso diario (service_role).
--    Hoy cualquiera sin login podía reescribir demorados/horas de un día.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as firma from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('aplicar_correccion_dem21', 'aplicar_horas')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
    execute format('grant execute on function %s to service_role', f.firma);
  end loop;
end $$;

-- NO se tocan acá (a propósito):
--  * colecta_link_info / colecta_link_responder: los usa el cliente desde el link, sin login (por diseño).
--  * bot_wa_reportar / liq_wa_*: los llama el VPS y validan una clave propia (p_clave) contra un hash.
--  * transito_corredores / transito_fuentes / transito_noticias: noticias públicas; no se sabe si
--    el proceso que las carga lee con la clave anónima. Revisar en una segunda pasada.
--  * atlas_*: proyecto Atlas (n8n). Cerrarlas requiere confirmar antes qué clave usa n8n.
--  * Funciones de trigger (log_*, trg_*, pagos_ov_log, colectas_fija_a_sabado): no se pueden
--    llamar por la API; no son un riesgo.
