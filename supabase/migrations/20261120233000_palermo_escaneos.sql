-- Palermo A/B (20/11/2026): registro compartido de escaneos para que todos los celulares vean el
-- mismo contador del día y quede qué paquete fue a qué carrito.
--
--  * Una fila por envío y por día (dia = fecha de Argentina): volver a escanear el mismo paquete el
--    mismo día actualiza la fila (upsert on conflict (dia, codigo)), nunca duplica.
--  * carrito: 'A' | 'B' | null (no es de Palermo, sin ubicación y nadie eligió, etc.).
--  * tipo: lo que dijo la app ('A','B','fuera','sinubic','noesta','error'); manual = lo eligió una persona.
-- RLS: solo usuarios con sesión. Idempotente.

create table if not exists public.palermo_escaneos (
  dia date not null,
  codigo text not null,
  carrito text check (carrito in ('A', 'B')),
  tipo text not null,
  manual boolean not null default false,
  direccion text,
  cliente text,
  escaneado_por text,
  escaneado_at timestamptz not null default now(),
  primary key (dia, codigo)
);

comment on table public.palermo_escaneos is
  'Palermo A/B: en qué carrito se puso cada paquete, por día. Una fila por envío y día.';

create index if not exists palermo_escaneos_dia on public.palermo_escaneos (dia, escaneado_at desc);

alter table public.palermo_escaneos enable row level security;

drop policy if exists "equipo lee" on public.palermo_escaneos;
create policy "equipo lee" on public.palermo_escaneos for select to authenticated using (true);
drop policy if exists "equipo carga" on public.palermo_escaneos;
create policy "equipo carga" on public.palermo_escaneos for insert to authenticated with check (true);
drop policy if exists "equipo corrige" on public.palermo_escaneos;
create policy "equipo corrige" on public.palermo_escaneos for update to authenticated using (true) with check (true);
