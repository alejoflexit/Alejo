alter table public.envios_busqueda
  add column if not exists origen text;

comment on column public.envios_busqueda.origen is
  'Origen literal informado por LightData (por ejemplo ML, Flex o Directo).';
