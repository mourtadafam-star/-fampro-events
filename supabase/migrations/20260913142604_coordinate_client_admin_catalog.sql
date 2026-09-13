-- Keep the public catalogue readable while reserving all stock changes for the administrator.
drop policy if exists "FAMpro authenticated access" on public.materiel;
drop policy if exists "Public can view material catalog" on public.materiel;
drop policy if exists "FAMpro admin manages material" on public.materiel;

create policy "Public can view material catalog"
on public.materiel for select
to anon, authenticated
using (true);

create policy "FAMpro admin manages material"
on public.materiel for all
to authenticated
using ((select auth.jwt() ->> 'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt() ->> 'email') = 'mourtadafam@gmail.com');

grant select on public.materiel to anon;

drop policy if exists "Les utilisateurs créent leurs mouvements" on public.mouvements_stock;
drop policy if exists "Les utilisateurs voient leurs mouvements" on public.mouvements_stock;
drop policy if exists "FAMpro admin manages stock movements" on public.mouvements_stock;

create policy "FAMpro admin manages stock movements"
on public.mouvements_stock for all
to authenticated
using ((select auth.jwt() ->> 'email') = 'mourtadafam@gmail.com')
with check ((select auth.jwt() ->> 'email') = 'mourtadafam@gmail.com');

drop policy if exists "Les utilisateurs ajoutent leurs images matériel" on storage.objects;
drop policy if exists "Les utilisateurs modifient leurs images matériel" on storage.objects;
drop policy if exists "Les utilisateurs suppriment leurs images matériel" on storage.objects;
drop policy if exists "FAMpro admin adds material images" on storage.objects;
drop policy if exists "FAMpro admin updates material images" on storage.objects;
drop policy if exists "FAMpro admin deletes material images" on storage.objects;

create policy "FAMpro admin adds material images"
on storage.objects for insert
to authenticated
with check (bucket_id = 'materiel-images' and (select auth.jwt() ->> 'email') = 'mourtadafam@gmail.com');

create policy "FAMpro admin updates material images"
on storage.objects for update
to authenticated
using (bucket_id = 'materiel-images' and (select auth.jwt() ->> 'email') = 'mourtadafam@gmail.com')
with check (bucket_id = 'materiel-images' and (select auth.jwt() ->> 'email') = 'mourtadafam@gmail.com');

create policy "FAMpro admin deletes material images"
on storage.objects for delete
to authenticated
using (bucket_id = 'materiel-images' and (select auth.jwt() ->> 'email') = 'mourtadafam@gmail.com');

create index if not exists reservations_client_id_idx on public.reservations(client_id);
create index if not exists paiements_reservation_id_idx on public.paiements(reservation_id);
create index if not exists mouvements_stock_materiel_id_idx on public.mouvements_stock(materiel_id);

create or replace function public.admin_create_reservation(p_data jsonb, p_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  cid uuid;
  d date;
  amount numeric;
  deposit numeric;
  item jsonb;
  available integer;
  requested integer;
  requested_user uuid;
  source_request uuid;
begin
  if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then
    raise exception 'Accès administrateur requis';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  if exists(select 1 from public.reservations where id=p_id) then return p_id; end if;
  d:=nullif(p_data->>'date_evenement','')::date;
  amount:=(p_data->>'montant_total')::numeric;
  deposit:=(p_data->>'montant_paye')::numeric;
  requested_user:=nullif(p_data->>'client_user_id','')::uuid;
  source_request:=nullif(p_data->>'request_id','')::uuid;
  if nullif(trim(p_data->>'client_nom'),'') is null or d is null then raise exception 'Nom du client et date obligatoires'; end if;
  if amount is null or deposit is null or amount<0 or deposit<0 or deposit>amount or amount::text in ('NaN','Infinity','-Infinity') or deposit::text in ('NaN','Infinity','-Infinity') then raise exception 'Montants invalides'; end if;
  perform pg_advisory_xact_lock(hashtextextended(d::text,1));
  if exists(select 1 from public.reservations where date_evenement=d and statut is distinct from 'Annulée') then raise exception 'Cette date est déjà réservée'; end if;
  for item in select value from jsonb_array_elements(coalesce(p_data->'materiel_reserve','[]'::jsonb)) order by value->>'id' loop
    requested:=(item->>'quantite')::integer;
    select quantite_disponible into available from public.materiel where id=(item->>'id')::uuid for update;
    if not found or requested is null or requested<=0 or requested>coalesce(available,0) then raise exception 'Quantité de matériel indisponible'; end if;
  end loop;
  if p_data->>'client_id'='new' then
    if requested_user is not null then
      select id into cid from public.clients where auth_user_id=requested_user limit 1;
    end if;
    if cid is null then
      insert into public.clients(nom,telephone,adresse,auth_user_id)
      values(p_data->>'client_nom',p_data->>'telephone',p_data->>'adresse',requested_user)
      returning id into cid;
    end if;
  else
    cid:=(p_data->>'client_id')::uuid;
  end if;
  insert into public.reservations(id,client_id,client_nom,type_evenement,date_evenement,lieu,montant_total,montant_paye,statut,chaises,matelas,notes,materiel_reserve)
  values(p_id,cid,p_data->>'client_nom',p_data->>'type_evenement',d,p_data->>'lieu',amount,deposit,p_data->>'statut',coalesce((p_data->>'chaises')::integer,0),coalesce((p_data->>'matelas')::integer,0),p_data->>'notes',coalesce(p_data->'materiel_reserve','[]'::jsonb));
  for item in select value from jsonb_array_elements(coalesce(p_data->'materiel_reserve','[]'::jsonb)) loop
    insert into public.mouvements_stock(materiel_id,type,quantite,motif)
    values((item->>'id')::uuid,'Sortie',(item->>'quantite')::integer,'Réservation : '||coalesce(p_data->>'type_evenement','Événement')||' · '||d::text);
  end loop;
  if deposit>0 then
    insert into public.paiements(reservation_id,montant,date_paiement,mode_paiement)
    values(p_id,deposit,current_date,'Espèces');
  end if;
  if source_request is not null then
    update public.demandes_reservation
    set statut='Confirmée'
    where id=source_request;
  end if;
  return p_id;
end
$$;
