alter table public.materiel
add column if not exists unite text not null default 'unité';

comment on column public.materiel.unite is
'Unité utilisée pour le stock et les réservations, par exemple unité ou m².';

update public.materiel
set nom = 'Gazon synthétique',
    unite = 'm²',
    quantite_totale = case when quantite_totale = 1 then 200 else quantite_totale end,
    quantite_disponible = case when quantite_disponible = 1 then 200 else quantite_disponible end
where id = 'f5a2464f-7af2-4274-9edc-ddf646b604cc'
   or lower(nom) like '%gazon%';

update public.reservations as reservation
set materiel_reserve = converted.items
from (
  select source.id,
         jsonb_agg(
           case
             when element.item->>'id' = 'f5a2464f-7af2-4274-9edc-ddf646b604cc'
               or lower(element.item->>'nom') like '%gazon%'
             then jsonb_set(
                    jsonb_set(
                      jsonb_set(element.item, '{nom}', to_jsonb('Gazon synthétique'::text), true),
                      '{unite}', to_jsonb('m²'::text), true
                    ),
                    '{quantite}',
                    to_jsonb(
                      case
                        when (element.item->>'quantite')::numeric = 1
                          and element.item->>'nom' like '%200 m²%'
                        then 200
                        else (element.item->>'quantite')::numeric
                      end
                    ),
                    true
                  )
             else element.item
           end
           order by element.position
         ) as items
  from public.reservations as source
  cross join lateral jsonb_array_elements(source.materiel_reserve)
    with ordinality as element(item, position)
  where source.materiel_reserve::text ilike '%gazon%'
  group by source.id
) as converted
where reservation.id = converted.id;
