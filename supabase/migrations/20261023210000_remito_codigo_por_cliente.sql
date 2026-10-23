-- Código de remito = nombre del cliente + número correlativo por cliente (Casper-01). Los RD-xxxxx viejos quedan igual.
create or replace function public.remito_codigo() returns trigger language plpgsql set search_path = public as $$
declare base text; n int;
begin
  if new.codigo is not null then return new; end if;
  base := translate(coalesce(new.cliente, ''), 'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ', 'aeiouaeiouaeiouaeiouncAEIOUAEIOUAEIOUAEIOUNC');
  base := replace(initcap(regexp_replace(base, '[^A-Za-z0-9]+', ' ', 'g')), ' ', '');
  base := left(base, 18);
  if base = '' then base := 'Remito'; end if;
  perform pg_advisory_xact_lock(hashtext('remito_codigo:' || lower(base)));
  select coalesce(max(substring(codigo from '-(\d+)$')::int), 0) + 1 into n
    from remitos_devolucion where lower(codigo) ~ ('^' || lower(base) || '-\d+$');
  new.codigo := base || '-' || lpad(n::text, 2, '0');
  return new;
end $$;
