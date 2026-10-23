-- Chofer que lleva el remito (se elige al armarlo; sale impreso en las dos hojas)
alter table public.remitos_devolucion add column if not exists chofer text;
