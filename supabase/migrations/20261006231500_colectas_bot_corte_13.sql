-- Bot de colectas: el corte para responder pasa de 11:30 a 13:00 AR (pedido de Alejo 06/10).
create or replace function public.colecta_link_info(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  c record; r record; hoy date := ar_now()::date; ahora timestamp := ar_now();
  dow int := extract(isodow from ar_now()); abierto boolean; motivo text := null;
  corte time := time '13:00';
  dias text[] := array['lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
  meses text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
begin
  if p_token is null or length(p_token) < 16 then return json_build_object('ok', false, 'motivo', 'link_invalido'); end if;
  select * into c from colectas_clientes where bot_token = p_token and activo;
  if not found then return json_build_object('ok', false, 'motivo', 'link_invalido'); end if;
  select * into r from colectas_registros where cliente_id = c.id and fecha = hoy order by created_at limit 1;
  abierto := c.bot_habilitado and dow <= 5 and ahora::time < corte;
  if not c.bot_habilitado then motivo := 'deshabilitado';
  elsif dow > 5 then motivo := 'fin_de_semana';
  elsif ahora::time >= corte then motivo := 'cerrado'; end if;
  return json_build_object(
    'ok', true,
    'nombre', c.nombre,
    'fecha', hoy,
    'fecha_label', dias[dow] || ' ' || extract(day from hoy)::int || ' de ' || meses[extract(month from hoy)::int],
    'abierto', abierto,
    'motivo', motivo,
    'respuesta', r.link_respuesta,
    'bultos', r.link_bultos
  );
end $$;
