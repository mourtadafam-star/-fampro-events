-- A client submission and its pending reservation are one atomic operation.
-- The shared UUID makes retries and the admin link unambiguous.
create or replace function private.ensure_pending_reservation(p_request public.demandes_reservation)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_client uuid;
begin
  if p_request.client_user_id is not null then
    select id into linked_client
    from public.clients
    where auth_user_id = p_request.client_user_id
    limit 1;
  end if;

  if linked_client is null then
    insert into public.clients(nom, telephone, email, adresse, auth_user_id)
    values(p_request.nom, p_request.telephone, p_request.email, p_request.lieu, p_request.client_user_id)
    on conflict (auth_user_id) do update
      set auth_user_id = excluded.auth_user_id
    returning id into linked_client;
  end if;

  insert into public.reservations(
    id, client_id, client_nom, type_evenement, date_evenement, lieu,
    montant_total, montant_paye, statut, notes, materiel_reserve
  ) values (
    p_request.id, linked_client, p_request.nom, p_request.type_evenement, p_request.date_souhaitee, p_request.lieu,
    0, 0, 'En attente', p_request.message, '[]'::jsonb
  ) on conflict (id) do nothing;
end;
$$;

revoke all on function private.ensure_pending_reservation(public.demandes_reservation) from public, anon, authenticated;

create or replace function private.create_pending_reservation_from_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_pending_reservation(new);
  return new;
end;
$$;

revoke all on function private.create_pending_reservation_from_request() from public, anon, authenticated;

create trigger create_pending_reservation_from_request
after insert on public.demandes_reservation
for each row execute function private.create_pending_reservation_from_request();

-- Bring existing client requests into the same view without changing their original status.
do $$
declare
  request_row public.demandes_reservation;
begin
  for request_row in
    select request.* from public.demandes_reservation request
    where not exists (select 1 from public.reservations reservation where reservation.id = request.id)
    order by request.created_at
  loop
    perform private.ensure_pending_reservation(request_row);
  end loop;
end;
$$;
