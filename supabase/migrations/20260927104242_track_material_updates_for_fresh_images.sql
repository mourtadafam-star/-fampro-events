alter table public.materiel
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_materiel_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_materiel_updated_at() from public, anon, authenticated;

drop trigger if exists set_materiel_updated_at on public.materiel;
create trigger set_materiel_updated_at
before update on public.materiel
for each row execute function public.set_materiel_updated_at();
