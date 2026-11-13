-- Extraviados y rotos (2026-11-13): reemplaza el Excel "Paquetes extraviados que debemos descontar
-- de la factura del cliente". Vive en Liquidaciones › Extraviados.
--
-- Flujo: se carga el IDML (o tracking / ID de LightData) → la app cruza con envios_busqueda
-- (cliente, transportista, ID interno) → el workflow extraviados.yml trae el VALOR DECLARADO de la
-- ficha de LightData. Si se tilda "Descontar", la app crea una fila de pagos_ajustes por cuota
-- (una por semana consecutiva desde semana_inicio) y Liquidaciones las muestra como descuentos.
--
-- Reglas que hay que conservar:
--  * El descuento al transportista son filas de pagos_ajustes con extraviado_id: Liquidaciones no
--    necesita lógica nueva y el cierre de semana las congela como cualquier descuento.
--  * Una cuota de una semana ya PAGADA no se borra ni se crea (la app lo bloquea).
--  * valor_manual (si se carga) manda sobre valor_declarado.
--  * Solo admin@flexit.app (es plata, igual que el resto de Liquidaciones).

create table if not exists public.extraviados (
  id bigint generated always as identity primary key,
  fecha date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  tipo text not null default 'extraviado' check (tipo in ('extraviado', 'roto')),
  codigo text,                 -- lo que se cargó: IDML, tracking o ID de LightData
  id_interno text,             -- did de LightData (se completa al cruzar)
  tracking text,
  id_venta_ml text,
  cliente text,
  cadete text,                 -- nombre con el que cobra en Liquidaciones (cadetes_tarifas.nombre_lightdata)
  cadete_ld text,              -- cadete tal como figura en LightData (referencia)
  valor_declarado numeric,     -- de la ficha de LightData
  valor_manual numeric,        -- si se carga a mano, manda
  info text,
  obs text,
  descontar boolean not null default false,
  cuotas int not null default 1 check (cuotas between 1 and 12),
  semana_inicio date,          -- lunes de la primera cuota (semana de Liquidaciones)
  valor_intentos int not null default 0,
  valor_consultado_at timestamptz,
  valor_error text,
  creado_por text,
  created_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

comment on table public.extraviados is
  'Paquetes extraviados/rotos: se descuentan al cliente y, si se tilda, al transportista en cuotas (pagos_ajustes.extraviado_id).';

create index if not exists extraviados_fecha on public.extraviados (fecha desc);
create index if not exists extraviados_sin_valor on public.extraviados (id) where valor_declarado is null;

alter table public.extraviados enable row level security;
drop policy if exists "solo admin" on public.extraviados;
create policy "solo admin" on public.extraviados
  for all to authenticated
  using ((auth.jwt() ->> 'email') = 'admin@flexit.app')
  with check ((auth.jwt() ->> 'email') = 'admin@flexit.app');

-- Cuotas: vínculo de cada descuento con su extraviado
alter table public.pagos_ajustes add column if not exists extraviado_id bigint references public.extraviados(id) on delete set null;
alter table public.pagos_ajustes add column if not exists cuota int;
create index if not exists pagos_ajustes_extraviado on public.pagos_ajustes (extraviado_id) where extraviado_id is not null;
