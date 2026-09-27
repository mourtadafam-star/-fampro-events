create schema if not exists private;

create table if not exists public.staff_accounts (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  nom text not null,
  telephone text,
  role text not null default 'employee' check (role in ('admin','employee')),
  active boolean not null default true,
  permissions jsonb not null default '{"reservations":true,"clients":true,"stock":true,"paiements":false,"rapports":false,"parametres":false}'::jsonb,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.staff_accounts (auth_user_id,email,nom,role,active,permissions)
select
  id,
  email,
  coalesce(nullif(raw_user_meta_data ->> 'nom', ''), email),
  'admin',
  true,
  '{"reservations":true,"clients":true,"stock":true,"paiements":true,"rapports":true,"parametres":true,"staff":true}'::jsonb
from auth.users
where lower(email) = 'mourtadafam@gmail.com'
on conflict (auth_user_id) do update set role='admin',active=true,permissions=excluded.permissions;

create or replace function private.staff_can(permission_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff_accounts account
    where account.auth_user_id = (select auth.uid())
      and account.active = true
      and (
        account.role = 'admin'
        or coalesce((account.permissions ->> permission_name)::boolean,false)
      )
  );
$$;

revoke all on function private.staff_can(text) from public;
grant usage on schema private to authenticated;
grant execute on function private.staff_can(text) to authenticated;

grant select,insert,update,delete on public.staff_accounts to authenticated;
alter table public.staff_accounts enable row level security;

create policy "Staff read own account or admin"
on public.staff_accounts for select to authenticated
using (auth_user_id = (select auth.uid()) or (select private.staff_can('staff')));

create policy "Admin creates staff accounts"
on public.staff_accounts for insert to authenticated
with check ((select private.staff_can('staff')));

create policy "Admin updates staff accounts"
on public.staff_accounts for update to authenticated
using ((select private.staff_can('staff')))
with check ((select private.staff_can('staff')));

create policy "Admin deletes staff accounts"
on public.staff_accounts for delete to authenticated
using ((select private.staff_can('staff')) and role <> 'admin');

create policy "Employees read clients"
on public.clients for select to authenticated
using ((select private.staff_can('clients')));
create policy "Employees create clients"
on public.clients for insert to authenticated
with check ((select private.staff_can('clients')));
create policy "Employees update clients"
on public.clients for update to authenticated
using ((select private.staff_can('clients')))
with check ((select private.staff_can('clients')));

create policy "Employees read reservations"
on public.reservations for select to authenticated
using ((select private.staff_can('reservations')));
create policy "Employees create reservations"
on public.reservations for insert to authenticated
with check ((select private.staff_can('reservations')));
create policy "Employees update reservations"
on public.reservations for update to authenticated
using ((select private.staff_can('reservations')))
with check ((select private.staff_can('reservations')));

create policy "Employees read client requests"
on public.demandes_reservation for select to authenticated
using ((select private.staff_can('reservations')));
create policy "Employees update client requests"
on public.demandes_reservation for update to authenticated
using ((select private.staff_can('reservations')))
with check ((select private.staff_can('reservations')));

create policy "Employees create material"
on public.materiel for insert to authenticated
with check ((select private.staff_can('stock')));
create policy "Employees update material"
on public.materiel for update to authenticated
using ((select private.staff_can('stock')))
with check ((select private.staff_can('stock')));

create policy "Employees read stock movements"
on public.mouvements_stock for select to authenticated
using ((select private.staff_can('stock')));
create policy "Employees create stock movements"
on public.mouvements_stock for insert to authenticated
with check ((select private.staff_can('stock')));

create policy "Employees read payments"
on public.paiements for select to authenticated
using ((select private.staff_can('paiements')));
create policy "Employees create payments"
on public.paiements for insert to authenticated
with check ((select private.staff_can('paiements')));
create policy "Employees update payments"
on public.paiements for update to authenticated
using ((select private.staff_can('paiements')))
with check ((select private.staff_can('paiements')));

create policy "Employees read invoices"
on public.factures for select to authenticated
using ((select private.staff_can('paiements')));
create policy "Employees create invoices"
on public.factures for insert to authenticated
with check ((select private.staff_can('paiements')));
create policy "Employees update invoices"
on public.factures for update to authenticated
using ((select private.staff_can('paiements')))
with check ((select private.staff_can('paiements')));
