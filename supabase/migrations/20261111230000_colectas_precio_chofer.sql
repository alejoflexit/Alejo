-- Precio de colecta por chofer dentro de cada cliente (Alejo 11/11/2026).
-- Ej.: Celulares y Etc. → Juan (Sprinter) $45.000, Pedro (Kangoo) $30.000.
-- Regla de pago (src/colectasShared.js · montoColecta): precio del día (colectas_registros.monto) >
-- precio del chofer para ese cliente (esta tabla) > precio general del cliente (colectas_clientes.monto).
create table if not exists public.colectas_precio_chofer (
  id bigint generated always as identity primary key,
  cliente_id uuid not null references public.colectas_clientes(id) on delete cascade,
  chofer text not null,
  monto numeric not null check (monto >= 0),
  creado_at timestamptz not null default now()
);
create unique index if not exists colectas_precio_chofer_uno on public.colectas_precio_chofer (cliente_id, lower(chofer));

alter table public.colectas_precio_chofer enable row level security;
drop policy if exists "equipo todo" on public.colectas_precio_chofer;
create policy "equipo todo" on public.colectas_precio_chofer
  for all to authenticated using (true) with check (true);
