alter table public.envios_busqueda
  add column if not exists telefono text;

comment on column public.envios_busqueda.telefono is
  'Teléfono del destinatario informado por la ficha individual de LightData.';
