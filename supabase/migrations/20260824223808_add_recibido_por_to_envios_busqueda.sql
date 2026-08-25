alter table public.envios_busqueda
  add column if not exists recibido_por text;

comment on column public.envios_busqueda.recibido_por is
  'Receptor de LightData con documento reducido a sus últimos cuatro dígitos.';
