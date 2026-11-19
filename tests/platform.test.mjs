import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArenaPlatform, handleArenaRequest } from '../server/platform.mjs';
import { LocalD1 } from './helpers/local-d1.mjs';

const owner = { userId: 'owner', displayName: 'Organizador' }, athlete = { userId: 'athlete', displayName: 'Atleta' }, outsider = { userId: 'outsider', displayName: 'Outra pessoa' };
const profile = { name: 'Atleta de Teste', team: 'Equipe Arena', belt: 'Azul', sex: 'Masculino', birthYear: 1997 };
const eventInput = { name: 'Arena Teste', city: 'Brasília', uf: 'DF', date: '2027-02-20', deadline: '2027-02-10', venue: 'Ginásio de teste', price: 13990, categoryIds: ['adulto-azul-leve'], regulationText: 'Edital de teste. Nenhuma cobrança real.' };
function fixture(path) { const db = new LocalD1(path); db.migrate(); return { db, svc: new ArenaPlatform(db, { now: () => '2026-11-18T17:00:00Z' }) }; }
async function prepared(options = {}) {
  const f = fixture(); const org = await f.svc.createOrganizer(owner, { name: 'BJJ Digital' });await f.svc.plans.choose(owner,org.id,{planId:'competition-test',catalogVersion:'arena-test-v1',version:0,confirmTest:true});
  let event = await f.svc.createEvent(owner, { ...eventInput, organizerId: org.id });
  if (!options.draft) { event = await f.svc.changeEvent(owner, event.id, { version: event.version, action: 'publish' }); event = await f.svc.changeEvent(owner, event.id, { version: event.version, action: 'open' }); }
  await f.svc.saveProfile(athlete, profile);
  return { ...f, org, event, input: { eventId: event.id, categoryId: 'adulto-azul-leve', acceptedRegulation: event.regulationVersion } };
}
const rejects = (fn, status) => assert.rejects(fn, e => e.status === status);

test('unauthenticated writes are rejected and me reveals no private records', async () => {
  const { svc } = fixture(); await rejects(() => svc.createOrganizer(null, { name: 'Teste' }), 401);
  assert.deepEqual((await svc.me(null)).registrations, []);
});
test('organizer setup is idempotent and creates a bound owner membership', async () => {
  const { svc, db } = fixture(); const a = await svc.createOrganizer(owner, { name: 'BJJ Digital' }); const b = await svc.createOrganizer(owner, { name: 'Outro Nome' });
  assert.equal(a.id, b.id); assert.equal(db.raw.prepare('SELECT count(*) AS n FROM arena_memberships').get().n, 1);
});
test('drafts are hidden and cannot receive registrations or public checking', async () => {
  const f = await prepared({ draft: true }); assert.equal((await f.svc.catalog()).events.length, 0);
  await rejects(() => f.svc.checking(f.event.id), 404); await rejects(() => f.svc.register(athlete, f.input), 409);
});
test('organizer isolation blocks reading, lifecycle changes, creation, and audit', async () => {
  const f = await prepared();
  await rejects(() => f.svc.listRegistrations(outsider, f.event.id), 404);
  await rejects(() => f.svc.changeEvent(outsider, f.event.id, { action: 'close', version: f.event.version }), 404);
  await rejects(() => f.svc.createEvent(outsider, { ...eventInput, organizerId: f.org.id }), 404);
  await rejects(() => f.svc.audit(outsider, f.event.id), 404);
  assert.equal((await f.svc.me(outsider)).managedEvents.length, 0);
});
test('draft can be corrected before publishing and published event fields stay immutable', async () => {
  const f = await prepared({ draft: true });
  const edited = await f.svc.changeEvent(owner, f.event.id, { ...eventInput, action: 'edit', version: f.event.version, name: 'Arena revisada', price: 15000 });
  assert.equal(edited.name, 'Arena revisada'); assert.equal(edited.price, 15000);
  const published = await f.svc.changeEvent(owner, f.event.id, { action: 'publish', version: edited.version });
  await rejects(() => f.svc.changeEvent(owner, f.event.id, { ...eventInput, action: 'edit', version: published.version }), 409);
});
test('server fixes payment to pending, uses event price and authenticated athlete, and withholds checking', async () => {
  const f = await prepared(); const r = await f.svc.register(athlete, { ...f.input, athleteId: owner.userId, amountCents: 1, paymentStatus: 'confirmed' });
  assert.equal(r.athleteId, athlete.userId); assert.equal(r.amountCents, 13990); assert.equal(r.payment.status, 'pending');
  assert.deepEqual(await f.svc.checking(f.event.id), []); assert.equal((await f.svc.me(outsider)).registrations.length, 0);
});
test('duplicate registrations are rejected by database uniqueness without duplicate audit', async () => {
  const f = await prepared(); await f.svc.register(athlete, f.input); await rejects(() => f.svc.register(athlete, f.input), 409);
  assert.equal((await f.svc.listRegistrations(owner, f.event.id)).length, 1);
  assert.equal((await f.svc.audit(owner, f.event.id)).filter(a => a.action === 'registration.created').length, 1);
});
test('wrong category, absent profile, and stale regulation are rejected', async () => {
  const f = await prepared();
  await rejects(() => f.svc.register(athlete, { ...f.input, categoryId: 'adulto-roxa-feminino' }), 400);
  await rejects(() => f.svc.register(outsider, f.input), 409);
  await rejects(() => f.svc.register(athlete, { ...f.input, acceptedRegulation: 'antigo' }), 409);
});
test('test payment is restricted to event management and recorded as test', async () => {
  const f = await prepared(); const r = await f.svc.register(athlete, f.input);
  await rejects(() => f.svc.testPayment(athlete, r.id, { action: 'confirm', version: r.version }), 404);
  const paid = await f.svc.testPayment(owner, r.id, { action: 'confirm', version: r.version });
  assert.equal(paid.payment.source, 'test'); assert.equal((await f.svc.checking(f.event.id)).length, 1);
  assert.equal((await f.svc.audit(owner, f.event.id)).find(a => a.action === 'payment.test.confirm').details.source, 'test');
});
test('public checking strips year of birth, user identity, amounts and payment data', async () => {
  const f = await prepared(); const r = await f.svc.register(athlete, f.input); await f.svc.testPayment(owner, r.id, { action: 'confirm', version: r.version });
  const [entry] = await f.svc.checking(f.event.id);
  assert.deepEqual(Object.keys(entry).sort(), ['categoryId','entryId','name','team']); assert.equal(entry.name, profile.name);
});
test('refund removes public eligibility and cannot be restored by late confirmation', async () => {
  const f = await prepared(); const r = await f.svc.register(athlete, f.input);
  const paid = await f.svc.testPayment(owner, r.id, { action: 'confirm', version: r.version });
  const refund = await f.svc.testPayment(owner, r.id, { action: 'refund', version: paid.version });
  assert.deepEqual(await f.svc.checking(f.event.id), []);
  await rejects(() => f.svc.testPayment(owner, r.id, { action: 'confirm', version: refund.version }), 409);
});
test('test endpoint refuses live events even for owner', async () => {
  const f = await prepared(); const r = await f.svc.register(athlete, f.input);
  f.db.raw.prepare("UPDATE arena_events SET kind='live' WHERE id=?").run(f.event.id);
  await rejects(() => f.svc.testPayment(owner, r.id, { action: 'confirm', version: r.version }), 403);
});
test('closing blocks registrations and stale management commands', async () => {
  const f = await prepared(); const closed = await f.svc.changeEvent(owner, f.event.id, { action: 'close', version: f.event.version });
  assert.equal(closed.status, 'closed'); await rejects(() => f.svc.register(athlete, f.input), 409);
  await rejects(() => f.svc.changeEvent(owner, f.event.id, { action: 'open', version: f.event.version }), 409);
});
test('registration snapshots preserve represented team after profile edits', async () => {
  const f = await prepared(); await f.svc.register(athlete, f.input);
  const me = await f.svc.me(athlete); await f.svc.saveProfile(athlete, { ...profile, team: 'Nova Equipe', version: me.profile.version });
  const [r] = await f.svc.listRegistrations(owner, f.event.id); assert.equal(r.athlete.team, 'Equipe Arena');
  await rejects(() => f.svc.saveProfile(athlete, { ...profile, version: me.profile.version }), 409);
});
test('invalid dates, prices, missing categories and past deadline are rejected', async () => {
  const f = await prepared();
  for (const bad of [{ date: '2027-02-31' }, { price: 1.5 }, { deadline: '2026-01-01' }, { categoryIds: [] }, { categoryIds: 'invalid' }, { uf: 'XX' }]) {
    await rejects(() => f.svc.createEvent(owner, { ...eventInput, organizerId: f.org.id, ...bad }), 400);
  }
});
test('deadline uses the event timezone and rejects new registrations after the last local day', async () => {
  const f = await prepared(); const localLastDay = new ArenaPlatform(f.db, { now: () => '2027-02-11T02:59:00Z' });
  await localLastDay.register(athlete, f.input);
  const expired = new ArenaPlatform(f.db, { now: () => '2027-02-11T03:01:00Z' });
  await rejects(() => expired.register(athlete, f.input), 409);
});
test('schema migration and D1-equivalent batches persist across database reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'arena-d1-')), path = join(dir, 'arena.sqlite');
  try { const f = fixture(path); const org = await f.svc.createOrganizer(owner, { name: 'BJJ Digital' }); f.db.raw.close();
    const second = new LocalD1(path); const svc = new ArenaPlatform(second); assert.equal((await svc.me(owner)).organizers[0].id, org.id); second.raw.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('batch failure rolls back primary record and audit together', async () => {
  const { svc, db } = fixture(); db.raw.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON arena_audit BEGIN SELECT RAISE(ABORT, 'forced test failure'); END");
  await assert.rejects(() => svc.createOrganizer(owner, { name: 'BJJ Digital' }));
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM arena_organizers').get().n, 0);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM arena_memberships').get().n, 0);
});
test('event change losing a version race creates no false audit entry', async () => {
  const f = await prepared(), original = f.db.batch.bind(f.db);
  f.db.batch = async statements => { f.db.batch = original; f.db.raw.prepare('UPDATE arena_events SET version=version+1 WHERE id=?').run(f.event.id); return original(statements); };
  await rejects(() => f.svc.changeEvent(owner, f.event.id, { action: 'close', version: f.event.version }), 409);
  assert.equal((await f.svc.audit(owner, f.event.id)).filter(a => a.action === 'event.close').length, 0);
});
test('closing the event during registration prevents both insert and registration audit', async () => {
  const f = await prepared(), original = f.db.batch.bind(f.db);
  f.db.batch = async statements => { f.db.batch = original; f.db.raw.prepare("UPDATE arena_events SET status='closed',version=version+1 WHERE id=?").run(f.event.id); return original(statements); };
  await rejects(() => f.svc.register(athlete, f.input), 409);
  assert.equal((await f.svc.listRegistrations(owner, f.event.id)).length, 0);
  assert.equal((await f.svc.audit(owner, f.event.id)).filter(a => a.action === 'registration.created').length, 0);
});
test('HTTP validates origin, authentication, JSON, response privacy and unavailable payments', async () => {
  const { db } = fixture();
  const call = (path, { user = owner, origin = 'https://arena.test', raw = '{}', method = 'POST' } = {}) => handleArenaRequest(new Request('https://arena.test/api/' + path, { method, headers: { origin, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: raw }) }), { db, user });
  assert.equal((await call('organizers', { user: null })).status, 401);
  assert.equal((await call('organizers', { origin: 'https://other.test' })).status, 403);
  assert.equal((await call('organizers', { raw: '{' })).status, 400);
  assert.equal((await call('organizers', { raw: '[]' })).status, 400);
  assert.equal((await call('payments/checkout')).status, 503);
  const response = await call('me', { method: 'GET' }); assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
