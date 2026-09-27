create table if not exists public.staff_activity (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_name text not null,
  actor_email text not null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  entity_type text not null,
  entity_id text,
  summary text not null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

comment on table public.staff_activity is
  'Journal immuable des actions effectuées par les comptes administrateur et employés.';

create index if not exists staff_activity_created_at_idx
  on public.staff_activity (created_at desc);
create index if not exists staff_activity_actor_created_at_idx
  on public.staff_activity (actor_user_id, created_at desc);
create index if not exists staff_activity_entity_idx
  on public.staff_activity (entity_type, entity_id);

alter table public.staff_activity enable row level security;
revoke all on table public.staff_activity from anon;
revoke insert, update, delete on table public.staff_activity from authenticated;
grant select on table public.staff_activity to authenticated;

drop policy if exists "Admins read staff activity" on public.staff_activity;
create policy "Admins read staff activity"
on public.staff_activity for select to authenticated
using ((select private.staff_can('staff')));

create or replace function private.log_staff_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_id uuid := (select auth.uid());
  actor record;
  before_data jsonb;
  after_data jsonb;
  record_id text;
  label text;
begin
  if actor_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select account.nom, account.email into actor
  from public.staff_accounts account
  where account.auth_user_id = actor_id and account.active = true
  limit 1;

  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  before_data := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
  after_data := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end;
  record_id := coalesce(after_data->>'id', before_data->>'id', after_data->>'reservation_id', before_data->>'reservation_id', 'sans-identifiant');
  label := case tg_table_name
    when 'clients' then 'Client'
    when 'reservations' then 'Réservation'
    when 'paiements' then 'Paiement'
    when 'materiel' then 'Matériel'
    when 'mouvements_stock' then 'Mouvement de stock'
    when 'demandes_reservation' then 'Demande client'
    when 'factures' then 'Facture'
    when 'admin_missions' then 'Document de mission'
    when 'staff_accounts' then 'Compte employé'
    else tg_table_name
  end;

  insert into public.staff_activity (
    actor_user_id, actor_name, actor_email, action, entity_type,
    entity_id, summary, old_values, new_values
  ) values (
    actor_id, coalesce(actor.nom, actor.email), actor.email, tg_op,
    tg_table_name, record_id,
    label || case tg_op when 'INSERT' then ' créé' when 'UPDATE' then ' modifié' else ' supprimé' end,
    before_data, after_data
  );

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

revoke all on function private.log_staff_activity() from public, anon, authenticated;

drop trigger if exists log_staff_activity on public.clients;
create trigger log_staff_activity after insert or update or delete on public.clients for each row execute function private.log_staff_activity();
drop trigger if exists log_staff_activity on public.reservations;
create trigger log_staff_activity after insert or update or delete on public.reservations for each row execute function private.log_staff_activity();
drop trigger if exists log_staff_activity on public.paiements;
create trigger log_staff_activity after insert or update or delete on public.paiements for each row execute function private.log_staff_activity();
drop trigger if exists log_staff_activity on public.materiel;
create trigger log_staff_activity after insert or update or delete on public.materiel for each row execute function private.log_staff_activity();
drop trigger if exists log_staff_activity on public.mouvements_stock;
create trigger log_staff_activity after insert or update or delete on public.mouvements_stock for each row execute function private.log_staff_activity();
drop trigger if exists log_staff_activity on public.demandes_reservation;
create trigger log_staff_activity after insert or update or delete on public.demandes_reservation for each row execute function private.log_staff_activity();
drop trigger if exists log_staff_activity on public.factures;
create trigger log_staff_activity after insert or update or delete on public.factures for each row execute function private.log_staff_activity();
drop trigger if exists log_staff_activity on public.admin_missions;
create trigger log_staff_activity after insert or update or delete on public.admin_missions for each row execute function private.log_staff_activity();
drop trigger if exists log_staff_activity on public.staff_accounts;
create trigger log_staff_activity after insert or update or delete on public.staff_accounts for each row execute function private.log_staff_activity();
