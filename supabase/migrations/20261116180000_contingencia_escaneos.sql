-- Modo contingencia (2026-11-16): escaneos hechos en la app mientras LightData está caído.
--
-- Contexto: el 16/11 LightData se cayó en plena colecta (~4.000 envíos) y se perdió la trazabilidad.
-- La sección "Contingencia" deja escanear igual (colecta / ingreso a planta / salida) y guarda cada QR.
-- Cuando LightData vuelve, el pase se hace RE-ESCANEANDO DESDE LA PANTALLA: la app regenera cada QR
-- desde el texto crudo guardado acá y alguien lo escanea con la app oficial de LightData.
-- La app NO escribe en LightData (regla: LightData solo lectura).
--
-- Reglas que hay que conservar:
--  * id lo genera el dispositivo (uuid) ANTES de subir: la subida es INSERT … ON CONFLICT (id) DO NOTHING,
--    así reintentar nunca duplica. No poner default ni unique por código: el mismo envío puede escanearse
--    en colecta, en ingreso y en salida (son tres filas), y el deduplicado por tanda lo hace la app.
--  * qr = texto CRUDO del QR, completo y sin recortar (ML: {"id","sender_id","hash_code","security_digit"};
--    LightData: {"local":1,"did","cliente","empresa":125}). Sin él no se puede regenerar el QR idéntico.
--  * escaneado_at = reloj del dispositivo al escanear (puede subir horas después); subido_at = del servidor.
--  * borrado_at: "quitar" un escaneo cargado por error es borrado lógico (para que se sincronice entre dispositivos).
--  * reesc_at / reesc_por: el QR se MOSTRÓ en pantalla para re-escanearlo. NO significa que LightData lo
--    haya registrado: el sistema no lo puede saber. La primera marca gana (la app manda PATCH … reesc_at=is.null).
--
-- RLS: solo usuarios con sesión (authenticated) leen y escriben. Nada anónimo.
-- Idempotente. No toca otras tablas.

create table if not exists public.contingencia_escaneos (
  id uuid primary key,
  qr text not null,
  codigo text not null,
  sender_id text,
  tipo text not null check (tipo in ('ml', 'ld', 'texto')),
  modo text not null check (modo in ('colecta', 'ingreso', 'salida')),
  persona text,                -- chofer (colecta) o cadete (salida); null en ingreso
  cliente text,                -- deducido de ml_vendedores al escanear; null = sin identificar (queda sender_id)
  escaneado_por text,          -- usuario logueado en el dispositivo
  escaneado_at timestamptz not null,
  tanda text not null,         -- una tanda = una sesión de escaneo (modo + persona) en un dispositivo
  subido_at timestamptz not null default now(),
  borrado_at timestamptz,
  reesc_at timestamptz,
  reesc_por text
);

comment on table public.contingencia_escaneos is
  'Modo contingencia: QR escaneados en la app mientras LightData no anda. qr = texto crudo para regenerarlo y re-escanearlo con la app de LightData. reesc_at = se mostró en pantalla, no confirmación de LightData.';
comment on column public.contingencia_escaneos.reesc_at is
  'Momento en que el QR se mostró en pantalla para re-escanearlo con LightData. No confirma que LightData lo haya registrado.';

create index if not exists contingencia_escaneos_fecha on public.contingencia_escaneos (escaneado_at);
create index if not exists contingencia_escaneos_tanda on public.contingencia_escaneos (tanda);
create index if not exists contingencia_escaneos_codigo on public.contingencia_escaneos (codigo);
create index if not exists contingencia_escaneos_pendientes on public.contingencia_escaneos (modo, persona)
  where borrado_at is null and reesc_at is null;

alter table public.contingencia_escaneos enable row level security;

drop policy if exists "equipo lee" on public.contingencia_escaneos;
create policy "equipo lee" on public.contingencia_escaneos
  for select to authenticated using (true);

drop policy if exists "equipo carga" on public.contingencia_escaneos;
create policy "equipo carga" on public.contingencia_escaneos
  for insert to authenticated with check (true);

drop policy if exists "equipo marca" on public.contingencia_escaneos;
create policy "equipo marca" on public.contingencia_escaneos
  for update to authenticated using (true) with check (true);

-- Sin política de DELETE a propósito: quitar un escaneo es borrado_at (borrado lógico).

revoke all on public.contingencia_escaneos from anon;
grant select, insert, update on public.contingencia_escaneos to authenticated;
