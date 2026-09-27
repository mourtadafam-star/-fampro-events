-- Make the employee access model reproducible and enforce it in Postgres.
-- This migration is intentionally idempotent so it also hardens projects where
-- the first staff objects were created manually before they were versioned.

create schema if not exists private;
revoke all on schema private from public, anon;

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete restrict,
  email text not null,
  nom text not null,
  telephone text,
  role text not null default 'employee' check (role in ('admin','employee')),
  active boolean not null default true,
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  invited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_accounts add column if not exists telephone text;
alter table public.staff_accounts add column if not exists role text not null default 'employee';
alter table public.staff_accounts add column if not exists active boolean not null default true;
alter table public.staff_accounts add column if not exists permissions jsonb not null default '{}'::jsonb;
alter table public.staff_accounts add column if not exists invited_at timestamptz not null default now();
alter table public.staff_accounts add column if not exists created_at timestamptz not null default now();
alter table public.staff_accounts add column if not exists updated_at timestamptz not null default now();

create unique index if not exists staff_accounts_auth_user_id_key
  on public.staff_accounts (auth_user_id);
create unique index if not exists staff_accounts_email_lower_key
  on public.staff_accounts (lower(email));

create or replace function private.staff_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.staff_accounts account
    where account.auth_user_id = (select auth.uid())
      and account.active = true
      and account.role = 'admin'
  )
$function$;

create or replace function private.staff_can(requested_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.staff_accounts account
    where account.auth_user_id = (select auth.uid())
      and account.active = true
      and (
        account.role = 'admin'
        or coalesce(account.permissions -> requested_permission, 'false'::jsonb) = 'true'::jsonb
      )
  )
$function$;

revoke all on function private.staff_is_admin() from public, anon;
revoke all on function private.staff_can(text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.staff_is_admin() to authenticated;
grant execute on function private.staff_can(text) to authenticated;

alter table public.staff_accounts enable row level security;
revoke all on table public.staff_accounts from anon, authenticated;
grant select on table public.staff_accounts to authenticated;
drop policy if exists "Staff reads own account or admins read all" on public.staff_accounts;
create policy "Staff reads own account or admins read all"
on public.staff_accounts for select to authenticated
using (
  auth_user_id = (select auth.uid())
  or (select private.staff_is_admin())
);

create or replace function private.bootstrap_fampro_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(coalesce(new.email, '')) = 'mourtadafam@gmail.com' then
    insert into public.staff_accounts (
      auth_user_id, email, nom, role, active, permissions
    ) values (
      new.id,
      new.email,
      coalesce(nullif(new.raw_user_meta_data ->> 'nom', ''), new.email),
      'admin',
      true,
      jsonb_build_object(
        'reservations', true,
        'clients', true,
        'stock', true,
        'paiements', true,
        'rapports', true
      )
    )
    on conflict (auth_user_id) do update
    set role = 'admin', active = true, updated_at = now();
  end if;
  return new;
end
$function$;

revoke all on function private.bootstrap_fampro_admin() from public, anon, authenticated;
drop trigger if exists bootstrap_fampro_admin on auth.users;
create trigger bootstrap_fampro_admin
after insert or update of email on auth.users
for each row execute function private.bootstrap_fampro_admin();

insert into public.staff_accounts (
  auth_user_id, email, nom, role, active, permissions
)
select
  id,
  email,
  coalesce(nullif(raw_user_meta_data ->> 'nom', ''), email),
  'admin',
  true,
  jsonb_build_object(
    'reservations', true,
    'clients', true,
    'stock', true,
    'paiements', true,
    'rapports', true
  )
from auth.users
where lower(email) = 'mourtadafam@gmail.com'
on conflict (auth_user_id) do update
set role = 'admin', active = true, updated_at = now();

create or replace function public.admin_register_staff_account(
  p_auth_user_id uuid,
  p_email text,
  p_nom text,
  p_telephone text default null,
  p_permissions jsonb default '{}'::jsonb
)
returns public.staff_accounts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  registered public.staff_accounts;
  normalized_permissions jsonb;
begin
  if not (select private.staff_is_admin()) then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  if p_auth_user_id is null
     or char_length(trim(coalesce(p_nom, ''))) not between 2 and 120
     or char_length(trim(coalesce(p_email, ''))) not between 3 and 254
     or char_length(trim(coalesce(p_telephone, ''))) > 30
     or not exists (
       select 1 from auth.users user_account
       where user_account.id = p_auth_user_id
         and lower(user_account.email) = lower(trim(p_email))
     ) then
    raise exception 'Compte employé invalide';
  end if;

  normalized_permissions := jsonb_build_object(
    'reservations', coalesce(p_permissions -> 'reservations', 'false'::jsonb) = 'true'::jsonb,
    'clients', coalesce(p_permissions -> 'clients', 'false'::jsonb) = 'true'::jsonb,
    'stock', coalesce(p_permissions -> 'stock', 'false'::jsonb) = 'true'::jsonb,
    'paiements', coalesce(p_permissions -> 'paiements', 'false'::jsonb) = 'true'::jsonb,
    'rapports', coalesce(p_permissions -> 'rapports', 'false'::jsonb) = 'true'::jsonb
  );

  insert into public.staff_accounts (
    auth_user_id, email, nom, telephone, role, active, permissions
  ) values (
    p_auth_user_id, lower(trim(p_email)), trim(p_nom), nullif(trim(p_telephone), ''),
    'employee', true, normalized_permissions
  )
  on conflict (auth_user_id) do update
  set email = excluded.email,
      nom = excluded.nom,
      telephone = excluded.telephone,
      permissions = excluded.permissions,
      active = true,
      updated_at = now()
  where public.staff_accounts.role = 'employee'
  returning * into registered;

  if registered.id is null then
    raise exception 'Un compte administrateur ne peut pas être remplacé';
  end if;
  return registered;
end
$function$;

create or replace function public.admin_set_staff_active(
  p_staff_id uuid,
  p_active boolean
)
returns public.staff_accounts
language plpgsql
security definer
set search_path = ''
as $function$
declare
  changed public.staff_accounts;
begin
  if not (select private.staff_is_admin()) then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;
  update public.staff_accounts
  set active = p_active, updated_at = now()
  where id = p_staff_id and role = 'employee'
  returning * into changed;
  if changed.id is null then
    raise exception 'Compte employé introuvable';
  end if;
  return changed;
end
$function$;

revoke all on function public.admin_register_staff_account(uuid,text,text,text,jsonb) from public, anon;
revoke all on function public.admin_set_staff_active(uuid,boolean) from public, anon;
grant execute on function public.admin_register_staff_account(uuid,text,text,text,jsonb) to authenticated;
grant execute on function public.admin_set_staff_active(uuid,boolean) to authenticated;

-- Existing customer policies remain in place. These additional policies grant
-- only the operations selected for active employee accounts.
grant select, insert, update, delete on public.clients, public.reservations,
  public.paiements, public.factures to authenticated;
grant select, update, delete on public.demandes_reservation to authenticated;
grant select, insert, update, delete on public.materiel, public.mouvements_stock,
  public.admin_missions to authenticated;

drop policy if exists "Staff with client access reads clients" on public.clients;
create policy "Staff with client access reads clients" on public.clients
for select to authenticated using (
  (select private.staff_can('clients'))
  or (select private.staff_can('reservations'))
  or (select private.staff_can('rapports'))
);
drop policy if exists "Staff with client access creates clients" on public.clients;
create policy "Staff with client access creates clients" on public.clients
for insert to authenticated with check (
  (select private.staff_can('clients')) or (select private.staff_can('reservations'))
);
drop policy if exists "Staff with client access updates clients" on public.clients;
create policy "Staff with client access updates clients" on public.clients
for update to authenticated
using ((select private.staff_can('clients')))
with check ((select private.staff_can('clients')));
drop policy if exists "Staff with client access deletes clients" on public.clients;
create policy "Staff with client access deletes clients" on public.clients
for delete to authenticated using ((select private.staff_can('clients')));

drop policy if exists "Staff manages reservations" on public.reservations;
create policy "Staff manages reservations" on public.reservations
for all to authenticated
using ((select private.staff_can('reservations')))
with check ((select private.staff_can('reservations')));
drop policy if exists "Staff with reports access reads reservations" on public.reservations;
create policy "Staff with reports access reads reservations" on public.reservations
for select to authenticated using ((select private.staff_can('rapports')));

drop policy if exists "Staff manages client requests" on public.demandes_reservation;
create policy "Staff manages client requests" on public.demandes_reservation
for all to authenticated
using ((select private.staff_can('reservations')))
with check ((select private.staff_can('reservations')));

drop policy if exists "Staff manages payments" on public.paiements;
create policy "Staff manages payments" on public.paiements
for all to authenticated
using ((select private.staff_can('paiements')))
with check ((select private.staff_can('paiements')));
drop policy if exists "Staff with reports access reads payments" on public.paiements;
create policy "Staff with reports access reads payments" on public.paiements
for select to authenticated using ((select private.staff_can('rapports')));

drop policy if exists "Staff manages invoices" on public.factures;
create policy "Staff manages invoices" on public.factures
for all to authenticated
using ((select private.staff_can('paiements')))
with check ((select private.staff_can('paiements')));
drop policy if exists "Staff with reservation access reads invoices" on public.factures;
create policy "Staff with reservation access reads invoices" on public.factures
for select to authenticated using ((select private.staff_can('reservations')));
drop policy if exists "Staff with reservation access updates invoices" on public.factures;
create policy "Staff with reservation access updates invoices" on public.factures
for update to authenticated
using ((select private.staff_can('reservations')))
with check ((select private.staff_can('reservations')));

drop policy if exists "Staff manages material" on public.materiel;
create policy "Staff manages material" on public.materiel
for all to authenticated
using ((select private.staff_can('stock')))
with check ((select private.staff_can('stock')));

drop policy if exists "Staff manages stock movements" on public.mouvements_stock;
create policy "Staff manages stock movements" on public.mouvements_stock
for all to authenticated
using ((select private.staff_can('stock')))
with check ((select private.staff_can('stock')));

drop policy if exists "Staff manages mission documents" on public.admin_missions;
create policy "Staff manages mission documents" on public.admin_missions
for all to authenticated
using ((select private.staff_can('reservations')))
with check ((select private.staff_can('reservations')));

drop policy if exists "Staff with stock access adds material images" on storage.objects;
drop policy if exists "Staff with stock access reads material images" on storage.objects;
create policy "Staff with stock access reads material images" on storage.objects
for select to authenticated
using (bucket_id = 'materiel-images' and (select private.staff_can('stock')));
create policy "Staff with stock access adds material images" on storage.objects
for insert to authenticated
with check (bucket_id = 'materiel-images' and (select private.staff_can('stock')));
drop policy if exists "Staff with stock access updates material images" on storage.objects;
create policy "Staff with stock access updates material images" on storage.objects
for update to authenticated
using (bucket_id = 'materiel-images' and (select private.staff_can('stock')))
with check (bucket_id = 'materiel-images' and (select private.staff_can('stock')));
drop policy if exists "Staff with stock access deletes material images" on storage.objects;
create policy "Staff with stock access deletes material images" on storage.objects
for delete to authenticated
using (bucket_id = 'materiel-images' and (select private.staff_can('stock')));

drop policy if exists "Admins read staff activity" on public.staff_activity;
create policy "Admins read staff activity"
on public.staff_activity for select to authenticated
using ((select private.staff_is_admin()));

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
  private_fields text[] := array[
    'auth_user_id','client_user_id','email','telephone','adresse',
    'latitude','longitude','message'
  ];
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

  before_data := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) - private_fields else null end;
  after_data := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) - private_fields else null end;
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

-- The atomic workflow functions predate employee accounts and used a fixed
-- administrator e-mail check. Preserve their reviewed transaction logic while
-- replacing only that authorization predicate with the matching permission.
do $block$
declare
  workflow record;
  function_oid regprocedure;
  definition text;
  hardened_definition text;
  legacy_predicate constant text := 'auth.jwt()->>''email'' is distinct from ''mourtadafam@gmail.com''';
begin
  for workflow in
    select * from (values
      ('public.admin_create_reservation(jsonb,uuid)', 'reservations'),
      ('public.admin_update_reservation(uuid,jsonb)', 'reservations'),
      ('public.admin_cancel_reservation(uuid)', 'reservations'),
      ('public.admin_delete_reservation(uuid)', 'reservations'),
      ('public.admin_save_mission(uuid,text,jsonb,integer)', 'reservations'),
      ('public.admin_record_payment(uuid,numeric,text,uuid)', 'paiements')
    ) as functions(signature, permission_name)
  loop
    function_oid := to_regprocedure(workflow.signature);
    if function_oid is null then
      raise exception 'Fonction de workflow absente : %', workflow.signature;
    end if;
    definition := pg_get_functiondef(function_oid);
    if position(legacy_predicate in definition) > 0 then
      hardened_definition := replace(
        definition,
        legacy_predicate,
        format('not (select private.staff_can(%L))', workflow.permission_name)
      );
      execute hardened_definition;
    elsif position('private.staff_can' in definition) = 0 then
      raise exception 'Contrôle d’accès inattendu dans %', workflow.signature;
    end if;
  end loop;
end
$block$;

-- Remove sensitive fields from events produced before this hardening migration.
update public.staff_activity
set old_values = old_values - array[
      'auth_user_id','client_user_id','email','telephone','adresse','latitude','longitude','message'
    ],
    new_values = new_values - array[
      'auth_user_id','client_user_id','email','telephone','adresse','latitude','longitude','message'
    ]
where old_values is not null or new_values is not null;
