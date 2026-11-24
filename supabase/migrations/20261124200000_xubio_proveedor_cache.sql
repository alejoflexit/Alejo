-- Recuerda el proveedor de Xubio de cada cadete: la primera carga lo busca (lento: la lista
-- de Xubio no trae CUIT), las siguientes van directo. La función xubio la llena sola.
alter table public.cadetes_tarifas add column if not exists xubio_proveedor_id bigint;
