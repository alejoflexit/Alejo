-- Palermo A/B (20/11/2026): la app decide el carrito con la ubicación del envío.
-- LightData ya trae Latitud/Longitud en el export; el sync las guarda acá.
alter table public.envios_busqueda
  add column if not exists latitud double precision,
  add column if not exists longitud double precision;

comment on column public.envios_busqueda.latitud is 'Latitud informada por LightData (null si viene vacía o en 0).';
comment on column public.envios_busqueda.longitud is 'Longitud informada por LightData (null si viene vacía o en 0).';

-- La pantalla Palermo A/B precarga por recuadro de coordenadas
create index if not exists envios_busqueda_lat_lng_idx on public.envios_busqueda (latitud, longitud) where latitud is not null;
