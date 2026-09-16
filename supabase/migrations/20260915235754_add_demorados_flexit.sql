-- NULL preserva la falta de cobertura histórica; cero solo se guarda al calcular.
alter table public.semanas
  add column demorados_flexit integer check (demorados_flexit >= 0);
comment on column public.semanas.demorados_flexit is
  'Particulares con estado vacío, En camino o En planta al capturar el día. NULL = no calculado.';
