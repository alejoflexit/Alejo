alter table public.envios_busqueda
  add column if not exists asignaciones jsonb not null default '[]'::jsonb;

comment on column public.envios_busqueda.asignaciones is
  'Historial de asignaciones informado por la ficha interna de LightData.';
