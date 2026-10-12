-- Zona elegida a mano para un backup de la Pizarra (Noroeste/CABA/Sur).
-- Null = la app la deduce del texto con zonas_regiones (Norte+Oeste = Noroeste).
alter table backups_equipo add column if not exists region text check (region in ('NOROESTE','CABA','SUR'));
