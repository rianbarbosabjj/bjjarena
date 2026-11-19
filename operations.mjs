import { participants, matchStatus, remaining } from './operacao/engine.mjs';

const invariant = (ok, message) => { if (!ok) throw new Error(message); };
export const OPERATION_COMMANDS = ['schedule', 'move', 'call', 'presence', 'cancel-call'];
export const allMatches = state => state.categories.flatMap(category => category.matches.map(match => ({ category, match })));
export const hasStarted = (state, match) => state.audit.some(a => a.action === 'start' && a.matchId === match.id);
export const isFinal = (category, match) => match.round === Math.max(...category.matches.map(m => m.round));
// Test profile: General Competition Guidelines, article 1.4 (IBJJF June 2024).
export const restSeconds = (category, match) => category.duration * (isFinal(category, match) ? 2 : 1);
export function initializeOperations(state) {
  state.operations ??= { startAt: null, turnaroundSeconds: 60 };
  for (const [index, { match }] of allMatches(state).entries()) match.queueOrder ??= index + 1;
  return state;
}
export function restForMatch(state, category, match, now) {
  if (match.result || hasStarted(state, match)) return { readyAt: null, remainingMs: 0 };
  const ids = participants(category, match).filter(Boolean);
  const last = allMatches(state).filter(({category:c,match:m}) => m.id !== match.id && m.result?.played && participants(c,m).some(id => ids.includes(id))).map(({match:m}) => m.result.at).filter(Number.isFinite);
  const readyAt = last.length ? Math.max(...last) + restSeconds(category,match)*1000 : null;
  return { readyAt, remainingMs: readyAt === null ? 0 : Math.max(0,readyAt-now) };
}
export function startBlock(state, category, match, now) {
  if (match.result) return 'O resultado já foi confirmado.';
  const ids = participants(category,match);
  if (!ids.every(Boolean) || matchStatus(category,match) === 'pending') return 'Aguarde a definição dos dois atletas.';
  if (allMatches(state).some(({category:c,match:m}) => m.id !== match.id && !m.result && hasStarted(state,m) && (m.mat === match.mat || participants(c,m).some(id=>ids.includes(id))))) return 'Há uma luta iniciada nesta área ou com um destes atletas. Conclua essa luta primeiro.';
  if (!ids.every(id=>state.athletes.find(a=>a.id===id)?.checkin==='approved')) return 'Conclua a pesagem e a conferência dos dois atletas.';
  if (hasStarted(state,match)) return '';
  const rest = restForMatch(state,category,match,now);
  if (rest.remainingMs) return `Descanso obrigatório: aguarde ${Math.ceil(rest.remainingMs/1000)} segundos.`;
  if (!match.call?.count || !ids.every(id=>match.call.presentIds.includes(id))) return 'Registre a chamada e a presença dos dois atletas.';
  return '';
}
function queue(state, mat) {
  return allMatches(state).filter(({match:m})=>m.mat===mat && !m.result).sort((a,b)=>Number(hasStarted(state,b.match))-Number(hasStarted(state,a.match)) || (a.match.queueOrder??0)-(b.match.queueOrder??0) || a.match.id.localeCompare(b.match.id));
}
// Queue order and bracket dependencies must form a DAG, including across mats.
function scheduleGraph(state) {
  const entries=allMatches(state).filter(({match:m})=>!m.result), byId=new Map(entries.map(e=>[e.match.id,e])), deps=new Map(entries.map(e=>[e.match.id,new Set()]));
  for (const {match:m} of entries) for (const slot of m.slots) if (slot.from && byId.has(slot.from)) deps.get(m.id).add(slot.from);
  for (let mat=1;mat<=state.draw.matCount;mat++) {
    const rows=queue(state,mat);for(let i=1;i<rows.length;i++)deps.get(rows[i].match.id).add(rows[i-1].match.id);
  }
  const sorted=[],done=new Set();
  while(sorted.length<entries.length){const next=entries.find(e=>!done.has(e.match.id)&&[...deps.get(e.match.id)].every(id=>done.has(id)));invariant(next,'A ordem proposta coloca uma luta antes de sua classificatória. Revise as áreas e posições.');sorted.push(next);done.add(next.match.id);}
  return { sorted, deps };
}
export function projectSchedule(state, now) {
  const config=state.operations ?? {startAt:null,turnaroundSeconds:60}, rows=[], predicted=new Map(), buffer=config.turnaroundSeconds*1000;
  if(!config.startAt)return {configured:false,startAt:null,turnaroundSeconds:config.turnaroundSeconds,rows:[]};
  const start=Math.max(Date.parse(config.startAt),now), {sorted,deps}=scheduleGraph(state);
  for(const {category:c,match:m} of allMatches(state))if(m.result&&!m.result.auto)predicted.set(m.id,{startAt:m.result.at-(m.result.elapsedMs||0),endAt:m.result.at});
  const athleteEnds=new Map();
  for(const {category:c,match:m} of sorted){
    const started=hasStarted(state,m), ids=participants(c,m), rest=restForMatch(state,c,m,now);
    let at=start;
    for(const id of deps.get(m.id)){const previous=predicted.get(id);if(previous)at=Math.max(at,previous.endAt+buffer);}
    // An unresolved winner/loser will need the same rest after their source bout.
    if(!started)for(const slot of m.slots)if(slot.from){const previous=predicted.get(slot.from),source=c.matches.find(x=>x.id===slot.from);if(previous&&!source?.result?.auto&&source?.result?.method!=='wo')at=Math.max(at,previous.endAt+restSeconds(c,m)*1000);}
    if(!started){if(rest.readyAt)at=Math.max(at,rest.readyAt);for(const id of ids)if(athleteEnds.has(id))at=Math.max(at,athleteEnds.get(id)+restSeconds(c,m)*1000);}
    const endAt=at+(started?remaining(m,now):c.duration*1000);
    predicted.set(m.id,{startAt:at,endAt});for(const id of ids.filter(Boolean))athleteEnds.set(id,endAt);
  }
  for(let mat=1;mat<=state.draw.matCount;mat++)for(const [index,{category:c,match:m}]of queue(state,mat).entries()){
    const estimate=predicted.get(m.id),rest=restForMatch(state,c,m,now);
    rows.push({categoryId:c.id,matchId:m.id,mat,position:index+1,startAt:estimate.startAt,endAt:estimate.endAt,status:m.clock.running?'live':hasStarted(state,m)?'paused':rest.remainingMs?'rest':matchStatus(c,m)==='pending'?'pending':m.call?.count?'called':'queued',restReadyAt:rest.readyAt,call:m.call?{count:m.call.count,lastCalledAt:m.call.lastCalledAt}:null});
  }
  return {configured:true,startAt:config.startAt,turnaroundSeconds:config.turnaroundSeconds,rows};
}
export function applyOperation(input, command, now) {
  const state=initializeOperations(structuredClone(input));
  let category=state.categories.find(c=>c.id===command.categoryId),match=category?.matches.find(m=>m.id===command.matchId);
  if(command.type==='schedule'){
    invariant(typeof command.startAt==='string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(command.startAt) && Number.isFinite(Date.parse(command.startAt)),'Informe a data e a hora de início do cronograma.');
    invariant(new Date(command.startAt).toISOString().replace('.000Z','Z')===command.startAt.replace('.000Z','Z'),'Informe uma data e hora válidas.');
    invariant(Number.isInteger(command.turnaroundSeconds)&&command.turnaroundSeconds>=0&&command.turnaroundSeconds<=600,'O intervalo de troca deve ser de zero a 600 segundos.');
    state.operations={startAt:new Date(command.startAt).toISOString(),turnaroundSeconds:command.turnaroundSeconds};
  }else{
    invariant(match,'Luta não encontrada.');invariant(!match.result,'Uma luta concluída não pode ser alterada.');invariant(!hasStarted(state,match),'Uma luta iniciada não pode ter área, chamada ou presença alteradas.');
    if(command.type==='move'){
      invariant(!match.call?.count,'Cancele a chamada antes de mudar a área ou a posição.');
      invariant(Number.isInteger(command.mat)&&command.mat>=1&&command.mat<=state.draw.matCount,'Escolha uma área existente.');
      const list=queue(state,command.mat).filter(({match:m})=>m.id!==match.id&&!hasStarted(state,m));
      invariant(Number.isInteger(command.position)&&command.position>=1&&command.position<=list.length+1,'Escolha uma posição válida na fila.');
      match.mat=command.mat;list.splice(command.position-1,0,{category,match});list.forEach(({match:m},i)=>{m.queueOrder=i+1;});scheduleGraph(state);
    }else{
      const ids=participants(category,match);invariant(matchStatus(category,match)==='ready'&&ids.every(Boolean),'Aguarde a definição dos dois atletas.');
      if(command.type==='call'){
        invariant((match.call?.count||0)<3,'As três chamadas já foram registradas. A decisão de W.O. é manual.');
        match.call??={count:0,presentIds:[]};match.call.count++;match.call.lastCalledAt=now;
      }else if(command.type==='presence'){
        invariant(match.call?.count,'Registre a chamada antes de confirmar presença.');invariant(ids.includes(command.athleteId)&&typeof command.present==='boolean','Atleta ou presença inválidos.');
        match.call.presentIds=match.call.presentIds.filter(id=>id!==command.athleteId);if(command.present)match.call.presentIds.push(command.athleteId);
      }else if(command.type==='cancel-call'){
        invariant(match.call?.count,'Esta luta ainda não foi chamada.');match.call=null;
      }else invariant(false,'Operação desconhecida.');
    }
  }
  state.revision++;state.audit.push({id:crypto.randomUUID(),at:now,action:command.type,categoryId:category?.id??null,matchId:match?.id??null,revision:state.revision});
  return state;
}
