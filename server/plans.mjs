import {PlatformError} from './errors.mjs';
const ensure=(ok,message,status=409)=>{if(!ok)throw new PlatformError(message,status);};
export const CATALOG_VERSION='arena-test-v1';
export const FEATURES={events:'Eventos e edital',registrations:'Inscrições e pagamentos de teste',checking:'Checagem de atletas',brackets:'Chaves, conferência e placar',schedule:'Cronograma e chamadas',review:'Revisão seletiva das chaves'};
const BASE=['events','registrations','checking'];
const PLANS=[
 {id:'registrations-test',name:'Inscrições',description:'Prepare os eventos, receba inscrições e acompanhe os atletas confirmados.',features:BASE},
 {id:'competition-test',name:'Competição',description:'Reúna inscrições, chaves, operação das lutas, cronograma e revisão no mesmo evento.',features:Object.keys(FEATURES)},
];
export const planCatalog=()=>({version:CATALOG_VERSION,mode:'test',billingReady:false,commercialTermsDefined:false,featureLabels:FEATURES,plans:PLANS.map(p=>({...p,price:null,eventLimit:null}))});
export class ArenaPlans{
 constructor(platform){this.p=platform;}
 async selection(organizerId){
  const org=await this.p.first('SELECT onboarding_version FROM arena_organizers WHERE id=?',organizerId);ensure(org,'Organização não encontrada.',404);
  const row=await this.p.first('SELECT * FROM arena_plan_selections WHERE organizer_id=?',organizerId);
  if(!row)return org.onboarding_version===0?{status:'legacy-test',planId:'competition-test',name:'Acesso de teste anterior',features:Object.keys(FEATURES),version:0,catalogVersion:CATALOG_VERSION,selectionRequired:false,legacy:true}:{status:'selection-required',planId:null,name:null,features:[],version:0,catalogVersion:CATALOG_VERSION,selectionRequired:true,legacy:false};
  const plan=PLANS.find(p=>p.id===row.plan_id);
  return {status:row.status,planId:row.plan_id,name:plan?.name || 'Plano indisponível',features:row.status==='test'?JSON.parse(row.entitlements).filter(f=>Object.hasOwn(FEATURES,f)):[],version:row.version,catalogVersion:row.catalog_version,selectionRequired:false,legacy:false,selectedAt:row.selected_at};
 }
 async requireFeature(organizerId,feature){
  const selection=await this.selection(organizerId);
  ensure(selection.features.includes(feature),selection.selectionRequired?'Escolha um plano de teste para começar.':'Este recurso exige o plano Competição. Confira os planos disponíveis.',403);
  return selection.legacy?{selection,sql:'EXISTS(SELECT 1 FROM arena_organizers WHERE id=? AND onboarding_version=0) AND NOT EXISTS(SELECT 1 FROM arena_plan_selections WHERE organizer_id=?)',args:[organizerId,organizerId]}:{selection,sql:"EXISTS(SELECT 1 FROM arena_plan_selections WHERE organizer_id=? AND version=? AND status='test' AND EXISTS(SELECT 1 FROM json_each(entitlements) WHERE value=?))",args:[organizerId,selection.version,feature]};
 }
 async choose(user,organizerId,input){
  const uid=this.p.user(user),org=await this.p.first('SELECT * FROM arena_organizers WHERE id=? AND owner_id=?',organizerId,uid);ensure(org,'Organização não encontrada ou acesso indisponível.',404);
  ensure(input.catalogVersion===CATALOG_VERSION,'Os planos foram atualizados. Confira o catálogo novamente.');
  ensure(input.confirmTest===true,'Confirme a escolha para teste. Nenhuma contratação ou cobrança real será realizada.',400);
  const plan=PLANS.find(p=>p.id===input.planId);ensure(plan,'Plano de teste não encontrado.',400);
  const current=await this.selection(organizerId);ensure(input.version===current.version,'O plano mudou. Atualize a página.');
  if(current.planId===plan.id&&!current.legacy)return current;
  ensure(!current.features.some(f=>!plan.features.includes(f)),'A redução de recursos ainda não está disponível nesta fase de testes. Mantenha o plano atual ou amplie os recursos.');
  const at=this.p.now(),previous=await this.p.first('SELECT version FROM arena_plan_selections WHERE organizer_id=?',organizerId);
  const write=previous?this.p.stmt("UPDATE arena_plan_selections SET plan_id=?,catalog_version=?,entitlements=?,version=version+1,updated_at=? WHERE organizer_id=? AND version=? AND status='test'",plan.id,CATALOG_VERSION,JSON.stringify(plan.features),at,organizerId,input.version):this.p.stmt("INSERT INTO arena_plan_selections (organizer_id,plan_id,catalog_version,entitlements,status,selected_at,updated_at) SELECT ?,?,?,?,'test',?,? WHERE NOT EXISTS(SELECT 1 FROM arena_plan_selections WHERE organizer_id=?)",organizerId,plan.id,CATALOG_VERSION,JSON.stringify(plan.features),at,at,organizerId);
  const result=await this.p.db.batch([write,this.p.auditStatement(uid,organizerId,null,'plan.test.selected',organizerId,{planId:plan.id,catalogVersion:CATALOG_VERSION,mode:'test'},'WHERE changes()=1')]);
  ensure(result[0].meta.changes===1,'O plano mudou durante a seleção. Atualize a página.');return this.selection(organizerId);
 }
}
