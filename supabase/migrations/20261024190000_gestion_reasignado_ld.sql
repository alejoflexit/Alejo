-- Reasignación en LightData a "devuelto deposito" de lo que entra al depósito desde la app (escáner / pasar a depósito)
alter table public.devoluciones_gestion add column if not exists ld_reasignado_at timestamptz, add column if not exists ld_reasignado_error text;
