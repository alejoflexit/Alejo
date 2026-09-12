drop function if exists public.aplicar_dem21_detalle(text, jsonb);

create function public.aplicar_dem21_detalle(
  p_fecha text,
  p_cadetes jsonb,
  p_zonas jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_cadetes integer := 0;
  n_zonas integer := 0;
begin
  update public.semanas s
     set dem21_detalle = coalesce(p_cadetes -> s.cadete, '[]'::jsonb),
         dem21 = jsonb_array_length(coalesce(p_cadetes -> s.cadete, '[]'::jsonb))
   where s.fecha = p_fecha;
  get diagnostics n_cadetes = row_count;

  update public.semanas_zonas z
     set dem21 = coalesce((p_zonas ->> z.localidad_norm)::integer, 0)
   where z.fecha = p_fecha;
  get diagnostics n_zonas = row_count;

  return jsonb_build_object('semanas', n_cadetes, 'zonas', n_zonas);
end;
$$;

revoke execute on function public.aplicar_dem21_detalle(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_dem21_detalle(text, jsonb, jsonb) to service_role;
