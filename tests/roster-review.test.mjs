import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ArenaPlatform,handleArenaRequest} from '../server/platform.mjs';
import {ArenaCompetition} from '../server/competition.mjs';
import {participants} from '../operacao/engine.mjs';
import {renderRosterReview} from '../roster-review-ui.mjs';
import {renderCompetition} from '../competition-ui.mjs';
import {LocalD1} from './helpers/local-d1.mjs';
const owner={userId:'review-owner'},outsider={userId:'other-owner'},blue='adulto-azul-leve',purple='adulto-roxa-feminino';
const rejects=(fn,status=409)=>assert.rejects(fn,error=>error.status===status);
async function fixture({blueCount=4,purpleCount=2,pendingCount=1}={}){
 const db=new LocalD1();db.migrate();let time=Date.parse('2026-11-19T17:00:00Z');const p=new ArenaPlatform(db,{now:()=>new Date(time).toISOString()}),sports=new ArenaCompetition(p,{seed:()=> 'review-seed'});
 const org=await p.createOrganizer(owner,{name:'Organização de revisão'});await p.plans.choose(owner,org.id,{planId:'competition-test',catalogVersion:'arena-test-v1',version:0,confirmTest:true});let event=await p.createEvent(owner,{organizerId:org.id,name:'Evento para revisão de chaves',city:'Brasília',uf:'DF',venue:'Ginásio de teste',date:'2027-02-20',deadline:'2027-02-10',price:13990,categoryIds:[blue,purple],regulationText:'Somente teste, sem cobranças.'});
 for(const action of ['publish','open'])event=await p.changeEvent(owner,event.id,{action,version:event.version});
 const registrations=[],pending=[];
 for(let i=0;i<blueCount+purpleCount+pendingCount;i++){
  const isPurple=i>=blueCount,user={userId:'review-athlete-'+i};await p.saveProfile(user,{name:'Atleta de Revisão '+i,team:i===blueCount+purpleCount?'A Nova Equipe':'Equipe '+i%2,birthYear:1997,belt:isPurple?'Roxa':'Azul',sex:isPurple?'Feminino':'Masculino'});
  let r=await p.register(user,{eventId:event.id,categoryId:isPurple?purple:blue,acceptedRegulation:event.regulationVersion});
  if(i<blueCount+purpleCount)r=await p.testPayment(owner,r.id,{action:'confirm',version:r.version});else pending.push(r);registrations.push(r);
 }
 event=await p.changeEvent(owner,event.id,{action:'close',version:event.version});let v=await sports.generate(owner,event.id,{version:0,eventVersion:event.version,rosterVersion:event.rosterVersion,matCount:2});await sports.publication(owner,event.id,{action:'publish',version:v.version});
 return {db,p,sports,event,registrations,pending,tick:ms=>{time+=ms;}};
}
const view=f=>f.sports.managerView(owner,f.event.id);
const send=async(f,command)=>f.sports.command(owner,f.event.id,{version:(await view(f)).version,command});
const preview=f=>f.sports.reviewView(owner,f.event.id);
const apply=(f,proposal,extra={})=>f.sports.applyReview(owner,f.event.id,{version:proposal.version,eventVersion:proposal.eventVersion,rosterVersion:proposal.rosterVersion,fingerprint:proposal.fingerprint,confirm:true,reason:'Confirmação tardia conferida pela organização.',...extra});
async function late(f){const r=f.pending[0];return f.p.testPayment(owner,r.id,{action:'confirm',version:r.version});}
async function ready(f,categoryId){let v=await view(f);const c=v.state.categories.find(c=>c.id===categoryId),m=c.matches.find(m=>!m.result);for(const athleteId of participants(c,m))await send(f,{type:'checkin',categoryId,athleteId,weight:c.maxWeight-1,uniform:true});await send(f,{type:'call',categoryId,matchId:m.id});for(const athleteId of participants(c,m))await send(f,{type:'presence',categoryId,matchId:m.id,athleteId,present:true});return m.id;}
async function playBlue(f){const matchId=await ready(f,blue);await send(f,{type:'start',categoryId:blue,matchId});f.tick(30000);await send(f,{type:'score',categoryId:blue,matchId,side:0,kind:'points',delta:2});let v=await view(f),c=v.state.categories.find(c=>c.id===blue),m=c.matches.find(m=>m.id===matchId);await send(f,{type:'result',categoryId:blue,matchId,winnerId:participants(c,m)[0],method:'submission',technique:'Armlock'});}

test('late confirmation rebuilds only an unstarted category and preserves the complete operated category',async()=>{
 const f=await fixture();await playBlue(f);await ready(f,purple);const before=await view(f);await late(f);
 assert.equal((await f.sports.publicView(f.event.id)).status,'review');const proposal=await preview(f);assert.equal(proposal.status,'ready');assert.equal(proposal.changes.length,1);assert.equal(proposal.changes[0].categoryId,purple);assert.equal(proposal.preservedResults,1);
 const result=await apply(f,proposal);assert.equal(result.status,'published');assert.deepEqual(result.state.categories.find(c=>c.id===blue),before.state.categories.find(c=>c.id===blue));
 const category=result.state.categories.find(c=>c.id===purple);assert.equal(category.athleteIds.length,3);assert(category.matches.every(m=>m.id.includes('-review-')));assert(category.matches.every(m=>!m.call));
 for(const a of before.state.athletes.filter(a=>before.state.categories.find(c=>c.id===purple).athleteIds.includes(a.id)))assert.deepEqual(result.state.athletes.find(x=>x.id===a.id),a);
 assert.equal(result.state.athletes.find(a=>a.id===f.pending[0].id).checkin,'pending');assert.equal((await f.sports.publicView(f.event.id)).status,'published');
});
test('a running unaffected bout keeps its clock anchor and can continue after the review',async()=>{
 const f=await fixture(),matchId=await ready(f,blue);await send(f,{type:'start',categoryId:blue,matchId});const before=await view(f);f.tick(15000);await late(f);const result=await apply(f,await preview(f));
 assert.deepEqual(result.state.categories.find(c=>c.id===blue),before.state.categories.find(c=>c.id===blue));await send(f,{type:'pause',categoryId:blue,matchId});assert.equal((await view(f)).state.categories.find(c=>c.id===blue).matches.find(m=>m.id===matchId).clock.remainingMs,345000);
});
test('refund in an operated category blocks the whole proposal without rewriting results or history',async()=>{
 const f=await fixture();await playBlue(f);await late(f);const r=f.registrations[0];await f.p.testPayment(owner,r.id,{action:'refund',version:r.version});const before=await view(f),proposal=await preview(f);
 assert.equal(proposal.status,'blocked');assert(proposal.changes.some(c=>c.categoryId===blue&&c.blockedReason));await rejects(()=>apply(f,proposal));assert.deepEqual((await view(f)).state,before.state);assert.equal((await f.sports.reviewHistory(owner,f.event.id)).length,0);
 assert(renderRosterReview(proposal).includes('não pode ser aplicada'));assert(!renderRosterReview(proposal).includes('id="roster-review-form"'));
});
test('an unstarted category can disappear without retaining withdrawn participants in public projections',async()=>{
 const f=await fixture();await playBlue(f);for(const r of f.registrations.filter(r=>r.categoryId===purple&&r.payment.status==='confirmed'))await f.p.testPayment(owner,r.id,{action:'refund',version:r.version});
 await apply(f,await preview(f));const result=await f.sports.publicView(f.event.id);assert(!result.categories.some(c=>c.id===purple));assert.equal(result.athletes.length,4);assert.equal(result.categories[0].matches[0].result.method,'submission');
});
test('review can remove the last unstarted category and renders a clear empty state',async()=>{
 const f=await fixture({blueCount:2,purpleCount:0,pendingCount:0});for(const r of f.registrations)await f.p.testPayment(owner,r.id,{action:'refund',version:r.version});await apply(f,await preview(f));const data=await f.sports.publicView(f.event.id);
 assert.deepEqual(data.categories,[]);assert.deepEqual(data.athletes,[]);assert(renderCompetition({data,event:{status:'closed'}}).includes('Nenhuma categoria'));
});
test('an approved single-athlete podium cannot be removed by roster reconciliation',async()=>{
 const f=await fixture({blueCount:1,purpleCount:0,pendingCount:0}),r=f.registrations[0];await send(f,{type:'checkin',categoryId:blue,athleteId:r.id,weight:75,uniform:true});await f.p.testPayment(owner,r.id,{action:'refund',version:r.version});assert.equal((await preview(f)).status,'blocked');
});
test('version-only reconciliation preserves every category when eligibility returns to the original composition',async()=>{
 const f=await fixture();await playBlue(f);const before=await view(f),r=await late(f);await f.p.testPayment(owner,r.id,{action:'refund',version:r.version});const proposal=await preview(f);assert.equal(proposal.status,'ready');assert.equal(proposal.changes.length,0);const result=await apply(f,proposal);assert.deepEqual(result.state.categories,before.state.categories);
});
test('reason, explicit confirmation, proposal fingerprint and current versions are mandatory',async()=>{
 const f=await fixture();await late(f);const proposal=await preview(f);
 for(const extra of [{reason:''},{reason:'curta'},{reason:'a'.repeat(601)},{confirm:false}])await rejects(()=>apply(f,proposal,extra),400);
 for(const extra of [{version:0},{rosterVersion:0},{eventVersion:0},{fingerprint:'forged'}])await rejects(()=>apply(f,proposal,extra));assert.equal((await f.sports.reviewHistory(owner,f.event.id)).length,0);
});
test('client-supplied roster and match data cannot inject unpaid athletes into the reviewed draw',async()=>{
 const f=await fixture({pendingCount:2});await late(f);const proposal=await preview(f);await apply(f,proposal,{athletes:[{id:f.pending[1].id}],categories:[],results:[]});const result=await view(f);assert(result.state.athletes.some(a=>a.id===f.pending[0].id));assert(!result.state.athletes.some(a=>a.id===f.pending[1].id));
});
test('a fresh financial change invalidates the preview and requires a new proposal',async()=>{
 const f=await fixture();await late(f);const proposal=await preview(f),r=f.registrations.find(r=>r.categoryId===purple);await f.p.testPayment(owner,r.id,{action:'refund',version:r.version});await rejects(()=>apply(f,proposal));assert.equal((await f.sports.publicView(f.event.id)).status,'review');assert.equal((await f.sports.reviewHistory(owner,f.event.id)).length,0);
});
test('a financial race during commit leaves neither review state, snapshot nor audit',async()=>{
 const f=await fixture();await late(f);const proposal=await preview(f),before=await view(f),batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.db.batch=batch;f.db.raw.prepare('UPDATE arena_events SET roster_version=roster_version+1 WHERE id=?').run(f.event.id);return batch(statements);};await rejects(()=>apply(f,proposal));assert.deepEqual((await view(f)).state,before.state);assert.equal((await f.sports.reviewHistory(owner,f.event.id)).length,0);assert.equal((await f.p.audit(owner,f.event.id)).filter(a=>a.action==='competition.roster-review').length,0);
});
test('snapshot failure rolls back the sporting update and audit in the same transaction',async()=>{
 const f=await fixture();await late(f);const proposal=await preview(f),before=await view(f);f.db.raw.exec("CREATE TRIGGER reject_review BEFORE INSERT ON arena_competition_reviews BEGIN SELECT RAISE(ABORT,'snapshot failure'); END");await assert.rejects(()=>apply(f,proposal),/snapshot failure/);assert.deepEqual((await view(f)).state,before.state);assert.equal((await f.sports.reviewHistory(owner,f.event.id)).length,0);
});
test('review stores before and after snapshots and repeated apply cannot duplicate the revision',async()=>{
 const f=await fixture();await late(f);const proposal=await preview(f),before=f.db.raw.prepare('SELECT data FROM arena_competitions WHERE event_id=?').get(f.event.id).data,result=await apply(f,proposal);
 const snapshot=f.db.raw.prepare('SELECT * FROM arena_competition_reviews WHERE event_id=?').get(f.event.id);assert.equal(snapshot.previous_data,before);assert.deepEqual(JSON.parse(snapshot.next_data),result.state);assert.equal(snapshot.actor_id,owner.userId);await rejects(()=>apply(f,proposal));assert.equal((await f.sports.reviewHistory(owner,f.event.id)).length,1);
});
test('review proposal and history enforce event ownership and strip private review data from public views',async()=>{
 const f=await fixture();await late(f);await rejects(()=>f.sports.reviewView(outsider,f.event.id),404);await rejects(()=>f.sports.reviewHistory(outsider,f.event.id),404);await rejects(()=>f.sports.reviewView(null,f.event.id),401);
 await apply(f,await preview(f));const response=await handleArenaRequest(new Request(`https://arena.test/api/events/${f.event.id}/competition/reviews`),{db:f.db,user:null});assert.equal(response.status,401);
 const encoded=JSON.stringify(await f.sports.publicView(f.event.id));for(const field of ['previous_data','next_data','reason','fingerprint','review-owner','"weight":'])assert(!encoded.includes(field),field);
});
test('review never republishes brackets while registrations are open, including imported legacy rows',async()=>{
 const f=await fixture();await late(f);const proposal=await preview(f);f.db.raw.prepare("UPDATE arena_events SET status='open' WHERE id=?").run(f.event.id);assert.equal((await preview(f)).status,'unavailable');await rejects(()=>apply(f,proposal));assert.deepEqual((await f.sports.publicView(f.event.id)).categories,[]);
});
