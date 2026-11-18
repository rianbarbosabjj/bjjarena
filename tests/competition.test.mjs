import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArenaPlatform, handleArenaRequest } from '../server/platform.mjs';
import { ArenaCompetition, drawOrder } from '../server/competition.mjs';
import { participants } from '../operacao/engine.mjs';
import { LocalD1 } from './helpers/local-d1.mjs';
const owner={userId:'manager'},outsider={userId:'outsider'};
const rejects=(f,status=409)=>assert.rejects(f,e=>e.status===status);
async function fixture({count=4,pending=0,path}={}){
 const db=new LocalD1(path);db.migrate();let time=Date.parse('2026-11-18T17:00:00Z');
 const p=new ArenaPlatform(db,{now:()=>new Date(time).toISOString()}),sports=new ArenaCompetition(p,{seed:()=> 'fixed-draw-seed'});
 const org=await p.createOrganizer(owner,{name:'Equipe de organização'});
 let event=await p.createEvent(owner,{organizerId:org.id,name:'Competição esportiva de teste',city:'Brasília',uf:'DF',venue:'Ginásio de teste',date:'2027-02-20',deadline:'2027-02-10',price:13990,categoryIds:['adulto-azul-leve'],regulationText:'Edital de desenvolvimento. Nenhuma cobrança.'});
 event=await p.changeEvent(owner,event.id,{action:'publish',version:event.version});event=await p.changeEvent(owner,event.id,{action:'open',version:event.version});
 const registrations=[];
 for(let i=0;i<count+pending;i++){
  const user={userId:'athlete-'+i};await p.saveProfile(user,{name:'Atleta Exemplo '+i,team:'Equipe '+(i%2),belt:'Azul',sex:'Masculino',birthYear:1997});
  let r=await p.register(user,{eventId:event.id,categoryId:'adulto-azul-leve',acceptedRegulation:event.regulationVersion});
  if(i<count)r=await p.testPayment(owner,r.id,{action:'confirm',version:r.version});registrations.push(r);
 }
 event=await p.changeEvent(owner,event.id,{action:'close',version:event.version});
 event=await p.managedEvent(owner,event.id);
 return {db,p,sports,org,event,registrations,tick:ms=>{time+=ms;}};
}
async function generate(f,version=0){const e=await f.p.managedEvent(owner,f.event.id);return f.sports.generate(owner,e.id,{eventVersion:e.version,rosterVersion:e.rosterVersion,version,matCount:2});}
async function publish(f){let state=await generate(f);return f.sports.publication(owner,f.event.id,{action:'publish',version:state.version});}
async function command(f,cmd,version){const current=await f.sports.managerView(owner,f.event.id);return f.sports.command(owner,f.event.id,{version:version??current.version,command:cmd});}
async function checkAll(f){const view=await f.sports.managerView(owner,f.event.id);for(const c of view.state.categories)for(const id of c.athleteIds)await command(f,{type:'checkin',categoryId:c.id,athleteId:id,weight:75,uniform:true});}
async function finish(f,matchId,winnerId){const categoryId='adulto-azul-leve';await command(f,{type:'start',categoryId,matchId});return command(f,{type:'result',categoryId,matchId,winnerId,method:'submission',technique:'Armlock'});}

test('only confirmed registrations seed draft brackets; pending names and request-supplied roster stay out',async()=>{
 const f=await fixture({count:3,pending:1}),view=await generate(f);
 assert.equal(view.state.athletes.length,3);assert.equal(view.state.categories[0].matches.length,3);
 assert(!view.state.athletes.some(a=>a.id===f.registrations[3].id));
 assert.deepEqual((await f.sports.publicView(f.event.id)).athletes,[]);
 assert.equal(view.state.draw.algorithm,'arena-sha256-slots-v1');
});
test('draw order is reproducible for the same server seed independent of query order',async()=>{
 assert.deepEqual(await drawOrder(['a','b','c','d'],'seed'),await drawOrder(['d','c','b','a'],'seed'));
});
test('generation requires closed registrations, a fresh event and an eligible athlete',async()=>{
 const f=await fixture({count:0,pending:1});await rejects(()=>generate(f));
 const e=await f.p.changeEvent(owner,f.event.id,{action:'open',version:f.event.version});
 await rejects(()=>f.sports.generate(owner,e.id,{eventVersion:e.version,rosterVersion:e.rosterVersion,version:0,matCount:1}));
});
test('sport operations and management view enforce organizer authorization',async()=>{
 const f=await fixture();await rejects(()=>f.sports.managerView(outsider,f.event.id),404);
 await rejects(()=>f.sports.generate(outsider,f.event.id,{}),404);await rejects(()=>f.sports.managerView(null,f.event.id),401);
 await generate(f);await rejects(()=>f.sports.publication(outsider,f.event.id,{action:'publish',version:1}),404);
});
test('drafts can be regenerated with version checks and no published participant leak',async()=>{
 const f=await fixture(),a=await generate(f),b=await generate(f,a.version);assert.equal(b.version,a.version+1);
 await rejects(()=>generate(f,a.version));assert.equal((await f.sports.publicView(f.event.id)).status,'empty');
});
test('published brackets expose only sport fields, with no actual weight, birth year, auth IDs, or payment',async()=>{
 const f=await fixture();await publish(f);await checkAll(f);
 const publicData=await f.sports.publicView(f.event.id);assert.equal(publicData.status,'published');
 assert.deepEqual(Object.keys(publicData.athletes[0]).sort(),['id','name','teamId']);
 const encoded=JSON.stringify(publicData);for(const field of ['birthYear','payment','athlete-0','"checkin"','"weight"','actorId','sourceRosterVersion'])assert(!encoded.includes(field),field);
});
test('weighing and uniform approval are required; score and submission cannot bypass match start',async()=>{
 const f=await fixture(),view=await publish(f),c=view.state.categories[0],m=c.matches[0];
 await rejects(()=>command(f,{type:'start',categoryId:c.id,matchId:m.id}));
 await checkAll(f);
 await rejects(()=>command(f,{type:'score',categoryId:c.id,matchId:m.id,side:0,kind:'points',delta:2}));
 await rejects(()=>command(f,{type:'result',categoryId:c.id,matchId:m.id,winnerId:participants(c,m)[0],method:'submission',technique:'Armlock'}));
});
test('submission persists and advances the winner automatically through the final and podium',async()=>{
 const f=await fixture(),v=await publish(f);await checkAll(f);let c=v.state.categories[0];
 const semis=c.matches.filter(m=>m.round===0),winners=semis.map(m=>participants(c,m)[0]);
 for(let i=0;i<semis.length;i++)await finish(f,semis[i].id,winners[i]);
 let view=await f.sports.managerView(owner,f.event.id);c=view.state.categories[0];assert.deepEqual(participants(c,c.matches.at(-1)),winners);
 await finish(f,c.matches.at(-1).id,winners[0]);
 const publicData=await f.sports.publicView(f.event.id);assert.equal(publicData.categories[0].podium.length,4);assert.equal(publicData.categories[0].podium.find(p=>p.place===1).athleteId,winners[0]);
 const final=publicData.categories[0].matches.at(-1);assert.equal(final.result.method,'submission');assert.equal(final.result.technique,'Armlock');
 await rejects(()=>command(f,{type:'score',categoryId:c.id,matchId:final.id,side:0,kind:'points',delta:2}));
});
test('overweight and rejected uniforms block start, and a corrected check-in can be approved',async()=>{
 const f=await fixture({count:2}),v=await publish(f),c=v.state.categories[0],m=c.matches[0],[a,b]=participants(c,m);
 await command(f,{type:'checkin',categoryId:c.id,athleteId:a,weight:77,uniform:true});
 await command(f,{type:'checkin',categoryId:c.id,athleteId:b,weight:75,uniform:false});
 await rejects(()=>command(f,{type:'start',categoryId:c.id,matchId:m.id}));
 await rejects(()=>command(f,{type:'checkin',categoryId:c.id,athleteId:b,weight:75,uniform:'true'}),400);
 await command(f,{type:'checkin',categoryId:c.id,athleteId:a,weight:75,uniform:true});
 await command(f,{type:'checkin',categoryId:c.id,athleteId:b,weight:75,uniform:true});
 await command(f,{type:'start',categoryId:c.id,matchId:m.id});
});
test('stale commands cannot duplicate points or audit writes',async()=>{
 const f=await fixture(),v=await publish(f);await checkAll(f);const c=v.state.categories[0],m=c.matches[0];
 const started=await command(f,{type:'start',categoryId:c.id,matchId:m.id});const score={type:'score',categoryId:c.id,matchId:m.id,side:0,kind:'points',delta:2};
 await command(f,score,started.version);await rejects(()=>command(f,score,started.version));
 const view=await f.sports.managerView(owner,f.event.id);assert.equal(view.state.categories[0].matches[0].score[0].points,2);
 assert.equal((await f.p.audit(owner,f.event.id)).filter(a=>a.action==='competition.score').length,1);
});
test('refund hides published snapshots and blocks further operations without rewriting results',async()=>{
 const f=await fixture(),v=await publish(f);await checkAll(f);const c=v.state.categories[0],m=c.matches[0];await finish(f,m.id,participants(c,m)[0]);
 const r=f.registrations[0];await f.p.testPayment(owner,r.id,{action:'refund',version:r.version});
 const publicData=await f.sports.publicView(f.event.id);assert.equal(publicData.status,'review');assert.deepEqual(publicData.athletes,[]);
 const privateData=await f.sports.managerView(owner,f.event.id);assert(privateData.state.categories[0].matches[0].result);
 await rejects(()=>command(f,{type:'start',categoryId:c.id,matchId:c.matches[1].id}));
});
test('published unused brackets may be withdrawn and regenerated after eligible roster changes',async()=>{
 const f=await fixture({count:2,pending:1}),v=await publish(f),r=f.registrations[2];
 await f.p.testPayment(owner,r.id,{action:'confirm',version:r.version});
 await rejects(()=>generate(f,v.version));
 const withdrawn=await f.sports.publication(owner,f.event.id,{action:'unpublish',version:v.version});
 const regenerated=await generate(f,withdrawn.version);assert.equal(regenerated.state.athletes.length,3);
});
test('starting operations prevents withdrawing or regenerating historical brackets and blocks reopening registrations',async()=>{
 const f=await fixture(),v=await publish(f);await checkAll(f);
 const current=await f.sports.managerView(owner,f.event.id);await rejects(()=>f.sports.publication(owner,f.event.id,{action:'unpublish',version:current.version}));
 await rejects(()=>generate(f,current.version));await rejects(()=>f.p.changeEvent(owner,f.event.id,{action:'open',version:f.event.version}));
});
test('a changed eligible roster during the draw commits neither brackets nor audit',async()=>{
 const f=await fixture(),batch=f.db.batch.bind(f.db);
 f.db.batch=async stmts=>{f.db.batch=batch;f.db.raw.prepare('UPDATE arena_events SET roster_version=roster_version+1 WHERE id=?').run(f.event.id);return batch(stmts);};
 await rejects(()=>generate(f));assert.equal((await f.sports.managerView(owner,f.event.id)).status,'empty');
 assert.equal((await f.p.audit(owner,f.event.id)).filter(a=>a.action==='competition.generated').length,0);
});
test('a refund race prevents score writes and its corresponding audit atomically',async()=>{
 const f=await fixture(),v=await publish(f);await checkAll(f);const c=v.state.categories[0],m=c.matches[0];await command(f,{type:'start',categoryId:c.id,matchId:m.id});
 const batch=f.db.batch.bind(f.db);f.db.batch=async stmts=>{f.db.batch=batch;f.db.raw.prepare('UPDATE arena_events SET roster_version=roster_version+1 WHERE id=?').run(f.event.id);return batch(stmts);};
 await rejects(()=>command(f,{type:'score',categoryId:c.id,matchId:m.id,side:0,kind:'points',delta:2}));
 const current=await f.sports.managerView(owner,f.event.id);assert.equal(current.state.categories[0].matches[0].score[0].points,0);
 assert.equal((await f.p.audit(owner,f.event.id)).filter(a=>a.action==='competition.score').length,0);
});
test('only one match per mat can run and pausing releases the area',async()=>{
 const f=await fixture(),v=await publish(f);await checkAll(f);const c=v.state.categories[0],[a,b]=c.matches;
 await command(f,{type:'start',categoryId:c.id,matchId:a.id});await rejects(()=>command(f,{type:'start',categoryId:c.id,matchId:b.id}));
 await command(f,{type:'pause',categoryId:c.id,matchId:a.id});assert.equal((await f.sports.publicView(f.event.id)).categories[0].matches[0].status,'paused');await command(f,{type:'start',categoryId:c.id,matchId:b.id});
});
test('single competitor needs approved weigh-in before podium and W.O. requires approved winner',async()=>{
 const f=await fixture({count:1});await publish(f);assert.equal((await f.sports.publicView(f.event.id)).categories[0].podium.length,0);
 await checkAll(f);assert.equal((await f.sports.publicView(f.event.id)).categories[0].podium[0].place,1);
 const g=await fixture({count:2}),v=await publish(g),c=v.state.categories[0],m=c.matches[0],winnerId=participants(c,m)[0];
 await rejects(()=>command(g,{type:'result',categoryId:c.id,matchId:m.id,winnerId,method:'wo'}));
 await command(g,{type:'checkin',categoryId:c.id,athleteId:winnerId,weight:75,uniform:true});
 await command(g,{type:'result',categoryId:c.id,matchId:m.id,winnerId,method:'wo'});
});
test('server clock gates score victory and rejects premature expire commands',async()=>{
 const f=await fixture({count:2}),v=await publish(f);await checkAll(f);const c=v.state.categories[0],m=c.matches[0],winnerId=participants(c,m)[0];
 await command(f,{type:'start',categoryId:c.id,matchId:m.id});await command(f,{type:'score',categoryId:c.id,matchId:m.id,side:0,kind:'points',delta:2});
 await rejects(()=>command(f,{type:'expire',categoryId:c.id,matchId:m.id}),400);
 await rejects(()=>command(f,{type:'result',categoryId:c.id,matchId:m.id,winnerId,method:'score'}));
 f.tick(c.duration*1000+1);await command(f,{type:'result',categoryId:c.id,matchId:m.id,winnerId,method:'score'});
 assert.equal((await f.sports.publicView(f.event.id)).categories[0].matches[0].result.method,'score');
});
test('sport snapshots survive database reopen and HTTP public routes do not leak management state',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'arena-sports-')),path=join(dir,'db.sqlite');
 try{const f=await fixture({count:2,path});await publish(f);await checkAll(f);f.db.raw.close();const db=new LocalD1(path),p=new ArenaPlatform(db),sports=new ArenaCompetition(p);
 assert.equal((await sports.managerView(owner,f.event.id)).state.athletes.length,2);
 const response=await handleArenaRequest(new Request(`https://arena.test/api/events/${f.event.id}/brackets`),{db,user:null});assert.equal(response.status,200);
 const management=await handleArenaRequest(new Request(`https://arena.test/api/events/${f.event.id}/competition`),{db,user:outsider});assert.equal(management.status,404);db.raw.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
