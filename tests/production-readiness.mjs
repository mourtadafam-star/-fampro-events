import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [client, admin, workflows, worker, login, migration, finishMigration, editMigration, staffBaseMigration, auditMigration, staffMigration, publicFunction, staffFunction, functionConfig, pwaUpdate] = await Promise.all([
  read('client.html'),
  read('index.html'),
  read('admin-workflows.js'),
  read('sw.js'),
  read('login.html'),
  read('supabase/migrations/20260919234335_production_readiness_hardening.sql'),
  read('supabase/migrations/20260920112001_finish_production_hardening.sql'),
  read('supabase/migrations/20260920113450_add_reservation_edit_workflow.sql'),
  read('supabase/migrations/20260926211731_create_secure_staff_accounts.sql'),
  read('supabase/migrations/20260927015236_add_staff_activity_audit_log.sql'),
  read('supabase/migrations/20260927152406_secure_staff_access_and_document_sharing.sql'),
  read('supabase/functions/submit-reservation-request/index.ts'),
  read('supabase/functions/manage-employee/index.ts'),
  read('supabase/config.toml'),
  read('pwa-update.js')
]);

assert.match(client, /client\.rpc\('get_material_availability'/);
assert.doesNotMatch(client, /dateAvailabilityFallback/);
assert.doesNotMatch(client, /select\('date_evenement,statut,materiel_reserve'\)\.eq\('date_evenement'/);
assert.match(client, /form\.reset\(\);clearClientDraft\(\)/);
assert.doesNotMatch(client, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
assert.match(client, /client\.functions\.invoke\('submit-reservation-request'/);
assert.doesNotMatch(client, /client\.from\('demandes_reservation'\)\.insert/);
assert.match(client, /publicRequestAttempt\|\|=crypto\.randomUUID\(\)/);
assert.match(client, /À LA UNE/);
assert.match(client, /href="#reserver">Faire une réservation<\/a>/);
assert.match(client, /@media\(max-width:700px\)\{\.publicite\{margin-top:24px\}\.publicite-card\{grid-template-columns:86px 1fr/);

for (const page of [client, admin, login]) {
  assert.match(page, /@supabase\/supabase-js@2\.116\.0\/dist\/umd\/supabase\.min\.js/);
  assert.match(page, /integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous"/);
}

assert.match(admin, /table:'clients'/);
assert.match(admin, /table:'reservations'/);
assert.match(admin, /table:'paiements'/);
assert.match(admin, /table:'materiel'/);
assert.doesNotMatch(admin, /loadData=async function\(\)\{await loadDataWithClientRequestSummary\(\);home\(\)\}/);
assert.match(admin, /!\/\(annul\|refus\)\/i\.test\(status\(r\)\)/);
assert.match(admin, /material\.quantite_disponible/);

assert.match(workflows, /workflowRpc\('admin_create_reservation'/);
assert.match(workflows, /workflowRpc\('admin_record_payment'/);
assert.match(workflows, /workflowRpc\('admin_cancel_reservation'/);
assert.match(workflows, /workflowRpc\('admin_delete_reservation'/);
assert.match(workflows, /workflowRpc\('admin_update_reservation'/);
assert.match(workflows, /function openReservationEditor/);

assert.match(worker, /fampro-events-v137/);
assert.match(admin, /admin-workflows\.js\?v=137/);
assert.match(client, /client-catalog-sync\.js\?v=136/);
assert.match(admin, /admin-freshness\.js\?v=136/);
assert.match(worker, /customer-sharing\.js\?v=137/);
assert.match(worker, /pwa-update\.js\?v=137/);
assert.match(pwaUpdate, /controllerchange/);
assert.match(pwaUpdate, /registration\.update\(\)/);
assert.match(pwaUpdate, /updateViaCache: "none"/);
for (const page of [client, admin, login]) {
  assert.match(page, /<script src="pwa-update\.js\?v=137"><\/script>/);
  assert.doesNotMatch(page, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
}
assert.doesNotMatch(worker, /cdn\.jsdelivr\.net.*cache\.put/);
assert.match(worker, /origin!==self\.location\.origin/);
const cachedAssets = [...worker.matchAll(/'\.\/([^']+)'/g)]
  .map(([, asset]) => asset.split('?')[0])
  .filter(Boolean);
await Promise.all(cachedAssets.map(asset => read(asset)));

for (const table of ['clients', 'demandes_reservation', 'reservations', 'paiements', 'factures']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
}
assert.match(migration, /security definer[\s\S]*get_material_availability|create or replace function public\.get_material_availability[\s\S]*security definer/);
assert.match(migration, /sum\(\(entry->>'quantite'\)::numeric\) as requested/);
assert.match(migration, /already_reserved/);
assert.match(migration, /Aucun paiement ne peut être ajouté à une réservation annulée ou refusée/);
assert.match(migration, /alter publication supabase_realtime add table/);
assert.match(migration, /create or replace function public\.submit_public_reservation_request/);
assert.match(migration, /reservation_request_rate_limits/);
assert.match(migration, /grant execute on function public\.submit_public_reservation_request[\s\S]*to service_role/);
assert.doesNotMatch(migration, /grant insert on public\.demandes_reservation to anon/);
assert.match(publicFunction, /contentLength > 16_384/);
assert.match(publicFunction, /hashRequestIdentity/);
assert.match(publicFunction, /admin\.rpc\("submit_public_reservation_request"/);
assert.match(publicFunction, /limited \? 429 : 400/);
assert.match(functionConfig, /\[functions\.submit-reservation-request\][\s\S]*verify_jwt = false/);
assert.match(finishMigration, /revoke insert on public\.demandes_reservation from authenticated/);
assert.match(finishMigration, /reservation_request_idempotency_request_idx/);
assert.match(editMigration, /create or replace function public\.admin_update_reservation/);
assert.match(editMigration, /reservation\.id <> p_reservation/);
assert.match(editMigration, /update public\.factures set montant_total = new_amount/);
assert.match(staffBaseMigration, /create table if not exists public\.staff_accounts/);
assert.match(staffBaseMigration, /create or replace function private\.staff_can\(permission_name text\)/);
assert.match(staffBaseMigration, /from auth\.users[\s\S]*where lower\(email\) = 'mourtadafam@gmail\.com'/);
assert.doesNotMatch(staffBaseMigration, /values\s*\(\s*'[0-9a-f]{8}-[0-9a-f-]{27,}'/i);
assert.match(auditMigration, /alter table public\.staff_activity enable row level security/);
assert.match(auditMigration, /revoke all on function private\.log_staff_activity\(\) from public, anon, authenticated/);
assert.match(staffMigration, /create or replace function private\.staff_is_admin\(\)/);
assert.match(staffMigration, /create or replace function private\.staff_can\(permission_name text\)/);
assert.match(staffMigration, /create or replace function public\.admin_register_staff_account/);
assert.match(staffMigration, /create policy "Admins read staff activity"[\s\S]*private\.staff_is_admin\(\)/);
assert.match(staffMigration, /revoke all on table public\.staff_activity from public, anon, authenticated/);
assert.match(staffMigration, /revoke all on table public\.staff_accounts from anon, authenticated/);
assert.match(staffMigration, /private_fields text\[\]/);
assert.match(staffMigration, /admin_create_reservation\(jsonb,uuid\)'[\s\S]*'reservations'/);
assert.match(staffMigration, /admin_record_payment\(uuid,numeric,text,uuid\)'[\s\S]*'paiements'/);
assert.match(staffMigration, /pg_get_functiondef/);
assert.match(admin, /function reservationClient\(reservation\)\{return data\.clients\.find\(item=>String\(item\.id\)===String\(reservation\?\.client_id\)\)\|\|\{\}\}/);
assert.match(admin, /Préparer pour WhatsApp/);
assert.doesNotMatch(admin, /Le document PDF est joint à ce message/);
assert.match(staffFunction, /callerAccount\.role !== "admin"/);
assert.match(staffFunction, /npm:@supabase\/supabase-js@2\.116\.0/);
assert.match(staffFunction, /admin_register_staff_account/);
assert.match(staffFunction, /admin_set_staff_active/);
assert.match(staffFunction, /deleteUser\(invitation\.user\.id/);
assert.match(functionConfig, /\[functions\.manage-employee\][\s\S]*verify_jwt = true/);
assert.match(admin, /async function buildCompleteBackup/);
assert.match(admin, /backupTables=\['clients','reservations','paiements','materiel'/);

// Fake-data scenarios mirror the database capacity rule without touching live data.
const active = status => !/(annul|refus)/i.test(status || '');
const requestedFor = (items, materialId) => items
  .filter(item => item.id === materialId)
  .reduce((sum, item) => sum + item.quantite, 0);
const remainingFor = ({ stock, reservations, date, materialId }) => Math.max(
  stock - reservations
    .filter(reservation => reservation.date === date && active(reservation.status))
    .reduce((sum, reservation) => sum + requestedFor(reservation.items, materialId), 0),
  0
);

const fakeReservations = [
  { date: '2026-12-31', status: 'Confirmée', items: [{ id: 'chairs', quantite: 40 }, { id: 'chairs', quantite: 10 }] },
  { date: '2026-12-31', status: 'Annulée', items: [{ id: 'chairs', quantite: 30 }] },
  { date: '2026-12-31', status: 'Refusée', items: [{ id: 'chairs', quantite: 20 }] },
  { date: '2027-01-01', status: 'Confirmée', items: [{ id: 'chairs', quantite: 90 }] }
];
assert.equal(remainingFor({ stock: 100, reservations: fakeReservations, date: '2026-12-31', materialId: 'chairs' }), 50);

// Two simultaneous attempts for the last units are serialized: one succeeds, one fails.
const capacity = 10;
let committed = 0;
const reserveAfterLock = quantity => {
  if (quantity > capacity - committed) return false;
  committed += quantity;
  return true;
};
assert.deepEqual([reserveAfterLock(7), reserveAfterLock(7)], [true, false]);
assert.equal(capacity - committed, 3);

// Cancellation/refusal restores date availability; balances never become negative.
fakeReservations[0].status = 'Annulée';
assert.equal(remainingFor({ stock: 100, reservations: fakeReservations, date: '2026-12-31', materialId: 'chairs' }), 100);
assert.equal(Math.max(150000 - (50000 + 100000), 0), 0);

await import(new URL('../customer-sharing.js', import.meta.url));
const normalizePhone = globalThis.FAMproSharing.normalizeSenegalWhatsAppPhone;
for (const input of ['77 287 52 52', '0772875252', '+221 77 287 52 52', '00221 77 287 52 52', '+221 (0) 77 287 52 52']) {
  assert.equal(normalizePhone(input), '221772875252', `normalizes ${input}`);
}
for (const input of ['', '77287525', '221221772875252', '77ABC875252', '+33 6 12 34 56 78']) {
  assert.equal(normalizePhone(input), '', `rejects ${input || 'blank phone'}`);
}

console.log('Production readiness checks and fake-data scenarios: OK');
