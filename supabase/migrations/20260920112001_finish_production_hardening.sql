-- Follow-up applied after live advisor checks. No business rows are modified.
revoke insert on public.demandes_reservation from authenticated;

create index if not exists reservation_request_idempotency_request_idx
  on private.reservation_request_idempotency(reservation_request_id);

drop policy if exists "Clients read own profile or admin" on public.clients;
drop policy if exists "Clients create own profile or admin" on public.clients;
drop policy if exists "Clients update own profile or admin" on public.clients;
drop policy if exists "Admin deletes clients" on public.clients;
create policy "Clients read own profile or admin" on public.clients for select to authenticated
using (auth_user_id = (select auth.uid()) or (select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Clients create own profile or admin" on public.clients for insert to authenticated
with check (auth_user_id = (select auth.uid()) or (select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Clients update own profile or admin" on public.clients for update to authenticated
using (auth_user_id = (select auth.uid()) or (select auth.jwt())->>'email' = 'mourtadafam@gmail.com')
with check (auth_user_id = (select auth.uid()) or (select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin deletes clients" on public.clients for delete to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');

drop policy if exists "Customers read own requests or admin" on public.demandes_reservation;
drop policy if exists "Admin updates requests" on public.demandes_reservation;
drop policy if exists "Admin deletes requests" on public.demandes_reservation;
create policy "Customers read own requests or admin" on public.demandes_reservation for select to authenticated
using (client_user_id = (select auth.uid()) or (select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin updates requests" on public.demandes_reservation for update to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com')
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin deletes requests" on public.demandes_reservation for delete to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');

drop policy if exists "Customers read own reservations or admin" on public.reservations;
drop policy if exists "Admin manages reservations" on public.reservations;
create policy "Customers read own reservations or admin" on public.reservations for select to authenticated
using (
  (select auth.jwt())->>'email' = 'mourtadafam@gmail.com'
  or exists (
    select 1 from public.clients customer
    where customer.id = reservations.client_id and customer.auth_user_id = (select auth.uid())
  )
);
create policy "Admin inserts reservations" on public.reservations for insert to authenticated
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin updates reservations" on public.reservations for update to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com')
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin deletes reservations" on public.reservations for delete to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');

drop policy if exists "Customers read own payments or admin" on public.paiements;
drop policy if exists "Admin manages payments" on public.paiements;
create policy "Customers read own payments or admin" on public.paiements for select to authenticated
using (
  (select auth.jwt())->>'email' = 'mourtadafam@gmail.com'
  or exists (
    select 1 from public.reservations reservation
    join public.clients customer on customer.id = reservation.client_id
    where reservation.id = paiements.reservation_id and customer.auth_user_id = (select auth.uid())
  )
);
create policy "Admin inserts payments" on public.paiements for insert to authenticated
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin updates payments" on public.paiements for update to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com')
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin deletes payments" on public.paiements for delete to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');

drop policy if exists "Customers read own invoices or admin" on public.factures;
drop policy if exists "Admin manages invoices" on public.factures;
create policy "Customers read own invoices or admin" on public.factures for select to authenticated
using (
  (select auth.jwt())->>'email' = 'mourtadafam@gmail.com'
  or exists (
    select 1 from public.reservations reservation
    join public.clients customer on customer.id = reservation.client_id
    where reservation.id = factures.reservation_id and customer.auth_user_id = (select auth.uid())
  )
);
create policy "Admin inserts invoices" on public.factures for insert to authenticated
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin updates invoices" on public.factures for update to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com')
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "Admin deletes invoices" on public.factures for delete to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');

drop policy if exists "FAMpro admin inserts material" on public.materiel;
drop policy if exists "FAMpro admin updates material" on public.materiel;
drop policy if exists "FAMpro admin deletes material" on public.materiel;
create policy "FAMpro admin inserts material" on public.materiel for insert to authenticated
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "FAMpro admin updates material" on public.materiel for update to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com')
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
create policy "FAMpro admin deletes material" on public.materiel for delete to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');

drop policy if exists "FAMpro admin manages stock movements" on public.mouvements_stock;
create policy "FAMpro admin manages stock movements" on public.mouvements_stock for all to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com')
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');

drop policy if exists "Admin manages mission documents" on public.admin_missions;
create policy "Admin manages mission documents" on public.admin_missions for all to authenticated
using ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com')
with check ((select auth.jwt())->>'email' = 'mourtadafam@gmail.com');
