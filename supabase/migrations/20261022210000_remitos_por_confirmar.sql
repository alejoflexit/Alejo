-- Doble verificación: la foto firmada deja el remito "por_confirmar"; recién al confirmar pasa a "procesando" (y el sync toca LightData)
alter table public.remitos_devolucion add column if not exists confirmado_por text, add column if not exists confirmado_at timestamptz;
alter table public.remitos_devolucion drop constraint remitos_devolucion_estado_check;
alter table public.remitos_devolucion add constraint remitos_devolucion_estado_check check (estado in ('emitido','por_confirmar','procesando','devuelto','error','anulado'));
alter policy "rem editar" on public.remitos_devolucion using (estado in ('emitido','por_confirmar','error','procesando')) with check (estado in ('emitido','por_confirmar','procesando','anulado'));
