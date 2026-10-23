-- Fecha de la última asignación al cadete actual (para el mensaje de reclamo) + notas por envío (ej. seguimiento de extraviados)
alter table public.devoluciones add column if not exists cadete_asignado_at timestamptz;
alter table public.devoluciones_gestion add column if not exists notas jsonb not null default '[]'::jsonb;
