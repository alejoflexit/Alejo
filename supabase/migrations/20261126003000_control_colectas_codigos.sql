-- Control de colectas (25/11, aplicada por Claude vía conector): código LD de cada cuenta vinculada y
-- nombre de fantasía en envios_busqueda, para cruzar los envíos del día cuando el chofer no marca la colecta.
alter table public.colectas_cliente_ld add column if not exists ld_codigo text;
alter table public.envios_busqueda add column if not exists nombre_fantasia text;
create index if not exists envios_busqueda_fecha_flexit_pref on public.envios_busqueda (fecha_flexit text_pattern_ops);
