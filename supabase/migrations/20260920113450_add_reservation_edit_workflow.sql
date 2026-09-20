-- Atomic editing workflow for active reservations.
create or replace function public.admin_update_reservation(p_reservation uuid, p_data jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_row public.reservations;
  new_client_id uuid;
  new_date date;
  new_amount numeric;
  item record;
  available numeric;
  already_reserved numeric;
begin
  if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then
    raise exception 'Accès administrateur requis';
  end if;
  if p_reservation is null or jsonb_typeof(p_data) is distinct from 'object' then
    raise exception 'Données de réservation invalides';
  end if;

  select * into current_row from public.reservations where id = p_reservation for update;
  if not found then raise exception 'Réservation introuvable'; end if;
  if lower(coalesce(current_row.statut, '')) ~ '(annul|refus)' then
    raise exception 'Une réservation annulée ou refusée ne peut plus être modifiée';
  end if;

  new_client_id := nullif(p_data->>'client_id', '')::uuid;
  new_date := nullif(p_data->>'date_evenement', '')::date;
  new_amount := (p_data->>'montant_total')::numeric;
  if new_client_id is null or new_date is null or nullif(trim(p_data->>'client_nom'), '') is null then
    raise exception 'Client, nom et date obligatoires';
  end if;
  if not exists(select 1 from public.clients where id = new_client_id) then
    raise exception 'Client introuvable';
  end if;
  if new_amount is null or new_amount < coalesce(current_row.montant_paye, 0)
     or new_amount::text in ('NaN','Infinity','-Infinity') then
    raise exception 'Le total ne peut pas être inférieur au montant déjà payé';
  end if;
  if coalesce(p_data->>'statut', 'En attente') not in ('En attente','Confirmée','Terminée') then
    raise exception 'Statut de réservation invalide';
  end if;
  if jsonb_typeof(coalesce(p_data->'materiel_reserve', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Liste de matériel invalide';
  end if;

  -- Lock both dates in a deterministic order so simultaneous moves cannot deadlock.
  perform pg_advisory_xact_lock(hashtextextended(least(current_row.date_evenement, new_date)::text, 1));
  if current_row.date_evenement is distinct from new_date then
    perform pg_advisory_xact_lock(hashtextextended(greatest(current_row.date_evenement, new_date)::text, 1));
  end if;

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
    where reservation.id <> p_reservation
      and reservation.date_evenement = new_date
      and lower(coalesce(reservation.statut, '')) !~ '(annul|refus)'
      and (reserved_item->>'id')::uuid = item.material_id;
    if item.requested > greatest(coalesce(available, 0) - already_reserved, 0) then
      raise exception 'Quantité de matériel indisponible';
    end if;
  end loop;

  for item in
    with old_items as (
      select (entry->>'id')::uuid material_id, sum((entry->>'quantite')::numeric) quantity
      from jsonb_array_elements(coalesce(current_row.materiel_reserve, '[]'::jsonb)) entry
      group by (entry->>'id')::uuid
    ), new_items as (
      select (entry->>'id')::uuid material_id, sum((entry->>'quantite')::numeric) quantity
      from jsonb_array_elements(coalesce(p_data->'materiel_reserve', '[]'::jsonb)) entry
      group by (entry->>'id')::uuid
    )
    select coalesce(old_items.material_id,new_items.material_id) material_id,
           coalesce(old_items.quantity,0) old_quantity,
           coalesce(new_items.quantity,0) new_quantity
    from old_items full join new_items using(material_id)
  loop
    if item.new_quantity > item.old_quantity then
      insert into public.mouvements_stock(materiel_id,type,quantite,motif)
      values(item.material_id,'Sortie',(item.new_quantity-item.old_quantity)::integer,'Modification réservation · '||new_date::text);
    elsif item.old_quantity > item.new_quantity then
      insert into public.mouvements_stock(materiel_id,type,quantite,motif)
      values(item.material_id,'Entrée',(item.old_quantity-item.new_quantity)::integer,'Réduction réservation · '||new_date::text);
    end if;
  end loop;

  update public.reservations set
    client_id = new_client_id,
    client_nom = trim(p_data->>'client_nom'),
    type_evenement = p_data->>'type_evenement',
    date_evenement = new_date,
    lieu = nullif(trim(p_data->>'lieu'), ''),
    montant_total = new_amount,
    statut = coalesce(p_data->>'statut','En attente'),
    chaises = coalesce((p_data->>'chaises')::integer, 0),
    matelas = coalesce((p_data->>'matelas')::integer, 0),
    notes = nullif(trim(p_data->>'notes'), ''),
    materiel_reserve = coalesce(p_data->'materiel_reserve', '[]'::jsonb)
  where id = p_reservation;

  update public.factures set montant_total = new_amount where reservation_id = p_reservation;
end
$$;

revoke all on function public.admin_update_reservation(uuid,jsonb) from public, anon;
grant execute on function public.admin_update_reservation(uuid,jsonb) to authenticated;
