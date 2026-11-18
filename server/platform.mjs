import { CATEGORIES } from '../commerce.mjs';
import { ArenaCompetition } from './competition.mjs';
import { PlatformError } from './errors.mjs';
export { PlatformError } from './errors.mjs';
const ensure = (value, message, status = 400) => { if (!value) throw new PlatformError(message, status); };
const text = (v, label, max = 100) => {
  ensure(typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= max, `Confira ${label}.`);
  return v.trim();
};
const isoDate = (v, label) => {
  ensure(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v), `Confira ${label}.`);
  const parsed = new Date(v + 'T12:00:00Z');
  ensure(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v, `Confira ${label}.`);
  return v;
};
const today = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
const eventDto = row => row ? { ...JSON.parse(row.data), id: row.id, organizerId: row.organizer_id, status: row.status, kind: row.kind, version: row.version, rosterVersion: row.roster_version } : null;
const profileDto = row => row ? { ...JSON.parse(row.data), id: row.user_id, version: row.version } : null;
const registrationDto = row => ({ id: row.id, eventId: row.event_id, athleteId: row.athlete_id, athlete: JSON.parse(row.athlete_data), categoryId: row.category_id, amountCents: row.amount_cents, currency: row.currency, regulationVersion: row.regulation_version, status: row.status, payment: { status: row.payment_status, source: row.payment_source }, version: row.version, createdAt: row.created_at });

/** D1 is the source of truth. Multi-record writes use atomic batches. */
export class ArenaPlatform {
  constructor(db, { now = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {}) { this.db = db; this.now = now; this.id = id; }
  stmt(sql, ...args) { return this.db.prepare(sql).bind(...args); }
  async all(sql, ...args) { return (await this.stmt(sql, ...args).all()).results; }
  async first(sql, ...args) { return this.stmt(sql, ...args).first(); }
  user(user) { ensure(user?.userId, 'Entre na sua conta para continuar.', 401); return user.userId; }
  async member(user, organizerId) {
    const id = this.user(user), m = await this.first('SELECT role FROM arena_memberships WHERE organizer_id=? AND user_id=?', organizerId, id);
    ensure(m && ['owner', 'manager'].includes(m.role), 'Organização não encontrada ou acesso indisponível.', 404); return id;
  }
  async managedEvent(user, eventId) {
    const row = await this.first('SELECT * FROM arena_events WHERE id=?', eventId);
    ensure(row, 'Competição não encontrada.', 404); await this.member(user, row.organizer_id); return eventDto(row);
  }
  auditStatement(userId, organizerId, eventId, action, resourceId, details, condition = '', args = []) {
    return this.stmt(`INSERT INTO arena_audit (id, organizer_id, event_id, actor_id, action, resource_id, details, at) SELECT ?,?,?,?,?,?,?,? ${condition}`, this.id(), organizerId, eventId, userId, action, resourceId, JSON.stringify(details), this.now(), ...args);
  }
  async catalog() { return { events: (await this.all("SELECT * FROM arena_events WHERE status IN ('soon','open','closed') ORDER BY json_extract(data,'$.date'), created_at")).map(eventDto), categories: CATEGORIES }; }
  async me(user) {
    if (!user?.userId) return { user: null, profile: null, organizers: [], managedEvents: [], registrations: [], registrationEvents: [] };
    const uid = user.userId;
    const [profile, organizers, managed, mine, related] = await Promise.all([
      this.first('SELECT * FROM arena_profiles WHERE user_id=?', uid),
      this.all('SELECT o.id,o.name,m.role FROM arena_organizers o JOIN arena_memberships m ON o.id=m.organizer_id WHERE m.user_id=?', uid),
      this.all("SELECT e.* FROM arena_events e JOIN arena_memberships m ON e.organizer_id=m.organizer_id WHERE m.user_id=? AND m.role IN ('owner','manager') ORDER BY e.created_at", uid),
      this.all('SELECT * FROM arena_registrations WHERE athlete_id=? ORDER BY created_at', uid),
      this.all('SELECT DISTINCT e.* FROM arena_events e JOIN arena_registrations r ON e.id=r.event_id WHERE r.athlete_id=?', uid),
    ]);
    return { user: { displayName: user.displayName || 'Atleta', userId: uid }, profile: profileDto(profile), organizers, managedEvents: managed.map(eventDto), registrations: mine.map(registrationDto), registrationEvents: related.map(eventDto) };
  }
  async createOrganizer(user, input) {
    const uid = this.user(user), name = text(input.name, 'o nome da organização');
    const existing = await this.first('SELECT id,name FROM arena_organizers WHERE owner_id=?', uid);
    if (existing) return existing;
    const id = this.id();
    try { await this.db.batch([
      this.stmt('INSERT INTO arena_organizers (id,owner_id,name,created_at) VALUES (?,?,?,?)', id, uid, name, this.now()),
      this.stmt("INSERT INTO arena_memberships (organizer_id,user_id,role) VALUES (?,?,'owner')", id, uid),
      this.auditStatement(uid, id, null, 'organizer.created', id, { name }),
    ]); } catch (error) {
      const winner = await this.first('SELECT id,name FROM arena_organizers WHERE owner_id=?', uid);
      if (winner) return winner; throw error;
    }
    return { id, name };
  }
  async saveProfile(user, input) {
    const uid = this.user(user), name = text(input.name, 'o nome esportivo'), team = text(input.team, 'a equipe');
    ensure(['Branca','Azul','Roxa'].includes(input.belt) && ['Masculino','Feminino'].includes(input.sex), 'Confira a faixa e o sexo da categoria.');
    const year = Number(this.now().slice(0, 4));
    ensure(Number.isInteger(input.birthYear) && input.birthYear >= 1940 && input.birthYear <= year - 18, 'Este ambiente de teste atende atletas adultos. Confira o ano de nascimento.');
    const data = JSON.stringify({ name, team, belt: input.belt, sex: input.sex, birthYear: input.birthYear });
    const previous = await this.first('SELECT version FROM arena_profiles WHERE user_id=?', uid);
    if (previous) {
      ensure(input.version === previous.version, 'O perfil mudou. Atualize a página antes de salvar.', 409);
      const result = await this.stmt('UPDATE arena_profiles SET data=?,version=version+1,updated_at=? WHERE user_id=? AND version=?', data, this.now(), uid, input.version).run();
      ensure(result.meta.changes === 1, 'O perfil mudou. Atualize a página.', 409);
    } else {
      ensure(!input.version, 'Perfil não encontrado. Atualize a página.', 409);
      try { await this.stmt('INSERT INTO arena_profiles (user_id,data,updated_at) VALUES (?,?,?)', uid, data, this.now()).run(); }
      catch (e) { if (/unique|constraint/i.test(e.message)) throw new PlatformError('O perfil já foi criado. Atualize a página.', 409); throw e; }
    }
    return profileDto(await this.first('SELECT * FROM arena_profiles WHERE user_id=?', uid));
  }
  validateEvent(input) {
    const date = isoDate(input.date, 'a data da competição'), deadline = isoDate(input.deadline, 'o prazo de inscrição');
    ensure(deadline <= date && deadline >= today(this.now()), 'O prazo deve ser hoje ou uma data futura, até o dia da competição.');
    ensure(Number.isSafeInteger(input.price) && input.price >= 100 && input.price <= 1000000, 'Informe um valor de inscrição entre R$ 1 e R$ 10.000.');
    ensure(typeof input.uf === 'string' && ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].includes(input.uf), 'Selecione a UF.');
    ensure(Array.isArray(input.categoryIds), 'Selecione as categorias de teste.');
    const categoryIds = [...new Set(input.categoryIds)];
    ensure(categoryIds.length && categoryIds.every(id => CATEGORIES.some(c => c.id === id)), 'Selecione ao menos uma categoria de teste.');
    return { name: text(input.name, 'o nome da competição'), city: text(input.city, 'a cidade'), uf: input.uf, date, deadline, venue: text(input.venue, 'o local'), price: input.price, categoryIds, modality: 'Gi', lot: 'Lote de teste', edition: '01', code: 'ARENA', subtitle: 'Uma competição para preparar sua operação.', regulationVersion: 'TESTE-0.3', regulationText: text(input.regulationText, 'o edital', 12000) };
  }
  async createEvent(user, input) {
    const uid = await this.member(user, input.organizerId), data = this.validateEvent(input), id = this.id();
    await this.db.batch([
      this.stmt('INSERT INTO arena_events (id,organizer_id,data,created_at,updated_at) VALUES (?,?,?,?,?)', id, input.organizerId, JSON.stringify(data), this.now(), this.now()),
      this.auditStatement(uid, input.organizerId, id, 'event.created', id, { kind: 'test', status: 'draft' }),
    ]);
    return this.managedEvent(user, id);
  }
  async changeEvent(user, eventId, input) {
    const e = await this.managedEvent(user, eventId), uid = user.userId;
    ensure(input.version === e.version, 'A competição mudou. Atualize a página.', 409);
    if (input.action === 'edit') {
      ensure(e.status === 'draft', 'Os dados do evento ficam preservados após a publicação.', 409);
      const data = this.validateEvent(input);
      const result = await this.db.batch([
        this.stmt("UPDATE arena_events SET data=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='draft'", JSON.stringify(data), this.now(), eventId, input.version),
        this.auditStatement(uid, e.organizerId, eventId, 'event.edited', eventId, { version: input.version + 1 }, 'WHERE changes() = 1'),
      ]);
      ensure(result[0].meta.changes === 1, 'A competição mudou. Atualize a página.', 409);
      return this.managedEvent(user, eventId);
    }
    const nextStatus = { publish: 'soon', open: 'open', close: 'closed' }[input.action];
    ensure(nextStatus, 'Ação de competição inválida.');
    const permitted = { draft: ['publish'], soon: ['open'], open: ['close'], closed: ['open'] };
    ensure(permitted[e.status]?.includes(input.action), 'Esta mudança não é permitida no estado atual.', 409);
    if (input.action === 'open') ensure(e.deadline >= today(this.now()), 'O prazo de inscrição já terminou.', 409);
    const result = await this.db.batch([
      this.stmt("UPDATE arena_events SET status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND (? != 'open' OR NOT EXISTS (SELECT 1 FROM arena_competitions WHERE event_id=? AND published_at IS NOT NULL))", nextStatus, this.now(), eventId, input.version, nextStatus, eventId),
      this.auditStatement(uid, e.organizerId, eventId, `event.${input.action}`, eventId, { from: e.status, to: nextStatus }, 'WHERE changes() = 1'),
    ]);
    ensure(result[0].meta.changes === 1, 'A competição mudou ou suas chaves já estão publicadas. Atualize a página.', 409);
    return this.managedEvent(user, eventId);
  }
  async register(user, input) {
    const uid = this.user(user), e = eventDto(await this.first('SELECT * FROM arena_events WHERE id=?', input.eventId));
    ensure(e && e.status === 'open', 'As inscrições não estão abertas.', 409);
    ensure(e.deadline >= today(this.now()), 'O prazo de inscrição terminou.', 409);
    ensure(input.acceptedRegulation === e.regulationVersion, 'Leia e aceite a versão atual do edital.', 409);
    const profile = profileDto(await this.first('SELECT * FROM arena_profiles WHERE user_id=?', uid));
    ensure(profile, 'Complete seu perfil esportivo antes de se inscrever.', 409);
    const category = CATEGORIES.find(c => c.id === input.categoryId && e.categoryIds.includes(c.id));
    ensure(category && category.belt === profile.belt && category.sex === profile.sex && Number(e.date.slice(0, 4)) - profile.birthYear >= category.minAge, 'Categoria incompatível com seu perfil.');
    const id = this.id(), snapshot = JSON.stringify({ name: profile.name, team: profile.team, belt: profile.belt, sex: profile.sex, birthYear: profile.birthYear });
    let result;
    try { result = await this.db.batch([
      this.stmt(`INSERT INTO arena_registrations (id,event_id,athlete_id,athlete_data,category_id,amount_cents,regulation_version,created_at,updated_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM arena_events WHERE id=? AND version=? AND status='open') AND EXISTS (SELECT 1 FROM arena_profiles WHERE user_id=? AND version=?)`, id, e.id, uid, snapshot, category.id, e.price, e.regulationVersion, this.now(), this.now(), e.id, e.version, uid, profile.version),
      this.auditStatement(uid, e.organizerId, e.id, 'registration.created', id, { paymentStatus: 'pending', categoryId: category.id }, 'WHERE changes() = 1'),
    ]); } catch (error) {
      if (/unique|constraint/i.test(error.message)) throw new PlatformError('Você já possui uma inscrição ativa nesta competição.', 409); throw error;
    }
    ensure(result[0].meta.changes === 1, 'Os dados mudaram durante a inscrição. Atualize a página.', 409);
    return registrationDto(await this.first('SELECT * FROM arena_registrations WHERE id=?', id));
  }
  async listRegistrations(user, eventId) {
    await this.managedEvent(user, eventId);
    return (await this.all('SELECT * FROM arena_registrations WHERE event_id=? ORDER BY created_at', eventId)).map(registrationDto);
  }
  async checking(eventId) {
    const e = await this.first("SELECT id FROM arena_events WHERE id=? AND status IN ('soon','open','closed')", eventId);
    ensure(e, 'Competição não encontrada.', 404);
    const rows = await this.all("SELECT id,athlete_data,category_id FROM arena_registrations WHERE event_id=? AND status='active' AND payment_status='confirmed' ORDER BY json_extract(athlete_data,'$.name')", eventId);
    return rows.map(r => { const athlete = JSON.parse(r.athlete_data); return { entryId: r.id, name: athlete.name, team: athlete.team, categoryId: r.category_id }; });
  }
  async testPayment(user, registrationId, input) {
    const row = await this.first('SELECT * FROM arena_registrations WHERE id=?', registrationId);
    ensure(row, 'Inscrição não encontrada.', 404);
    const e = await this.managedEvent(user, row.event_id);
    ensure(e.kind === 'test', 'Simulações são permitidas somente em eventos de teste.', 403);
    ensure(input.version === row.version && row.status === 'active', 'A inscrição mudou. Atualize a página.', 409);
    const next = input.action === 'confirm' ? 'confirmed' : input.action === 'refund' ? 'refunded' : null;
    ensure(next, 'Ação de teste inválida.');
    ensure(next === 'confirmed' ? row.payment_status === 'pending' : row.payment_status === 'confirmed', 'Este pagamento não permite essa transição.', 409);
    const result = await this.db.batch([
      this.stmt("UPDATE arena_registrations SET payment_status=?,payment_source='test',version=version+1,updated_at=? WHERE id=? AND version=? AND payment_status=? AND status='active'", next, this.now(), registrationId, input.version, row.payment_status),
      this.stmt('UPDATE arena_events SET roster_version=roster_version+1 WHERE id=? AND changes()=1', e.id),
      this.auditStatement(user.userId, e.organizerId, e.id, `payment.test.${input.action}`, registrationId, { from: row.payment_status, to: next, source: 'test' }, 'WHERE changes() = 1'),
    ]);
    ensure(result[0].meta.changes === 1, 'O pagamento mudou. Atualize a página.', 409);
    return registrationDto(await this.first('SELECT * FROM arena_registrations WHERE id=?', registrationId));
  }
  async audit(user, eventId) {
    await this.managedEvent(user, eventId);
    return (await this.all('SELECT action,resource_id,details,at FROM arena_audit WHERE event_id=? ORDER BY at DESC,id LIMIT 100', eventId)).map(r => ({ action: r.action, resourceId: r.resource_id, details: JSON.parse(r.details), at: r.at }));
  }
}

export async function handleArenaRequest(request, { db, user, now = undefined, id = undefined }) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
  try {
    ensure(db, 'O serviço está temporariamente indisponível. Tente novamente.', 503);
    const service = new ArenaPlatform(db, { now, id }), sports = new ArenaCompetition(service), url = new URL(request.url), method = request.method;
    const path = url.pathname.replace(/^\/api/, '').split('/').filter(Boolean).map(decodeURIComponent);
    let input = {};
    if (['POST','PUT','PATCH','DELETE'].includes(method)) {
      service.user(user);
      ensure(request.headers.get('origin') === url.origin, 'Origem da solicitação não autorizada.', 403);
      ensure(request.headers.get('content-type')?.split(';')[0] === 'application/json', 'Envie os dados em JSON.', 415);
      const raw = await request.text(); ensure(raw.length <= 16000, 'Solicitação muito grande.', 413);
      try { input = JSON.parse(raw); } catch { throw new PlatformError('Dados da solicitação inválidos.'); }
      ensure(input && typeof input === 'object' && !Array.isArray(input), 'Dados da solicitação inválidos.');
    }
    let result, status = 200;
    if (method === 'GET' && path.join('/') === 'catalog') result = await service.catalog();
    else if (method === 'GET' && path.join('/') === 'me') result = await service.me(user);
    else if (method === 'PUT' && path.join('/') === 'profile') result = await service.saveProfile(user, input);
    else if (method === 'POST' && path.join('/') === 'organizers') { result = await service.createOrganizer(user, input); status = 201; }
    else if (method === 'POST' && path.join('/') === 'events') { result = await service.createEvent(user, input); status = 201; }
    else if (path[0] === 'events' && path[1] && path.length === 2 && method === 'PATCH') result = await service.changeEvent(user, path[1], input);
    else if (path[0] === 'events' && path.length === 3 && method === 'GET' && path[2] === 'checking') result = await service.checking(path[1]);
    else if (path[0] === 'events' && path.length === 3 && method === 'GET' && path[2] === 'registrations') result = await service.listRegistrations(user, path[1]);
    else if (path[0] === 'events' && path.length === 3 && method === 'GET' && path[2] === 'audit') result = await service.audit(user, path[1]);
    else if (path[0] === 'events' && path.length === 3 && method === 'GET' && path[2] === 'brackets') result = await sports.publicView(path[1]);
    else if (path[0] === 'events' && path.length === 3 && method === 'GET' && path[2] === 'competition') result = await sports.managerView(user, path[1]);
    else if (path[0] === 'events' && path.length === 4 && method === 'POST' && path[2] === 'competition' && path[3] === 'generate') result = await sports.generate(user, path[1], input);
    else if (path[0] === 'events' && path.length === 4 && method === 'POST' && path[2] === 'competition' && path[3] === 'publication') result = await sports.publication(user, path[1], input);
    else if (path[0] === 'events' && path.length === 4 && method === 'POST' && path[2] === 'competition' && path[3] === 'commands') result = await sports.command(user, path[1], input);
    else if (path.join('/') === 'registrations' && method === 'POST') { result = await service.register(user, input); status = 201; }
    else if (path[0] === 'registrations' && path.length === 3 && path[2] === 'test-payment' && method === 'POST') result = await service.testPayment(user, path[1], input);
    else if ((path[0] === 'payments' || path[2] === 'checkout') && method === 'POST') throw new PlatformError('Pagamentos reais ainda não estão habilitados.', 503);
    else throw new PlatformError('Recurso não encontrado.', 404);
    return new Response(JSON.stringify(result), { status, headers });
  } catch (error) {
    const status = error instanceof PlatformError ? error.status : 500;
    return new Response(JSON.stringify({ error: status === 500 ? 'Não foi possível concluir a operação. Tente novamente.' : error.message }), { status, headers });
  }
}
