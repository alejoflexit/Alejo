-- Lugar puesto a mano para un paquete puntual (ej. P2 por grande); si es null, va al lugar de su seller
alter table public.devoluciones_gestion add column if not exists ubicacion text;
