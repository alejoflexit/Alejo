-- Dónde se guarda cada seller en el cuartito de devoluciones (código de estante/caja). Sin fila = caja por letra.
create table if not exists public.devoluciones_ubicaciones (
  cliente text primary key,
  codigo text not null,
  actualizado_por text,
  actualizado_at timestamptz default now()
);
alter table public.devoluciones_ubicaciones enable row level security;
create policy "ubic leer" on public.devoluciones_ubicaciones for select to authenticated using (true);
create policy "ubic insertar" on public.devoluciones_ubicaciones for insert to authenticated with check (true);
create policy "ubic editar" on public.devoluciones_ubicaciones for update to authenticated using (true) with check (true);
create policy "ubic borrar" on public.devoluciones_ubicaciones for delete to authenticated using (true);
