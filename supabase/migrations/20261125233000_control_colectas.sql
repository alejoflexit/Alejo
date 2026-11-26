-- Control de colectas en Arribos (Alejo 25/11/2026).
-- 1) Vínculo cliente de Colectas ↔ cuenta(s) de LightData (idCliente del informe de colecta,
--    = clientes_tokens.id_interno). Un cliente puede tener varias cuentas y una cuenta puede ser
--    de varias sucursales (ej. La Plata Trade).
-- 2) Marca manual "colectada" en el registro del día, para colectas sin envíos o sin cuenta.
create table if not exists public.colectas_cliente_ld (
  id bigint generated always as identity primary key,
  cliente_id uuid not null references public.colectas_clientes(id) on delete cascade,
  ld_id integer not null,
  ld_nombre text,
  origen text not null default 'manual' check (origen in ('auto', 'manual')),
  creado_at timestamptz not null default now(),
  unique (cliente_id, ld_id)
);
create index if not exists colectas_cliente_ld_ld on public.colectas_cliente_ld (ld_id);

alter table public.colectas_cliente_ld enable row level security;
drop policy if exists "equipo todo" on public.colectas_cliente_ld;
create policy "equipo todo" on public.colectas_cliente_ld
  for all to authenticated using (true) with check (true);

alter table public.colectas_registros
  add column if not exists colectado_manual_at timestamptz,
  add column if not exists colectado_manual_por text;

-- (agregado 25/11 21:40) El control lee los envíos del día por fecha_flexit con LIKE 'dd/mm/yyyy%':
-- sin índice tarda ~6 s y a veces da timeout. Índice para búsquedas por prefijo.
create index if not exists envios_busqueda_fecha_flexit_pref on public.envios_busqueda (fecha_flexit text_pattern_ops);
