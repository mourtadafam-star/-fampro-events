begin;
select plan(17);

select has_table('public', 'staff_accounts', 'staff account table exists');
select has_table('public', 'staff_activity', 'staff activity table exists');
select has_function('private', 'staff_is_admin', array[]::text[], 'admin helper exists');
select has_function('private', 'staff_can', array['text'], 'permission helper exists');
select has_function(
  'public', 'admin_register_staff_account',
  array['uuid','text','text','text','jsonb'],
  'staff registration RPC exists'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mourtadafam@gmail.com', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'employee@example.com', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'client@example.com', '', now(), '{}', '{}', now(), now());

insert into public.staff_accounts (
  auth_user_id, email, nom, role, active, permissions
) values (
  '10000000-0000-4000-8000-000000000002',
  'employee@example.com',
  'Employé Test',
  'employee',
  true,
  '{"clients":true,"reservations":false,"stock":false,"paiements":false,"rapports":false}'::jsonb
);

insert into public.staff_activity (
  actor_user_id, actor_name, actor_email, action, entity_type, entity_id, summary
) values (
  '10000000-0000-4000-8000-000000000001',
  'Administrateur',
  'mourtadafam@gmail.com',
  'UPDATE',
  'clients',
  'fixture',
  'Événement de test'
);

set local role authenticated;
set local "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000001';
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","email":"mourtadafam@gmail.com"}';
select ok((select private.staff_is_admin()), 'active admin is recognized');
select results_eq(
  $$select count(*)::bigint from public.staff_activity$$,
  array[1::bigint],
  'admin reads the activity journal'
);
select throws_ok(
  $$delete from public.staff_activity$$,
  '42501',
  null,
  'admin cannot mutate the immutable activity journal directly'
);

set local "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000002';
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","email":"employee@example.com"}';
select ok(not (select private.staff_is_admin()), 'employee is not an admin');
select ok((select private.staff_can('clients')), 'employee receives the selected permission');
select ok(not (select private.staff_can('paiements')), 'employee does not receive unselected permissions');
select results_eq(
  $$select count(*)::bigint from public.staff_accounts$$,
  array[1::bigint],
  'employee can read only the employee own account'
);
select throws_ok(
  $$update public.staff_accounts set role = 'admin'$$,
  '42501',
  null,
  'employee cannot elevate the employee own account'
);
select throws_ok(
  $$select public.admin_set_staff_active('10000000-0000-4000-8000-000000000002', false)$$,
  '42501',
  null,
  'employee cannot call the administrative account RPC'
);
select results_eq(
  $$select count(*)::bigint from public.staff_activity$$,
  array[0::bigint],
  'employee cannot read the activity journal'
);

set local "request.jwt.claim.sub" = '10000000-0000-4000-8000-000000000003';
set local "request.jwt.claims" = '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","email":"client@example.com"}';
select results_eq(
  $$select count(*)::bigint from public.staff_activity$$,
  array[0::bigint],
  'ordinary authenticated client cannot read the activity journal'
);

reset role;
select ok(
  not has_table_privilege('anon', 'public.staff_activity', 'select,insert,update,delete'),
  'anonymous users have no privilege on the activity journal'
);

select * from finish();
rollback;
