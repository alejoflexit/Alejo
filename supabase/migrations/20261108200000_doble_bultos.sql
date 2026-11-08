-- Doble bulto (2026-11-08): registro de los paquetes de más de un bulto que se le cobran al cliente.
--
-- Antes: foto de cada paquete → grupo de Facebook → se revisaba foto por foto → Excel a mano.
-- Ahora: en la app (sección "Doble bulto") se escanea el QR de la etiqueta al ingresar la mercadería,
-- se confirma la cantidad de bultos y queda guardado. El QR de Mercado Libre trae solo el número de
-- envío y el vendedor (sender_id), NO la dirección: la dirección, el CP y la localidad (zona) se
-- completan solos cuando el envío aparece en envios_busqueda (sync de LightData cada 30-60 min).
-- El cruce lo hace la propia pantalla al abrirse.
--
-- Reglas que hay que conservar:
--  * Un registro por envío (codigo único): escanear dos veces no duplica el cobro.
--  * codigo = id del envío de ML (QR de ML), did de LightData (QR propio) o el texto tipeado.
--  * ml_vendedores se aprende sola: cuando un envío cruza, guarda sender_id → cliente, así la
--    próxima etiqueta de ese vendedor muestra el cliente en el momento del escaneo.

create table if not exists public.doble_bultos (
  id bigint generated always as identity primary key,
  codigo text not null unique,
  qr text,
  sender_id text,
  bultos int not null default 2 check (bultos between 2 and 50),
  escaneado_at timestamptz not null default now(),
  escaneado_por text,
  -- se completan al cruzar con envios_busqueda
  id_interno text,
  cliente text,
  direccion text,
  localidad text,
  cp text,
  cruzado_at timestamptz
);

comment on table public.doble_bultos is
  'Paquetes de más de un bulto escaneados al ingresar (sección Doble bulto). Dirección/zona se completan al cruzar con envios_busqueda.';

create index if not exists doble_bultos_fecha on public.doble_bultos (escaneado_at desc);
create index if not exists doble_bultos_sin_cruzar on public.doble_bultos (escaneado_at) where cruzado_at is null;

alter table public.doble_bultos enable row level security;
drop policy if exists "equipo todo" on public.doble_bultos;
create policy "equipo todo" on public.doble_bultos
  for all to authenticated using (true) with check (true);

create table if not exists public.ml_vendedores (
  sender_id text primary key,
  cliente text not null,
  actualizado_at timestamptz not null default now()
);

comment on table public.ml_vendedores is
  'sender_id de Mercado Libre → cliente de Flexit. Se aprende sola desde Doble bulto al cruzar envíos.';

alter table public.ml_vendedores enable row level security;
drop policy if exists "equipo todo" on public.ml_vendedores;
create policy "equipo todo" on public.ml_vendedores
  for all to authenticated using (true) with check (true);
