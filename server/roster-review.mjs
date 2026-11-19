import { CATEGORIES } from '../commerce.mjs';
import { allMatches, hasStarted, initializeOperations, projectSchedule } from '../operations.mjs';

const describe = (athlete, teams) => ({ id: athlete.id, name: athlete.name, team: teams.find(t=>t.id===athlete.teamId)?.name || '' });
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const categoryOperated = (state, category) => category.soloApproved || category.matches.some(m=>hasStarted(state,m) || (m.result && !m.result.auto));

/** Build from the authoritative eligible roster, never from request-supplied athletes. */
export async function buildRosterReview({ event, row, registrations, at, createState }) {
  const original=JSON.parse(row.data), state=initializeOperations(structuredClone(original));
  const ids=[...new Set([...state.categories.map(c=>c.id),...registrations.map(r=>r.categoryId)])];
  const changes=ids.map(id=>{
    const category=state.categories.find(c=>c.id===id),entries=registrations.filter(r=>r.categoryId===id),before=category?.athleteIds || [],after=entries.map(r=>r.id);
    const added=entries.filter(r=>!before.includes(r.id)).map(r=>({id:r.id,name:r.athlete.name,team:r.athlete.team}));
    const removed=before.filter(id=>!after.includes(id)).map(id=>describe(state.athletes.find(a=>a.id===id),state.teams));
    if(!added.length&&!removed.length)return null;
    const operated=category && categoryOperated(state,category);
    const blockedReason=operated?'A categoria já tem luta iniciada, resultado ou premiação conferida. A alteração exige decisão técnica sobre a trajetória dos atletas.':entries.length>64?'A categoria ultrapassa o limite de 64 atletas deste teste.':!event.categoryIds.includes(id)&&entries.length?'Categoria fora do edital deste evento.':null;
    return {categoryId:id,title:category?.title || CATEGORIES.find(c=>c.id===id)?.name || id,beforeCount:before.length,afterCount:after.length,added,removed,blockedReason,cancelledCalls:category?.matches.filter(m=>m.call?.count).length || 0};
  }).filter(Boolean);
  const blocked=changes.filter(c=>c.blockedReason),preserved=state.categories.filter(c=>!changes.some(change=>change.categoryId===c.id));
  const fingerprint=await digest({eventId:event.id,eventVersion:event.version,rosterVersion:event.rosterVersion,competitionVersion:row.version,sourceRosterVersion:row.source_roster_version,registrations});
  const proposal={status:blocked.length?'blocked':'ready',version:row.version,eventVersion:event.version,sourceRosterVersion:row.source_roster_version,rosterVersion:event.rosterVersion,fingerprint,changes,preservedCategories:preserved.map(c=>({id:c.id,title:c.title,operated:!!categoryOperated(state,c)})),preservedResults:preserved.flatMap(c=>c.matches).filter(m=>m.result&&!m.result.auto).length};
  if(blocked.length)return {proposal,next:null};
  const next=structuredClone(state),changedIds=new Set(changes.map(c=>c.categoryId));
  next.categories=next.categories.filter(c=>!changedIds.has(c.id));
  const seed=state.draw.seed+':review:'+event.rosterVersion;
  const changedRegistrations=registrations.filter(r=>changedIds.has(r.categoryId));
  const rebuilt=changedRegistrations.length?await createState(event,changedRegistrations,{seed,matCount:state.draw.matCount,at}):{categories:[],athletes:[],teams:[]};
  for(const category of rebuilt.categories){
    const prior=state.categories.find(c=>c.id===category.id),mat=prior?.matches[0]?.mat || prior?.mat || category.mat;
    category.mat=mat;
    const idMap=new Map(category.matches.map(m=>[m.id,m.id+'-review-'+event.rosterVersion]));
    let order=Math.max(0,...allMatches(next).filter(({match:m})=>m.mat===mat).map(({match:m})=>m.queueOrder || 0));
    for(const match of category.matches){match.id=idMap.get(match.id);match.mat=mat;match.queueOrder=++order;for(const slot of match.slots)if(slot.from)slot.from=idMap.get(slot.from);}
    next.categories.push(category);
    next.draw.categoryReviews ??= {};next.draw.categoryReviews[category.id]={seed,algorithm:state.draw.algorithm,rosterVersion:event.rosterVersion,generatedAt:at};
  }
  next.categories.sort((a,b)=>event.categoryIds.indexOf(a.id)-event.categoryIds.indexOf(b.id));
  const retained=new Set(next.categories.flatMap(c=>c.athleteIds));
  next.athletes=state.athletes.filter(a=>retained.has(a.id));
  next.teams=structuredClone(state.teams);
  for(const entry of changedRegistrations){
    if(next.athletes.some(a=>a.id===entry.id))continue;
    let team=next.teams.find(t=>t.name===entry.athlete.team);
    if(!team){team={id:`team-review-${event.rosterVersion}-${next.teams.length+1}`,name:entry.athlete.team};next.teams.push(team);}
    next.athletes.push({id:entry.id,name:entry.athlete.name,teamId:team.id,checkin:'pending',weight:null});
  }
  next.teams=next.teams.filter(t=>next.athletes.some(a=>a.teamId===t.id));
  for(const c of next.categories.filter(c=>changedIds.has(c.id)))if(c.athleteIds.length===1)c.soloApproved=next.athletes.find(a=>a.id===c.athleteIds[0])?.checkin==='approved';
  next.lastRosterReview={at,number:(state.lastRosterReview?.number||0)+1};
  next.revision++;next.audit.push({id:crypto.randomUUID(),at:Date.parse(at),action:'roster-review',revision:next.revision,categoryId:null,matchId:null});
  // Check the resulting queue before presenting or committing the proposal.
  projectSchedule(next,Date.parse(at));
  return {proposal,next};
}
