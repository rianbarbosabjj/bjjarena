import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {ArenaPlatform,handleArenaRequest} from '../server/platform.mjs';
import {ArenaCompetition} from '../server/competition.mjs';
import {planCatalog,CATALOG_VERSION} from '../server/plans.mjs';
import {renderPlans} from '../plans-ui.mjs';
import {LocalD1} from './helpers/local-d1.mjs';
const owner={userId:'plan-owner'},other={userId:'other-organizer'},manager={userId:'delegated-manager'};
const eventInput={name:'Evento da organização',city:'Brasília',uf:'DF',date:'2027-02-20',deadline:'2027-02-10',venue:'Ginásio de teste',price:13990,categoryIds:['adulto-azul-leve'],regulationText:'Evento de teste, sem cobranças.'};
const rejects=(fn,status=409)=>assert.rejects(fn,e=>e.status===status);
async function fixture(){const db=new LocalD1();db.migrate();const p=new ArenaPlatform(db,{now:()=> '2026-11-19T17:00:00Z'}),org=await p.createOrganizer(owner,{name:'Organização independente'});return {db,p,org,sports:new ArenaCompetition(p)};}
const choose=(f,planId='competition-test',version=0,extra={})=>f.p.plans.choose(owner,f.org.id,{planId,catalogVersion:CATALOG_VERSION,confirmTest:true,version,...extra});
const createEvent=f=>f.p.createEvent(owner,{...eventInput,organizerId:f.org.id});

test('new organizers must choose a test plan before creating events and cannot opt into legacy access',async()=>{
 const f=await fixture(),plan=await f.p.plans.selection(f.org.id);assert.equal(plan.status,'selection-required');assert.deepEqual(plan.features,[]);await rejects(()=>createEvent(f),403);
 const org=await f.p.createOrganizer(other,{name:'Outro gestor',onboardingVersion:0,planId:'competition-test'});assert.equal((await f.p.plans.selection(org.id)).status,'selection-required');assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM arena_events').get().n,0);
});
test('the registrations plan permits event setup but blocks protected sporting endpoints',async()=>{
 const f=await fixture();await choose(f,'registrations-test');const event=await createEvent(f);assert.equal(event.status,'draft');assert.equal((await f.p.me(owner)).organizers[0].plan.planId,'registrations-test');
 await rejects(()=>f.sports.managerView(owner,event.id),403);await rejects(()=>f.sports.generate(owner,event.id,{}),403);await rejects(()=>f.sports.command(owner,event.id,{command:{type:'start'}}),403);await rejects(()=>f.sports.reviewView(owner,event.id),403);
});
test('upgrading to Competition releases sporting resources without modifying an existing event',async()=>{
 const f=await fixture();await choose(f,'registrations-test');const event=await createEvent(f);const plan=await choose(f,'competition-test',1);assert(plan.features.includes('review'));assert.equal(plan.version,2);assert.equal((await f.sports.managerView(owner,event.id)).status,'empty');assert.deepEqual(await f.p.managedEvent(owner,event.id),event);
});
test('plan selection is restricted to the owner, even when another user is an organization manager',async()=>{
 const f=await fixture();f.db.raw.prepare("INSERT INTO arena_memberships (organizer_id,user_id,role) VALUES (?,?,'manager')").run(f.org.id,manager.userId);const body={planId:'competition-test',catalogVersion:CATALOG_VERSION,confirmTest:true,version:0};
 await rejects(()=>f.p.plans.choose(other,f.org.id,body),404);await rejects(()=>f.p.plans.choose(manager,f.org.id,body),404);await rejects(()=>f.p.plans.choose(null,f.org.id,body),401);assert.equal((await f.p.plans.selection(f.org.id)).status,'selection-required');
});
test('client-supplied price, payment status, capabilities and plan status never activate a commercial subscription',async()=>{
 const f=await fixture(),plan=await choose(f,'registrations-test',0,{status:'active',paymentStatus:'paid',price:0,entitlements:['review'],features:['brackets']});assert.equal(plan.status,'test');assert(!plan.features.includes('brackets'));assert(!plan.features.includes('review'));const row=f.db.raw.prepare('SELECT * FROM arena_plan_selections').get();assert.equal(row.status,'test');assert.equal(row.catalog_version,CATALOG_VERSION);
});
test('unknown plan, stale catalog, missing confirmation and stale selection version are rejected',async()=>{
 const f=await fixture();await rejects(()=>choose(f,'invented'),400);await rejects(()=>choose(f,'competition-test',0,{catalogVersion:'old'}));await rejects(()=>choose(f,'competition-test',0,{confirmTest:false}),400);await choose(f,'registrations-test');await rejects(()=>choose(f,'competition-test',0));assert.equal((await f.p.plans.selection(f.org.id)).planId,'registrations-test');
});
test('repeated selection is idempotent and selecting fewer features does not remove access',async()=>{
 const f=await fixture();await choose(f);await choose(f,'competition-test',1);assert.equal(f.db.raw.prepare("SELECT count(*) AS n FROM arena_audit WHERE action='plan.test.selected'").get().n,1);await rejects(()=>choose(f,'registrations-test',1));assert((await f.p.plans.selection(f.org.id)).features.includes('brackets'));
});
test('two independently registered organizers select their own plans and cannot access each others private events',async()=>{
 const f=await fixture();await choose(f,'registrations-test');const first=await createEvent(f),org=await f.p.createOrganizer(other,{name:'Segunda organização'});await f.p.plans.choose(other,org.id,{planId:'competition-test',catalogVersion:CATALOG_VERSION,confirmTest:true,version:0});const second=await f.p.createEvent(other,{...eventInput,organizerId:org.id});
 assert.equal((await f.p.me(owner)).managedEvents.length,1);assert.equal((await f.p.me(other)).managedEvents[0].id,second.id);await rejects(()=>f.p.managedEvent(owner,second.id),404);await rejects(()=>f.p.managedEvent(other,first.id),404);await rejects(()=>f.p.createEvent(other,{...eventInput,organizerId:f.org.id}),404);
});
test('a changed selected plan during event creation prevents the event and its audit atomically',async()=>{
 const f=await fixture();await choose(f);const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.db.batch=batch;f.db.raw.prepare('UPDATE arena_plan_selections SET version=version+1 WHERE organizer_id=?').run(f.org.id);return batch(statements);};await rejects(()=>createEvent(f));assert.equal(f.db.raw.prepare('SELECT count(*) AS n FROM arena_events').get().n,0);assert.equal(f.db.raw.prepare("SELECT count(*) AS n FROM arena_audit WHERE action='event.created'").get().n,0);
});
test('an entitlement change during bracket creation prevents the draw and corresponding audit',async()=>{
 const f=await fixture();await choose(f);let event=await createEvent(f);for(const action of ['publish','open'])event=await f.p.changeEvent(owner,event.id,{action,version:event.version});const user={userId:'eligible-athlete'};await f.p.saveProfile(user,{name:'Atleta de Teste',team:'Equipe Arena',belt:'Azul',sex:'Masculino',birthYear:1997});let r=await f.p.register(user,{eventId:event.id,categoryId:'adulto-azul-leve',acceptedRegulation:event.regulationVersion});await f.p.testPayment(owner,r.id,{action:'confirm',version:r.version});event=await f.p.changeEvent(owner,event.id,{action:'close',version:event.version});
 const batch=f.db.batch.bind(f.db);f.db.batch=async statements=>{f.db.batch=batch;f.db.raw.prepare('UPDATE arena_plan_selections SET version=version+1 WHERE organizer_id=?').run(f.org.id);return batch(statements);};await rejects(()=>f.sports.generate(owner,event.id,{version:0,eventVersion:event.version,rosterVersion:event.rosterVersion,matCount:1}));assert.equal((await f.sports.managerView(owner,event.id)).status,'empty');assert.equal((await f.p.audit(owner,event.id)).filter(a=>a.action==='competition.generated').length,0);
});
test('failure in the selection audit rolls back the chosen plan',async()=>{
 const f=await fixture();f.db.raw.exec("CREATE TRIGGER reject_plan BEFORE INSERT ON arena_audit WHEN NEW.action='plan.test.selected' BEGIN SELECT RAISE(ABORT,'audit failed'); END");await assert.rejects(()=>choose(f),/audit failed/);assert.equal((await f.p.plans.selection(f.org.id)).status,'selection-required');
});
test('migration preserves prior test organizations while all new organizations require selection',async()=>{
 const db=new LocalD1();for(const name of readdirSync(new URL('../drizzle',import.meta.url)).filter(f=>f.endsWith('.sql')&&!f.startsWith('0003')).sort())db.raw.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
 db.raw.prepare('INSERT INTO arena_organizers (id,owner_id,name,created_at) VALUES (?,?,?,?)').run('legacy','legacy-owner','Organização anterior','2026-11-18T17:00:00Z');db.raw.exec(readFileSync(new URL('../drizzle/0003_blue_valeria_richards.sql',import.meta.url),'utf8'));
 const p=new ArenaPlatform(db);assert.equal((await p.plans.selection('legacy')).status,'legacy-test');assert((await p.plans.selection('legacy')).features.includes('brackets'));const org=await p.createOrganizer(owner,{name:'Nova organização'});assert.equal((await p.plans.selection(org.id)).status,'selection-required');
});
test('catalog states undefined prices and billing, and the UI never claims a real subscription',async()=>{
 const catalog=planCatalog();assert.equal(catalog.mode,'test');assert.equal(catalog.billingReady,false);for(const plan of catalog.plans){assert.equal(plan.price,null);assert.equal(plan.eventLimit,null);}const html=renderPlans({catalog});assert(html.includes('Condições a definir'));assert(html.includes('Nenhuma cobrança real'));assert(html.includes('Começar cadastro'));
 const f=await fixture(),response=await handleArenaRequest(new Request('https://arena.test/api/plans'),{db:f.db,user:null});assert.equal(response.status,200);assert.equal((await response.json()).version,CATALOG_VERSION);
});
test('plan selection HTTP writes still require authentication and same-origin JSON',async()=>{
 const f=await fixture(),url=`https://arena.test/api/organizers/${f.org.id}/plan`,body=JSON.stringify({planId:'competition-test',catalogVersion:CATALOG_VERSION,confirmTest:true,version:0});
 const send=(user,origin)=>handleArenaRequest(new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body}),{db:f.db,user});assert.equal((await send(null,'https://arena.test')).status,401);assert.equal((await send(owner,'https://other.test')).status,403);assert.equal((await send(owner,'https://arena.test')).status,200);
});
