-- Chat interno del equipo por envio, para Pendientes historicos.
-- Decisiones de Alejo (23/09/2026): el contador muestra el total de mensajes y nunca
-- se apaga, las etiquetas son una lista fija, no hay filtro por etiqueta en la tabla,
-- y la burbuja de etiqueta se ve en la fila.
-- Permisos: mismo patron que notas_operativas, solo authenticated, nada anonimo.

create table if not exists public.envio_notas (
  id bigint generated always as identity primary key,
  envio_id text not null,
  autor text not null,
  texto text not null,
  created_at timestamptz not null default now()
);

comment on table public.envio_notas is
  'Chat interno del equipo por envio (Pendientes historicos). envio_id = envios_busqueda.id_interno. No le llega al cadete ni al cliente: el mensaje al cadete se copia aparte.';

create index if not exists envio_notas_envio_idx on public.envio_notas (envio_id, created_at);

alter table public.envio_notas enable row level security;

drop policy if exists "equipo todo" on public.envio_notas;
create policy "equipo todo" on public.envio_notas
  for all to authenticated using (true) with check (true);

create table if not exists public.envio_etiquetas (
  envio_id text not null,
  etiqueta text not null,
  autor text not null,
  created_at timestamptz not null default now(),
  primary key (envio_id, etiqueta)
);

comment on table public.envio_etiquetas is
  'Etiquetas fijas por envio (extraviado, reclamo, reprogramar, avisado, deposito). La lista vive en src/pendingPriority.js; aca no se valida para no tener que migrar al agregar una.';

alter table public.envio_etiquetas enable row level security;

drop policy if exists "equipo todo" on public.envio_etiquetas;
create policy "equipo todo" on public.envio_etiquetas
  for all to authenticated using (true) with check (true);
