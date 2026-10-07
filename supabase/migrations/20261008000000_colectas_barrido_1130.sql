-- Barrido de colectas 11:30 (2026-10-08)
-- A las 11:30 (lun-vie, no feriados) deja una nota en la Pizarra con los clientes de CABA que tienen
-- el bot prendido y todavía no respondieron el link, para que el equipo les pregunte a mano antes de
-- las 13. Si respondieron todos, no deja nada. Una sola nota por día (si se corre de nuevo, la actualiza).

create or replace function public.colecta_bot_barrido()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  hoy date := ar_now()::date; nombres text; n int; txt text; existente bigint;
begin
  if extract(isodow from ar_now()) > 5 then return 0; end if;
  if exists (select 1 from feriados where fecha = hoy) then return 0; end if;

  select count(*), string_agg(cl.nombre, ', ' order by cl.nombre) into n, nombres
    from colectas_clientes cl
   where cl.activo and cl.bot_habilitado and not coalesce(cl.fija, false) and not coalesce(cl.bot_prueba, false)
     and not exists (select 1 from colectas_registros r where r.cliente_id = cl.id and r.fecha = hoy
                      and coalesce(r.estado, 'blanco') <> 'blanco');

  select id into existente from notas_operativas
   where autor = 'Bot colectas' and fecha_objetivo = hoy and resuelta_at is null limit 1;

  if n = 0 then
    if existente is not null then
      update notas_operativas set resuelta_por = 'Bot colectas', resuelta_at = now() where id = existente;
    end if;
    return 0;
  end if;

  txt := '🔗 No respondieron el link (' || n || '): ' || nombres || '. Preguntarles a mano.';
  if existente is not null then
    update notas_operativas set texto = txt where id = existente;
  else
    insert into notas_operativas (texto, tipo, prioridad, hora_limite, fecha_objetivo, autor)
    values (txt, 'aviso', 'hora', '13:00', hoy, 'Bot colectas');
  end if;
  return n;
end $$;
revoke all on function public.colecta_bot_barrido() from public, anon, authenticated;

-- 11:30 AR = 14:30 UTC, lunes a viernes
select cron.unschedule('colectas_bot_barrido') where exists (select 1 from cron.job where jobname = 'colectas_bot_barrido');
select cron.schedule('colectas_bot_barrido', '30 14 * * 1-5', $$select public.colecta_bot_barrido()$$);
