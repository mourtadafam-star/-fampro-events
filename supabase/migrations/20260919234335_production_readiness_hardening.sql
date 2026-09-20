-- Production hardening. Applied through the Supabase migration workflow.
-- This migration does not delete business rows or rewrite production data.

-- Rebuild the ownership boundary from source control so a restored environment
-- cannot accidentally expose customer or finance tables through PostgREST.
do $$
declare policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('clients','demandes_reservation','reservations','paiements','factures')
  loop
    execute format('drop policy if exists %I on public.%I', policy_row.policyname, policy_row.tablename);
  end loop;
end
$$;

alter table public.clients enable row level security;
alter table public.demandes_reservation enable row level security;
alter table public.reservations enable row level security;
alter table public.paiements enable row level security;
alter table public.factures enable row level security;

revoke all on public.clients, public.reservations, public.paiements, public.factures from anon;
revoke all on public.demandes_reservation from anon;
grant select, insert, update, delete on public.clients, public.reservations,
  public.paiements, public.factures to authenticated;
grant select, update, delete on public.demandes_reservation to authenticated;

create unique index if not exists clients_auth_user_id_key
  on public.clients(auth_user_id) where auth_user_id is not null;

create policy "Clients read own profile or admin"
on public.clients for select to authenticated
using (
  auth_user_id = (select auth.uid())
  or (select auth.jwt()->>'email') = 'mourtadafam@gmail.com'
);
create policy "Clients create own profile or admin"
on public.clients for insert to authenticated
with check (
  auth_user_id = (select auth.uid())
  or (select auth.jwt()->>'email') = 'mourtadafam@gmail.com'
);
create policy "Clients update own profile or admin"
on public.clients for update to authenticated
using (
  auth_user_id = (select auth.uid())
  or (select auth.jwt()->>'email') = 'mourtadafam@gmail.com'
)
with check (
  auth_user_id = (select auth.uid())
  or (select auth.jwt()->>'email') = 'mourtadafam@gmail.com'
);
create policy "Admin deletes clients"
on public.clients for delete to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');

create policy "Customers read own requests or admin"
on public.demandes_reservation for select to authenticated
using (
  client_user_id = (select auth.uid())
  or (select auth.jwt()->>'email') = 'mourtadafam@gmail.com'
);
create policy "Admin updates requests"
on public.demandes_reservation for update to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');
create policy "Admin deletes requests"
on public.demandes_reservation for delete to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');

-- Public requests enter through an Edge Function. The private tables are not
-- exposed by the Data API and hold only hashed abuse-control identifiers.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.reservation_request_rate_limits (
  id bigint generated always as identity primary key,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz not null default now()
);
create index if not exists reservation_request_rate_limits_lookup_idx
  on private.reservation_request_rate_limits(request_hash, requested_at desc);
alter table private.reservation_request_rate_limits enable row level security;

create table if not exists private.reservation_request_idempotency (
  idempotency_key uuid primary key,
  reservation_request_id uuid not null references public.demandes_reservation(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table private.reservation_request_idempotency enable row level security;

create or replace function public.submit_public_reservation_request(
  p_payload jsonb,
  p_request_hash text,
  p_idempotency_key uuid,
  p_client_user_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  created_id uuid;
  request_date date;
  request_email text;
  request_location text;
  request_message text;
  request_latitude double precision;
  request_longitude double precision;
begin
  if p_idempotency_key is null or p_request_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'Demande invalide';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key::text, 3));
  select reservation_request_id into existing_id
  from private.reservation_request_idempotency
  where idempotency_key = p_idempotency_key;
  if existing_id is not null then return existing_id; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_hash, 4));
  delete from private.reservation_request_rate_limits
  where request_hash = p_request_hash and requested_at < now() - interval '24 hours';
  if (
    select count(*) from private.reservation_request_rate_limits
    where request_hash = p_request_hash and requested_at >= now() - interval '15 minutes'
  ) >= 5 then
    raise exception 'Trop de demandes. Réessayez dans quelques minutes.';
  end if;

  if char_length(trim(coalesce(p_payload->>'nom', ''))) not between 2 and 120
     or char_length(trim(coalesce(p_payload->>'telephone', ''))) not between 6 and 30
     or char_length(trim(coalesce(p_payload->>'type_evenement', ''))) not between 2 and 80 then
    raise exception 'Nom, téléphone ou type d’événement invalide';
  end if;

  request_email := nullif(trim(p_payload->>'email'), '');
  request_location := nullif(trim(p_payload->>'lieu'), '');
  request_message := nullif(trim(p_payload->>'message'), '');
  request_date := nullif(p_payload->>'date_souhaitee', '')::date;
  request_latitude := nullif(p_payload->>'latitude', '')::double precision;
  request_longitude := nullif(p_payload->>'longitude', '')::double precision;
  if char_length(coalesce(request_email, '')) > 254
     or char_length(coalesce(request_location, '')) > 180
     or char_length(coalesce(request_message, '')) > 1000
     or (request_latitude is not null and request_latitude not between -90 and 90)
     or (request_longitude is not null and request_longitude not between -180 and 180) then
    raise exception 'Contenu de la demande invalide';
  end if;

  insert into public.demandes_reservation(
    nom, telephone, email, type_evenement, date_souhaitee, lieu, message,
    client_user_id, latitude, longitude
  ) values (
    trim(p_payload->>'nom'), trim(p_payload->>'telephone'), request_email,
    trim(p_payload->>'type_evenement'), request_date, request_location, request_message,
    p_client_user_id, request_latitude, request_longitude
  ) returning id into created_id;

  insert into private.reservation_request_idempotency(idempotency_key, reservation_request_id)
  values(p_idempotency_key, created_id);
  insert into private.reservation_request_rate_limits(request_hash) values(p_request_hash);
  return created_id;
end
$$;
revoke all on function public.submit_public_reservation_request(jsonb,text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.submit_public_reservation_request(jsonb,text,uuid,uuid) to service_role;

create policy "Customers read own reservations or admin"
on public.reservations for select to authenticated
using (
  (select auth.jwt()->>'email') = 'mourtadafam@gmail.com'
  or exists (
    select 1 from public.clients customer
    where customer.id = reservations.client_id
      and customer.auth_user_id = (select auth.uid())
  )
);
create policy "Admin manages reservations"
on public.reservations for all to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');

create policy "Customers read own payments or admin"
on public.paiements for select to authenticated
using (
  (select auth.jwt()->>'email') = 'mourtadafam@gmail.com'
  or exists (
    select 1
    from public.reservations reservation
    join public.clients customer on customer.id = reservation.client_id
    where reservation.id = paiements.reservation_id
      and customer.auth_user_id = (select auth.uid())
  )
);
create policy "Admin manages payments"
on public.paiements for all to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');

create policy "Customers read own invoices or admin"
on public.factures for select to authenticated
using (
  (select auth.jwt()->>'email') = 'mourtadafam@gmail.com'
  or exists (
    select 1
    from public.reservations reservation
    join public.clients customer on customer.id = reservation.client_id
    where reservation.id = factures.reservation_id
      and customer.auth_user_id = (select auth.uid())
  )
);
create policy "Admin manages invoices"
on public.factures for all to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');

-- Keep the remaining administrator policies efficient and avoid overlapping
-- SELECT policies on the public catalogue.
drop policy if exists "FAMpro admin manages material" on public.materiel;
create policy "FAMpro admin inserts material"
on public.materiel for insert to authenticated
with check ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');
create policy "FAMpro admin updates material"
on public.materiel for update to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');
create policy "FAMpro admin deletes material"
on public.materiel for delete to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');

drop policy if exists "FAMpro admin manages stock movements" on public.mouvements_stock;
create policy "FAMpro admin manages stock movements"
on public.mouvements_stock for all to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');

drop policy if exists "Admin manages mission documents" on public.admin_missions;
create policy "Admin manages mission documents"
on public.admin_missions for all to authenticated
using ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt()->>'email') = 'mourtadafam@gmail.com');

create index if not exists evenements_client_id_idx on public.evenements(client_id);

-- Public callers receive only aggregate stock for a date, never reservation rows.
create or replace function public.get_material_availability(p_date date)
returns table(materiel_id uuid, quantite_restante numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with reserved as (
    select (item->>'id')::uuid as materiel_id,
           sum((item->>'quantite')::numeric) as quantity
    from public.reservations reservation
    cross join lateral jsonb_array_elements(coalesce(reservation.materiel_reserve, '[]'::jsonb)) item
    where reservation.date_evenement = p_date
      and lower(coalesce(reservation.statut, '')) !~ '(annul|refus)'
      and item ? 'id' and item ? 'quantite'
    group by (item->>'id')::uuid
  )
  select material.id,
         greatest(coalesce(material.quantite_disponible, 0)::numeric - coalesce(reserved.quantity, 0), 0)
  from public.materiel material
  left join reserved on reserved.materiel_id = material.id
  where p_date is not null
  order by material.id
$$;
revoke all on function public.get_material_availability(date) from public;
grant execute on function public.get_material_availability(date) to anon, authenticated;

-- The old application rule allowed only one event per day. Capacity is now
-- enforced per material, permitting several events when stock is sufficient.
drop index if exists public.reservations_one_active_client_per_day;

create or replace function public.admin_create_reservation(p_data jsonb, p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cid uuid;
  d date;
  amount numeric;
  deposit numeric;
  requested_user uuid;
  source_request uuid;
  item record;
  available numeric;
  already_reserved numeric;
begin
  if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then
    raise exception 'Accès administrateur requis';
  end if;
  if p_id is null or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Données de réservation invalides';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  if exists(select 1 from public.reservations where id = p_id) then return p_id; end if;

  d := nullif(p_data->>'date_evenement', '')::date;
  amount := (p_data->>'montant_total')::numeric;
  deposit := (p_data->>'montant_paye')::numeric;
  requested_user := nullif(p_data->>'client_user_id', '')::uuid;
  source_request := nullif(p_data->>'request_id', '')::uuid;
  if nullif(trim(p_data->>'client_nom'), '') is null or d is null then
    raise exception 'Nom du client et date obligatoires';
  end if;
  if amount is null or deposit is null or amount < 0 or deposit < 0 or deposit > amount
     or amount::text in ('NaN','Infinity','-Infinity')
     or deposit::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Montants invalides';
  end if;
  if coalesce(p_data->>'statut', 'En attente') not in ('En attente','Confirmée','Terminée') then
    raise exception 'Statut de réservation invalide';
  end if;
  if jsonb_typeof(coalesce(p_data->'materiel_reserve', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Liste de matériel invalide';
  end if;

  -- One date lock serializes every capacity calculation for that date.
  perform pg_advisory_xact_lock(hashtextextended(d::text, 1));
  for item in
    select (entry->>'id')::uuid as material_id,
           sum((entry->>'quantite')::numeric) as requested
    from jsonb_array_elements(coalesce(p_data->'materiel_reserve', '[]'::jsonb)) entry
    group by (entry->>'id')::uuid
    order by (entry->>'id')::uuid
  loop
    if item.requested is null or item.requested <= 0 or trunc(item.requested) <> item.requested then
      raise exception 'Quantité de matériel invalide';
    end if;
    select material.quantite_disponible into available
    from public.materiel material where material.id = item.material_id for update;
    if not found then raise exception 'Matériel introuvable'; end if;
    select coalesce(sum((reserved_item->>'quantite')::numeric), 0) into already_reserved
    from public.reservations reservation
    cross join lateral jsonb_array_elements(coalesce(reservation.materiel_reserve, '[]'::jsonb)) reserved_item
    where reservation.date_evenement = d
      and lower(coalesce(reservation.statut, '')) !~ '(annul|refus)'
      and (reserved_item->>'id')::uuid = item.material_id;
    if item.requested > greatest(coalesce(available, 0) - already_reserved, 0) then
      raise exception 'Quantité de matériel indisponible';
    end if;
  end loop;

  if p_data->>'client_id' = 'new' then
    if requested_user is not null then
      select id into cid from public.clients where auth_user_id = requested_user limit 1;
    end if;
    if cid is null then
      insert into public.clients(nom, telephone, adresse, auth_user_id)
      values(p_data->>'client_nom', p_data->>'telephone', p_data->>'adresse', requested_user)
      returning id into cid;
    end if;
  else
    cid := (p_data->>'client_id')::uuid;
  end if;

  insert into public.reservations(
    id, client_id, client_nom, type_evenement, date_evenement, lieu,
    montant_total, montant_paye, statut, chaises, matelas, notes, materiel_reserve
  ) values (
    p_id, cid, p_data->>'client_nom', p_data->>'type_evenement', d, p_data->>'lieu',
    amount, deposit, coalesce(p_data->>'statut','En attente'),
    coalesce((p_data->>'chaises')::integer, 0), coalesce((p_data->>'matelas')::integer, 0),
    p_data->>'notes', coalesce(p_data->'materiel_reserve', '[]'::jsonb)
  );
  for item in
    select (entry->>'id')::uuid as material_id,
           sum((entry->>'quantite')::numeric) as requested
    from jsonb_array_elements(coalesce(p_data->'materiel_reserve', '[]'::jsonb)) entry
    group by (entry->>'id')::uuid
  loop
    insert into public.mouvements_stock(materiel_id, type, quantite, motif)
    values(item.material_id, 'Sortie', item.requested, 'Réservation : '||coalesce(p_data->>'type_evenement','Événement')||' · '||d::text);
  end loop;
  if deposit > 0 then
    insert into public.paiements(reservation_id, montant, date_paiement, mode_paiement)
    values(p_id, deposit, current_date, 'Espèces');
  end if;
  if source_request is not null then
    update public.demandes_reservation set statut = 'Confirmée' where id = source_request;
  end if;
  return p_id;
end
$$;

create or replace function public.admin_record_payment(p_reservation uuid, p_amount numeric, p_method text, p_id uuid)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare r public.reservations; existing public.paiements;
begin
  if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then raise exception 'Accès administrateur requis'; end if;
  select * into r from public.reservations where id = p_reservation for update;
  if not found then raise exception 'Réservation introuvable'; end if;
  if lower(coalesce(r.statut, '')) ~ '(annul|refus)' then raise exception 'Aucun paiement ne peut être ajouté à une réservation annulée ou refusée'; end if;
  select * into existing from public.paiements where id = p_id;
  if found then
    if existing.reservation_id = p_reservation and existing.montant = p_amount and existing.mode_paiement = p_method then return p_id; end if;
    raise exception 'Identifiant de paiement déjà utilisé';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount::text in ('NaN','Infinity','-Infinity')
     or p_amount > coalesce(r.montant_total,0)-coalesce(r.montant_paye,0) then raise exception 'Montant invalide ou supérieur au solde'; end if;
  if p_method is null or p_method not in ('Espèces','Wave','Orange Money') then raise exception 'Mode de paiement invalide'; end if;
  insert into public.paiements(id,reservation_id,montant,mode_paiement,date_paiement)
  values(p_id,p_reservation,p_amount,p_method,current_date);
  update public.reservations set montant_paye=coalesce(montant_paye,0)+p_amount where id=p_reservation;
  return p_id;
end
$$;

create or replace function public.admin_delete_reservation(p_reservation uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare r public.reservations;
begin
  if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then raise exception 'Accès administrateur requis'; end if;
  select * into r from public.reservations where id = p_reservation for update;
  if not found then raise exception 'Réservation introuvable'; end if;
  if lower(coalesce(r.statut, '')) !~ '(annul|refus)' then
    raise exception 'Annulez la réservation avant de la supprimer afin de restituer le stock';
  end if;
  delete from public.reservations where id = p_reservation;
end
$$;

revoke all on function public.admin_create_reservation(jsonb,uuid) from public,anon;
revoke all on function public.admin_record_payment(uuid,numeric,text,uuid) from public,anon;
revoke all on function public.admin_delete_reservation(uuid) from public,anon;
grant execute on function public.admin_create_reservation(jsonb,uuid) to authenticated;
grant execute on function public.admin_record_payment(uuid,numeric,text,uuid) to authenticated;
grant execute on function public.admin_delete_reservation(uuid) to authenticated;

-- Realtime delivery still obeys table RLS. Add only missing publication members.
do $$
declare table_name text;
begin
  foreach table_name in array array['clients','reservations','paiements','materiel'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;
