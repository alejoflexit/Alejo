alter table public.envios_busqueda
  add column if not exists recibido_por text;

comment on column public.envios_busqueda.recibido_por is
  'Dato crudo de entrega de LightData. Uso exclusivo server-side; la API debe enmascarar el documento.';
