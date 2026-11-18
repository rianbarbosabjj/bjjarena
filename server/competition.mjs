import { CATEGORIES } from '../commerce.mjs';
import { makeCategory, applyCommand, participants, matchStatus, placements } from '../operacao/engine.mjs';
import { PlatformError } from './errors.mjs';

const ensure = (condition, message, status = 409) => { if (!condition) throw new PlatformError(message, status); };
const RULES = { Branca: 300, Azul: 360, Roxa: 420 };
export const DRAW_ALGORITHM = 'arena-sha256-slots-v1';
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export async function drawOrder(ids, seed) {
  const ordered = await Promise.all(ids.map(async id => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed + ':' + id));
    return { id, hash: [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('') };
  }));
  return ordered.sort((a,b) => compare(a.hash,b.hash) || compare(a.id,b.id)).map(x => x.id);
}
export async function createCompetitionState(event, registrations, { seed, matCount, at }) {
  const teams = [...new Set(registrations.map(r => r.athlete.team))].sort(compare).map((name,i) => ({ id: `team-${i+1}`, name }));
  const athletes = registrations.map(r => ({ id: r.id, name: r.athlete.name, teamId: teams.find(t=>t.name === r.athlete.team).id, checkin: 'pending', weight: null }));
  const categories = [];
  for (const id of event.categoryIds) {
    const spec = CATEGORIES.find(c=>c.id === id), entries = registrations.filter(r=>r.categoryId === id);
    if (!entries.length) continue;
    ensure(spec && entries.length <= 64, 'Este teste aceita até 64 atletas confirmados por categoria.');
    categories.push(makeCategory({ id, title: spec.name, weightLabel: spec.description, maxWeight: spec.maxWeight, duration: RULES[spec.belt], mat: categories.length % matCount + 1 }, await drawOrder(entries.map(r=>r.id), seed + ':' + id)));
  }
  ensure(categories.length, 'Não há inscrições confirmadas para gerar as chaves.');
  return { schemaVersion: 1, revision: 0, event: { id: event.id, name: event.name, rules: 'Perfil de teste Arena 0.4' }, draw: { algorithm: DRAW_ALGORITHM, seed, matCount, generatedAt: at }, teams, athletes, categories, audit: [] };
}
/** One versioned aggregate per event makes results, advancement and audit atomic. */
export class ArenaCompetition {
  constructor(platform, { seed = () => crypto.randomUUID() } = {}) { this.p = platform; this.seed = seed; }
  async row(eventId) { return this.p.first('SELECT * FROM arena_competitions WHERE event_id=?', eventId); }
  async managerView(user, eventId) {
    const event = await this.p.managedEvent(user, eventId), row = await this.row(eventId);
    if (!row) return { status: 'empty', version: 0, currentRosterVersion: event.rosterVersion, serverNow: this.p.now(), state: null };
    return { status: row.source_roster_version !== event.rosterVersion ? 'review' : row.published_at ? 'published' : 'draft', version: row.version, sourceRosterVersion: row.source_roster_version, currentRosterVersion: event.rosterVersion, publishedAt: row.published_at, serverNow: this.p.now(), state: JSON.parse(row.data) };
  }
  async publicView(eventId) {
    // Read publication and current eligibility in a single SQLite snapshot.
    const row = await this.p.first("SELECT e.status AS event_status,e.roster_version AS current_roster_version,c.data,c.version,c.source_roster_version,c.published_at FROM arena_events e LEFT JOIN arena_competitions c ON c.event_id=e.id WHERE e.id=? AND e.status IN ('soon','open','closed')",eventId);
    ensure(row, 'Competição não encontrada.', 404);
    const base = { status: 'empty', serverNow: this.p.now(), categories: [], athletes: [], teams: [] };
    if (!row?.published_at) return base;
    if (row.source_roster_version !== row.current_roster_version || row.event_status !== 'closed') return { ...base, status: 'review' };
    const state = JSON.parse(row.data);
    return {
      ...base, status: 'published', version: row.version, publishedAt: row.published_at,
      athletes: state.athletes.map(a=>({ id: a.id, name: a.name, teamId: a.teamId })),
      teams: state.teams.map(t=>({ id: t.id, name: t.name })),
      categories: state.categories.map(c=>({ id: c.id, title: c.title, weightLabel: c.weightLabel, duration: c.duration, athleteIds: c.athleteIds, podium: placements(state,c).map(p=>({ athleteId: p.athleteId, place: p.place })), matches: c.matches.map(m=>({ id: m.id, round: m.round, mat: m.mat, participants: participants(c,m), slots: m.slots, status: matchStatus(c,m)==='ready'&&state.audit.some(a=>a.action==='start'&&a.matchId===m.id)?'paused':matchStatus(c,m), score: m.score, clock: m.clock, result: m.result ? { winnerId: m.result.winnerId, loserId: m.result.loserId, method: m.result.method, technique: m.result.technique || null, auto: !!m.result.auto, elapsedMs: m.result.elapsedMs ?? null, at: m.result.at ?? null } : null })) })),
    };
  }
  async generate(user, eventId, input) {
    const e = await this.p.managedEvent(user,eventId), previous = await this.row(eventId);
    ensure(e.kind === 'test', 'Esta operação está disponível apenas em eventos de teste.', 403);
    ensure(e.status === 'closed', 'Encerre as inscrições antes de gerar as chaves.');
    ensure(input.eventVersion === e.version && input.rosterVersion === e.rosterVersion, 'A lista de inscritos mudou. Atualize antes de sortear.');
    ensure(input.version === (previous?.version || 0), 'As chaves mudaram. Atualize a página.');
    ensure(!previous?.published_at && (!previous || JSON.parse(previous.data).revision === 0), 'Retire a publicação antes de refazer um sorteio sem operações.');
    ensure(Number.isInteger(input.matCount) && input.matCount >= 1 && input.matCount <= 8, 'Escolha de uma a oito áreas de teste.', 400);
    const registrations = (await this.p.all("SELECT * FROM arena_registrations WHERE event_id=? AND status='active' AND payment_status='confirmed' ORDER BY id",eventId)).map(r=>({ id: r.id, categoryId: r.category_id, athlete: JSON.parse(r.athlete_data) }));
    const state = await createCompetitionState(e, registrations, { seed: this.seed(), matCount: input.matCount, at: this.p.now() });
    const guard = "EXISTS (SELECT 1 FROM arena_events WHERE id=? AND version=? AND roster_version=? AND status='closed')";
    const write = previous ? this.p.stmt(`UPDATE arena_competitions SET data=?,source_roster_version=?,version=version+1,updated_at=? WHERE event_id=? AND version=? AND published_at IS NULL AND json_extract(data,'$.revision')=0 AND ${guard}`,JSON.stringify(state),e.rosterVersion,this.p.now(),eventId,input.version,eventId,e.version,e.rosterVersion)
      : this.p.stmt(`INSERT INTO arena_competitions (event_id,data,source_roster_version,created_at,updated_at) SELECT ?,?,?,?,? WHERE ${guard} AND NOT EXISTS (SELECT 1 FROM arena_competitions WHERE event_id=?)`,eventId,JSON.stringify(state),e.rosterVersion,this.p.now(),this.p.now(),eventId,e.version,e.rosterVersion,eventId);
    const result = await this.p.db.batch([write,this.p.auditStatement(user.userId,e.organizerId,eventId,'competition.generated',eventId,{ athletes: registrations.length, categories: state.categories.length, algorithm: DRAW_ALGORITHM, seed: state.draw.seed },'WHERE changes()=1')]);
    ensure(result[0].meta.changes === 1,'A competição mudou durante o sorteio. Atualize a página.');
    return this.managerView(user,eventId);
  }
  async publication(user,eventId,input) {
    const e = await this.p.managedEvent(user,eventId), row = await this.row(eventId);
    ensure(e.kind === 'test','Operação disponível apenas no ambiente de teste.',403);
    ensure(row && row.version === input.version,'As chaves mudaram. Atualize a página.');
    const publish = input.action === 'publish';
    ensure(publish || input.action === 'unpublish','Ação de publicação inválida.',400);
    ensure(publish ? !row.published_at : row.published_at,'Esta publicação já foi alterada.');
    const state = JSON.parse(row.data);
    ensure(state.revision === 0,'As operações já começaram. A revisão precisa preservar as lutas registradas.');
    if(publish) ensure(e.status === 'closed' && row.source_roster_version === e.rosterVersion,'A lista de atletas mudou. Gere novamente as chaves antes de publicar.');
    const publishedAt = publish ? this.p.now() : null;
    const result = await this.p.db.batch([
      this.p.stmt(`UPDATE arena_competitions SET published_at=?,version=version+1,updated_at=? WHERE event_id=? AND version=? AND json_extract(data,'$.revision')=0 AND (?=0 OR EXISTS(SELECT 1 FROM arena_events WHERE id=? AND status='closed' AND roster_version=?))`,publishedAt,this.p.now(),eventId,input.version,publish?1:0,eventId,row.source_roster_version),
      this.p.auditStatement(user.userId,e.organizerId,eventId,publish?'competition.published':'competition.unpublished',eventId,{ version: input.version+1 },'WHERE changes()=1'),
    ]);
    ensure(result[0].meta.changes === 1,'A competição mudou durante a publicação. Atualize a página.');
    return this.managerView(user,eventId);
  }
  async command(user,eventId,input) {
    const e = await this.p.managedEvent(user,eventId), row = await this.row(eventId);
    ensure(e.kind === 'test','Operação disponível apenas no ambiente de teste.',403);
    ensure(row && row.version === input.version,'Outra mesa atualizou a competição. Atualize os dados.');
    ensure(row.published_at && e.status === 'closed','Publique as chaves antes de iniciar a operação.');
    ensure(row.source_roster_version === e.rosterVersion,'A lista de atletas elegíveis mudou. As chaves precisam de revisão.');
    const c = input.command;
    ensure(c && ['checkin','start','pause','score','undo','result'].includes(c.type),'Comando de luta inválido.',400);
    const command = { type: c.type, categoryId: c.categoryId, matchId: c.matchId };
    if(c.type === 'checkin') { ensure(typeof c.uniform === 'boolean' && typeof c.weight === 'number','Confira peso e uniforme.',400); Object.assign(command,{ athleteId: c.athleteId, weight: c.weight, uniform: c.uniform }); }
    if(c.type === 'score') Object.assign(command,{ side: c.side, kind: c.kind, delta: c.delta });
    if(c.type === 'result') Object.assign(command,{ winnerId: c.winnerId, method: c.method, technique: c.technique });
    const state = JSON.parse(row.data), category = state.categories.find(x=>x.id === c.categoryId), match = category?.matches.find(x=>x.id === c.matchId);
    if(c.type !== 'checkin') {
      ensure(match,'Luta não encontrada.',404);
      const started = state.audit.some(a=>a.action === 'start' && a.matchId === match.id);
      if(['score','undo','pause'].includes(c.type) || (c.type === 'result' && c.method !== 'wo')) ensure(started,'Inicie a luta antes de operar o placar ou confirmar o resultado.');
      if(c.type === 'pause') ensure(match.clock.running,'O relógio já está pausado.');
      if(c.type === 'start') ensure(!match.clock.running,'O relógio já está em andamento.');
      if(c.type === 'result' && c.method === 'wo') ensure(state.athletes.find(a=>a.id === c.winnerId)?.checkin === 'approved','Conclua a conferência do vencedor antes de confirmar o W.O.');
    }
    let next;
    try { next = applyCommand(state,command,Date.parse(this.p.now())); }
    catch(error) { throw new PlatformError(error.message,409); }
    const result = await this.p.db.batch([
      this.p.stmt("UPDATE arena_competitions SET data=?,version=version+1,updated_at=? WHERE event_id=? AND version=? AND published_at IS NOT NULL AND source_roster_version=(SELECT roster_version FROM arena_events WHERE id=? AND status='closed')",JSON.stringify(next),this.p.now(),eventId,input.version,eventId),
      this.p.auditStatement(user.userId,e.organizerId,eventId,'competition.'+c.type,c.matchId || c.athleteId,{ categoryId: c.categoryId, revision: next.revision, method: c.type === 'result' ? c.method : undefined },'WHERE changes()=1'),
    ]);
    ensure(result[0].meta.changes === 1,'Outra mesa ou o financeiro atualizou o evento. Atualize os dados.');
    return this.managerView(user,eventId);
  }
}
