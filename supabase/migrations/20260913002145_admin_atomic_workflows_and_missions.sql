-- Applied 2026-09-13: no existing records or access policies are removed.
create table public.admin_missions (
 reservation_id uuid not null references public.reservations(id) on delete cascade,
 kind text not null check (kind in ('route','order')),
 details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
 revision integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key(reservation_id,kind)
);
alter table public.admin_missions enable row level security;
revoke all on public.admin_missions from anon;
grant select,insert,update,delete on public.admin_missions to authenticated;
create policy "Admin manages mission documents" on public.admin_missions for all to authenticated
 using ((select auth.jwt()->>'email')='mourtadafam@gmail.com')
 with check ((select auth.jwt()->>'email')='mourtadafam@gmail.com');

create function public.admin_save_mission(p_reservation uuid,p_kind text,p_details jsonb,p_revision integer)
returns public.admin_missions language plpgsql security invoker set search_path='' as $$
declare result public.admin_missions;
begin
 if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then raise exception 'Accès administrateur requis'; end if;
 perform 1 from public.reservations where id=p_reservation for update;
 if not found then raise exception 'Réservation introuvable'; end if;
 if p_revision=0 then
   insert into public.admin_missions(reservation_id,kind,details) values(p_reservation,p_kind,p_details) on conflict do nothing returning * into result;
 else
   update public.admin_missions set details=p_details,revision=revision+1,updated_at=now()
   where reservation_id=p_reservation and kind=p_kind and revision=p_revision returning * into result;
 end if;
 if result.reservation_id is null then raise exception 'Ce document a changé sur un autre appareil. Rechargez-le avant de modifier.'; end if;
 return result;
end $$;

create function public.admin_record_payment(p_reservation uuid,p_amount numeric,p_method text,p_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare r public.reservations; existing public.paiements;
begin
 if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then raise exception 'Accès administrateur requis'; end if;
 select * into r from public.reservations where id=p_reservation for update;
 if not found then raise exception 'Réservation introuvable'; end if;
 select * into existing from public.paiements where id=p_id;
 if found then
   if existing.reservation_id=p_reservation and existing.montant=p_amount and existing.mode_paiement=p_method then return p_id; end if;
   raise exception 'Identifiant de paiement déjà utilisé';
 end if;
 if p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') or p_amount>coalesce(r.montant_total,0)-coalesce(r.montant_paye,0) then raise exception 'Montant invalide ou supérieur au solde'; end if;
 if p_method is null or p_method not in ('Espèces','Wave','Orange Money') then raise exception 'Mode de paiement invalide'; end if;
 insert into public.paiements(id,reservation_id,montant,mode_paiement,date_paiement) values(p_id,p_reservation,p_amount,p_method,current_date);
 update public.reservations set montant_paye=coalesce(montant_paye,0)+p_amount where id=p_reservation;
 return p_id;
end $$;

create function public.admin_cancel_reservation(p_reservation uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare r public.reservations; item jsonb;
begin
 if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then raise exception 'Accès administrateur requis'; end if;
 select * into r from public.reservations where id=p_reservation for update;
 if not found then raise exception 'Réservation introuvable'; end if;
 if r.statut='Annulée' then return; end if;
 update public.reservations set statut='Annulée' where id=p_reservation;
 for item in select value from jsonb_array_elements(coalesce(r.materiel_reserve,'[]'::jsonb)) loop
   if (item->>'quantite')::integer>0 then
     insert into public.mouvements_stock(materiel_id,type,quantite,motif) values((item->>'id')::uuid,'Entrée',(item->>'quantite')::integer,'Retour - réservation annulée');
   end if;
 end loop;
end $$;

create function public.admin_create_reservation(p_data jsonb,p_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare cid uuid; d date; amount numeric; deposit numeric; item jsonb; available integer; requested integer;
begin
 if auth.jwt()->>'email' is distinct from 'mourtadafam@gmail.com' then raise exception 'Accès administrateur requis'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 if exists(select 1 from public.reservations where id=p_id) then return p_id; end if;
 d:=nullif(p_data->>'date_evenement','')::date;
 amount:=(p_data->>'montant_total')::numeric; deposit:=(p_data->>'montant_paye')::numeric;
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
   insert into public.clients(nom,telephone,adresse) values(p_data->>'client_nom',p_data->>'telephone',p_data->>'adresse') returning id into cid;
 else
   cid:=(p_data->>'client_id')::uuid;
 end if;
 insert into public.reservations(id,client_id,client_nom,type_evenement,date_evenement,lieu,montant_total,montant_paye,statut,chaises,matelas,notes,materiel_reserve)
 values(p_id,cid,p_data->>'client_nom',p_data->>'type_evenement',d,p_data->>'lieu',amount,deposit,p_data->>'statut',coalesce((p_data->>'chaises')::integer,0),coalesce((p_data->>'matelas')::integer,0),p_data->>'notes',coalesce(p_data->'materiel_reserve','[]'::jsonb));
 for item in select value from jsonb_array_elements(coalesce(p_data->'materiel_reserve','[]'::jsonb)) loop
   insert into public.mouvements_stock(materiel_id,type,quantite,motif) values((item->>'id')::uuid,'Sortie',(item->>'quantite')::integer,'Réservation : '||coalesce(p_data->>'type_evenement','Événement')||' · '||d::text);
 end loop;
 if deposit>0 then insert into public.paiements(reservation_id,montant,date_paiement,mode_paiement) values(p_id,deposit,current_date,'Espèces'); end if;
 return p_id;
end $$;

revoke all on function public.admin_save_mission(uuid,text,jsonb,integer) from public,anon;
revoke all on function public.admin_record_payment(uuid,numeric,text,uuid) from public,anon;
revoke all on function public.admin_cancel_reservation(uuid) from public,anon;
revoke all on function public.admin_create_reservation(jsonb,uuid) from public,anon;
grant execute on function public.admin_save_mission(uuid,text,jsonb,integer) to authenticated;
grant execute on function public.admin_record_payment(uuid,numeric,text,uuid) to authenticated;
grant execute on function public.admin_cancel_reservation(uuid) to authenticated;
grant execute on function public.admin_create_reservation(jsonb,uuid) to authenticated;
