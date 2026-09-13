update public.materiel
set photo_url = 'table-doree.png'
where lower(nom) like '%table dorée%'
   or lower(nom) like '%table doree%';
