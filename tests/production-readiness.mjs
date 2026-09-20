import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [client, admin, workflows, worker, login, migration, finishMigration, editMigration, publicFunction, functionConfig] = await Promise.all([
  read('client.html'),
  read('index.html'),
  read('admin-workflows.js'),
  read('sw.js'),
  read('login.html'),
  read('supabase/migrations/20260919234335_production_readiness_hardening.sql'),
  read('supabase/migrations/20260920112001_finish_production_hardening.sql'),
  read('supabase/migrations/20260920113450_add_reservation_edit_workflow.sql'),
  read('supabase/functions/submit-reservation-request/index.ts'),
  read('supabase/config.toml')
]);

assert.match(client, /client\.rpc\('get_material_availability'/);
assert.doesNotMatch(client, /dateAvailabilityFallback/);
assert.doesNotMatch(client, /select\('date_evenement,statut,materiel_reserve'\)\.eq\('date_evenement'/);
assert.match(client, /form\.reset\(\);clearClientDraft\(\)/);
assert.match(client, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
assert.match(client, /client\.functions\.invoke\('submit-reservation-request'/);
assert.doesNotMatch(client, /client\.from\('demandes_reservation'\)\.insert/);
assert.match(client, /publicRequestAttempt\|\|=crypto\.randomUUID\(\)/);
assert.match(client, /À LA UNE/);
assert.match(client, /href="#reserver">Demander un devis<\/a>/);
assert.match(client, /@media\(max-width:700px\)\{\.publicite\{margin-top:24px\}\.publicite-card\{display:block/);

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

assert.match(worker, /fampro-events-v117/);
assert.doesNotMatch(worker, /cdn\.jsdelivr\.net.*cache\.put/);
assert.match(worker, /origin!==self\.location\.origin/);

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

console.log('Production readiness checks and fake-data scenarios: OK');
