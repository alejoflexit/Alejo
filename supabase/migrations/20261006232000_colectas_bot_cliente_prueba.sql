-- Cliente de prueba del bot: bot_prueba=true deja el link siempre abierto (cualquier día/hora) para probar.
-- Aplicada en producción 2026-10-06 junto con la fila "Cliente de prueba (bot)" (CABA, sin grupo: el cron no le manda nada).
alter table public.colectas_clientes add column if not exists bot_prueba boolean not null default false;
-- colecta_link_info: abierto := c.bot_habilitado and (c.bot_prueba or (dow <= 5 and ahora::time < corte));
-- (definición completa aplicada vía migración colectas_bot_cliente_prueba)
