// BJJ Arena v0.1 — demonstrative rules engine, not homologated for an official event.
export const METHODS = {submission:'Finalização',score:'Placar',decision:'Decisão do árbitro',wo:'W.O.'};
export const TEAM_POINTS = {1:9,2:3,3:1};
const clone = x => structuredClone(x);
const invariant = (condition,message) => { if(!condition) throw new Error(message); };
const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function seededSlots(size){
  let seeds=[1,2];
  while(seeds.length<size) seeds=seeds.flatMap(s=>[s,seeds.length*2+1-s]);
  return seeds;
}
export function makeCategory(spec,athleteIds){
  invariant(new Set(athleteIds).size===athleteIds.length,'Atleta repetido na categoria.');
  const category={...spec,athleteIds:[...athleteIds],matches:[],soloApproved:false};
  const add=(id,round,slots)=>category.matches.push({id,round,slots,mat:spec.mat??1,score:[{points:0,advantages:0,penalties:0},{points:0,advantages:0,penalties:0}],clock:{remainingMs:spec.duration*1000,running:false,anchorAt:null},history:[],result:null});
  if(athleteIds.length===3){
    add(`${spec.id}-r1`,0,[{athlete:athleteIds[0]},{athlete:athleteIds[2]}]);
    add(`${spec.id}-r2`,1,[{from:`${spec.id}-r1`,outcome:'loser'},{athlete:athleteIds[1]}]);
    add(`${spec.id}-r3`,2,[{from:`${spec.id}-r1`,outcome:'winner'},{from:`${spec.id}-r2`,outcome:'winner'}]);
  }else if(athleteIds.length>=2){
    const size=2**Math.ceil(Math.log2(athleteIds.length));
    const slots=seededSlots(size).map(s=>({athlete:athleteIds[s-1]??null}));
    let count=size/2,round=0;
    while(count>=1){
      for(let i=0;i<count;i++) add(`${spec.id}-${round}-${i}`,round,round===0?slots.slice(i*2,i*2+2):[{from:`${spec.id}-${round-1}-${i*2}`,outcome:'winner'},{from:`${spec.id}-${round-1}-${i*2+1}`,outcome:'winner'}]);
      round++;count/=2;
    }
  }
  advance(category);
  return category;
}
export function resolveSlot(category,slot){
  if(Object.hasOwn(slot,'athlete')) return {resolved:true,id:slot.athlete};
  const source=category.matches.find(m=>m.id===slot.from);
  if(!source?.result) return {resolved:false,id:null};
  if(slot.outcome==='loser'&&source.result.eligibleForRepescage===false) return {resolved:true,id:null};
  return {resolved:true,id:slot.outcome==='loser'?source.result.loserId:source.result.winnerId};
}
export const participants=(c,m)=>m.slots.map(s=>resolveSlot(c,s).id);
export function matchStatus(c,m){
  if(m.result) return m.result.auto?'bye':'final';
  if(m.clock.running) return 'live';
  return m.slots.every(s=>resolveSlot(c,s).resolved)&&participants(c,m).every(Boolean)?'ready':'pending';
}
export function advance(c){
  for(const m of c.matches){
    if(m.result) continue;
    const slots=m.slots.map(s=>resolveSlot(c,s));
    if(slots.every(s=>s.resolved)&&slots.some(s=>!s.id)){
      m.result={auto:true,method:'bye',winnerId:slots.find(s=>s.id)?.id??null,loserId:null,played:false,eligibleForRepescage:false};
    }
  }
}
export const remaining=(m,now=Date.now())=>Math.max(0,m.clock.remainingMs-(m.clock.running?Math.max(0,now-m.clock.anchorAt):0));
export const elapsed=(c,m,now=Date.now())=>Math.max(0,c.duration*1000-remaining(m,now));
export function compareScore(a,b){
  for(const [key,sign] of [['points',1],['advantages',1],['penalties',-1]]){
    if(a[key]!==b[key]) return a[key]*sign>b[key]*sign?0:1;
  }
  return null;
}
export function applyCommand(input,command,now=Date.now()){
  const state=clone(input),c=state.categories.find(c=>c.id===command.categoryId);
  invariant(c,'Categoria não encontrada.');
  const m=c.matches.find(m=>m.id===command.matchId);
  if(command.type==='checkin'){
    const a=state.athletes.find(a=>a.id===command.athleteId&&c.athleteIds.includes(a.id));
    invariant(a,'Atleta não encontrado.');
    invariant(Number.isFinite(command.weight)&&command.weight>0&&command.weight<300,'Informe um peso válido.');
    invariant(a.checkin!=='approved','A conferência deste atleta já foi concluída.');
    a.weight=command.weight;
    a.checkin=command.weight<=c.maxWeight&&command.uniform?'approved':'blocked';
    if(c.athleteIds.length===1&&a.checkin==='approved')c.soloApproved=true;
  }else{
    invariant(m,'Luta não encontrada.');
    invariant(!m.result,'O resultado já foi confirmado.');
    const ids=participants(c,m);
    invariant(ids.every(Boolean)&&m.slots.every(s=>resolveSlot(c,s).resolved),'Aguarde a definição dos dois atletas.');
    const approved=ids.every(id=>state.athletes.find(a=>a.id===id)?.checkin==='approved');
    if(command.type!=='result'||command.method!=='wo') invariant(approved,'Conclua a pesagem e a conferência dos dois atletas.');
    const stop=()=>{m.clock.remainingMs=remaining(m,now);m.clock.running=false;m.clock.anchorAt=null;};
    if(command.type==='start'){
      invariant(remaining(m,now)>0,'O tempo da luta já terminou.');
      invariant(!state.categories.some(cat=>cat.matches.some(other=>other.id!==m.id&&other.mat===m.mat&&other.clock.running&&!other.result)),'Já existe uma luta em andamento nesta área.');
      m.clock.remainingMs=remaining(m,now);m.clock.running=true;m.clock.anchorAt=now;
    }else if(command.type==='pause')stop();
    else if(command.type==='expire'){stop();m.clock.remainingMs=0;}
    else if(command.type==='score'){
      invariant(command.side===0||command.side===1,'Lado inválido.');
      invariant(['points','advantages','penalties'].includes(command.kind),'Marcação inválida.');
      invariant(command.kind==='points'?[2,3,4].includes(command.delta):command.delta===1,'Valor de marcação inválido.');
      m.score[command.side][command.kind]+=command.delta;
      m.history.push({id:uid(),type:'score',side:command.side,kind:command.kind,delta:command.delta,at:now,elapsedMs:elapsed(c,m,now)});
    }else if(command.type==='undo'){
      const previous=[...m.history].reverse().find(h=>h.type==='score'&&!m.history.some(x=>x.type==='undo'&&x.target===h.id));
      invariant(previous,'Nenhuma marcação para desfazer.');
      m.score[previous.side][previous.kind]-=previous.delta;
      m.history.push({id:uid(),type:'undo',target:previous.id,at:now,elapsedMs:elapsed(c,m,now)});
    }else if(command.type==='result'){
      invariant(Object.hasOwn(METHODS,command.method),'Forma de vitória inválida.');
      invariant(ids.includes(command.winnerId),'Escolha um dos atletas da luta.');
      const suggested=compareScore(...m.score);
      if(command.method==='score'){
        invariant(remaining(m,now)===0,'A vitória pelo placar requer o término do tempo.');
        invariant(suggested!==null&&ids[suggested]===command.winnerId,'O vencedor deve corresponder ao placar.');
      }
      if(command.method==='decision'){
        invariant(remaining(m,now)===0,'A decisão por empate requer o término do tempo.');
        invariant(suggested===null,'A decisão por empate requer pontos, vantagens e punições empatados.');
      }
      if(command.method==='submission') invariant(typeof command.technique==='string'&&command.technique.trim().length>=2,'Informe a técnica de finalização.');
      stop();
      m.result={winnerId:command.winnerId,loserId:ids.find(id=>id!==command.winnerId),method:command.method,technique:command.method==='submission'?command.technique.trim().slice(0,80):null,played:command.method!=='wo',eligibleForRepescage:command.method!=='wo',at:now,elapsedMs:elapsed(c,m,now),score:clone(m.score)};
      advance(c);
    }else invariant(false,'Operação desconhecida.');
  }
  state.revision++;
  state.audit.push({id:uid(),at:now,action:command.type,categoryId:c.id,matchId:m?.id??null,revision:state.revision});
  return state;
}
export function placements(state,c){
  if(c.athleteIds.length===1)return c.soloApproved?[{athleteId:c.athleteIds[0],place:1,teamEligible:false}]:[];
  const f=c.matches.at(-1);
  if(!f?.result?.winnerId||f.result.auto)return [];
  const candidates=[{athleteId:f.result.winnerId,place:1},{athleteId:f.result.loserId,place:2}];
  const semis=c.athleteIds.length===3?[c.matches[1]]:c.matches.filter(m=>m.round===f.round-1);
  for(const sf of semis) if(sf.result?.loserId)candidates.push({athleteId:sf.result.loserId,place:3});
  const unique=candidates.filter((p,i,a)=>p.athleteId&&a.findIndex(x=>x.athleteId===p.athleteId)===i);
  const teamEligible=!(c.athleteIds.length===2&&new Set(c.athleteIds.map(id=>state.athletes.find(a=>a.id===id).teamId)).size===1);
  return unique.filter(p=>!c.matches.some(m=>m.result?.method==='wo'&&m.result.loserId===p.athleteId)||c.matches.some(m=>m.result?.played&&participants(c,m).includes(p.athleteId))).map(p=>({...p,teamEligible}));
}
export function teamRanking(state){
  const teams=state.teams.map(t=>({...t,points:0,gold:0,silver:0,bronze:0}));
  for(const c of state.categories)for(const p of placements(state,c)){
    if(!p.teamEligible)continue;
    const a=state.athletes.find(a=>a.id===p.athleteId),t=teams.find(t=>t.id===a.teamId);
    t.points+=TEAM_POINTS[p.place];t[{1:'gold',2:'silver',3:'bronze'}[p.place]]++;
  }
  teams.sort((a,b)=>b.points-a.points||b.gold-a.gold||b.silver-a.silver||a.name.localeCompare(b.name,'pt-BR'));
  let last=null,rank=0;
  return teams.map((t,i)=>{const signature=[t.points,t.gold,t.silver].join(':');if(signature!==last)rank=i+1;last=signature;return {...t,rank};});
}
export function createDemo(){
  const teams=[{id:'t1',name:'Equipe Cerrado',short:'CE',color:'#214a40'},{id:'t2',name:'Atlas Jiu-Jitsu',short:'AT',color:'#303c79'},{id:'t3',name:'Raiz Brasília',short:'RA',color:'#93613b'},{id:'t4',name:'Nova Guarda',short:'NG',color:'#755388'}];
  const names=['Lucas Almeida','Pedro Santos','Rafael Oliveira','Bruno Costa','Gabriel Rocha','Mateus Lima','João Ribeiro','Caio Fernandes','André Moura','Thiago Martins','Diego Nunes','Marina Souza','Ana Carvalho','Beatriz Lopes','Camila Dias','Henrique Castro'];
  const athletes=names.map((name,i)=>({id:`a${i+1}`,name,teamId:teams[i%4].id,checkin:i===15?'pending':'approved',weight:null}));
  const categories=[
    makeCategory({id:'c1',title:'Adulto · Masculino · Azul',weightLabel:'Leve · até 76 kg',belt:'Azul',maxWeight:76,duration:360,mat:1},athletes.slice(0,8).map(a=>a.id)),
    makeCategory({id:'c2',title:'Master 1 · Masculino · Branca',weightLabel:'Médio · até 82,3 kg',belt:'Branca',maxWeight:82.3,duration:300,mat:2},athletes.slice(8,11).map(a=>a.id)),
    makeCategory({id:'c3',title:'Adulto · Feminino · Roxa',weightLabel:'Leve · até 64 kg',belt:'Roxa',maxWeight:64,duration:420,mat:2},athletes.slice(11,15).map(a=>a.id)),
    makeCategory({id:'c4',title:'Adulto · Masculino · Preta',weightLabel:'Médio · até 82,3 kg',belt:'Preta',maxWeight:82.3,duration:600,mat:1},[athletes[15].id])
  ];
  let state={schemaVersion:1,revision:0,event:{id:'arena-demo',name:'Arena Open',edition:'Brasília · edição demonstrativa',date:'2027-02-20',venue:'Ginásio de Brasília',rules:'Perfil demonstrativo · base CBJJ/IBJJF',mode:'Gi'},teams,athletes,categories,audit:[]};
  const finish=(categoryId,matchId,winnerId,method,technique)=>{state=applyCommand(state,{type:'result',categoryId,matchId,winnerId,method,technique},1795000000000);};
  state=applyCommand(state,{type:'score',categoryId:'c1',matchId:'c1-0-0',side:0,kind:'points',delta:2},1795000000000);
  state=applyCommand(state,{type:'expire',categoryId:'c1',matchId:'c1-0-0'},1795000000000);
  finish('c1','c1-0-0','a1','score');
  finish('c1','c1-0-1','a4','submission','Armlock');
  finish('c3','c3-0-0','a12','submission','Triângulo');
  finish('c3','c3-0-1','a13','submission','Mata-leão');
  finish('c3','c3-1-0','a12','submission','Armlock');
  return state;
}
