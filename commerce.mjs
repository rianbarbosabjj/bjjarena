// Browser-only demonstration. Real payment authority belongs to server/.
export const PAYMENT_LABELS={pending:'Aguardando pagamento',confirmed:'Pagamento confirmado',refunded:'Estornada',cancelled:'Cancelada'};
export const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(cents/100);
export const CATEGORIES=[
 {id:'adulto-azul-leve',name:'Adulto · Masculino · Azul · Leve',description:'Até 76 kg · com kimono',belt:'Azul',sex:'Masculino',minAge:18,maxWeight:76},
 {id:'adulto-azul-medio',name:'Adulto · Masculino · Azul · Médio',description:'Até 82,3 kg · com kimono',belt:'Azul',sex:'Masculino',minAge:18,maxWeight:82.3},
 {id:'master-branca-medio',name:'Master 1 · Masculino · Branca · Médio',description:'Até 82,3 kg · com kimono',belt:'Branca',sex:'Masculino',minAge:30,maxWeight:82.3},
 {id:'adulto-roxa-feminino',name:'Adulto · Feminino · Roxa · Leve',description:'Até 64 kg · com kimono',belt:'Roxa',sex:'Feminino',minAge:18,maxWeight:64}
];
export const EVENTS=[
 {id:'arena-brasilia',name:'Arena Open Brasília',city:'Brasília',uf:'DF',date:'2027-02-20',deadline:'2027-02-10',venue:'Ginásio demonstrativo · Brasília',status:'open',modality:'Gi',price:13990,lot:'1º lote',code:'BSB',subtitle:'O seu próximo desafio tem lugar marcado.',categoryIds:CATEGORIES.map(c=>c.id),edition:'01',regulationVersion:'DEMO-0.2'},
 {id:'arena-rio',name:'Copa Arena Rio',city:'Rio de Janeiro',uf:'RJ',date:'2027-03-13',deadline:'2027-03-03',venue:'Ginásio demonstrativo · Rio de Janeiro',status:'open',modality:'Gi',price:15990,lot:'1º lote',code:'RIO',subtitle:'O tatame encontra a cidade maravilhosa.',categoryIds:CATEGORIES.map(c=>c.id),edition:'02',regulationVersion:'DEMO-0.2'},
 {id:'arena-saopaulo',name:'Arena Challenge São Paulo',city:'São Paulo',uf:'SP',date:'2027-04-17',deadline:'2027-04-07',venue:'Ginásio demonstrativo · São Paulo',status:'soon',modality:'Gi',price:14990,lot:'Em breve',code:'SAO',subtitle:'Uma nova etapa. A mesma vontade de vencer.',categoryIds:CATEGORIES.map(c=>c.id),edition:'03',regulationVersion:'DEMO-0.2'}
];
export function createCommerceDemo(){
 const confirmed=[['Lucas Almeida','Equipe Cerrado','adulto-azul-leve'],['Pedro Santos','Atlas Jiu-Jitsu','adulto-azul-leve'],['Rafael Oliveira','Raiz Brasília','adulto-azul-medio'],['Bruno Costa','Nova Guarda','adulto-azul-medio'],['André Moura','Equipe Cerrado','master-branca-medio'],['Diego Nunes','Raiz Brasília','master-branca-medio'],['Marina Souza','Nova Guarda','adulto-roxa-feminino'],['Ana Carvalho','Equipe Cerrado','adulto-roxa-feminino']].map(([name,team,categoryId],i)=>({id:`demo-paid-${i+1}`,athleteId:`seed-${i+1}`,athlete:{name,team},eventId:'arena-brasilia',categoryId,status:'active',amountCents:13990,currency:'BRL',regulationVersion:'DEMO-0.2',createdAt:'2026-11-18T12:00:00Z',payment:{id:`demo-pay-${i+1}`,status:'confirmed',confirmedAt:'2026-11-18T12:00:00Z'}}));
 return {schemaVersion:2,revision:0,profile:null,registrations:confirmed,audit:[]};
}
export function publicChecking(state,eventId){return state.registrations.filter(r=>r.eventId===eventId&&r.status==='active'&&r.payment.status==='confirmed').map(r=>({athleteId:r.athleteId,name:r.athlete.name,team:r.athlete.team,categoryId:r.categoryId})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));}
export function availableCategories(profile,event){return CATEGORIES.filter(c=>event.categoryIds.includes(c.id)&&c.belt===profile.belt&&c.sex===profile.sex&&Number(event.date.slice(0,4))-profile.birthYear>=c.minAge);}
export function reduceCommerce(input,command,now=new Date().toISOString()){
 const state=structuredClone(input),fail=message=>{throw new Error(message);};
 if(command.type==='profile'){
  if(state.profile)fail('O perfil demonstrativo já foi criado.');
  const p=command.profile;
  if(!p.name?.trim()||!p.team?.trim()||p.name.length>100||p.team.length>100)fail('Preencha nome esportivo e equipe.');
  if(!['Masculino','Feminino'].includes(p.sex)||!['Branca','Azul','Roxa'].includes(p.belt))fail('Selecione sexo e faixa do exemplo.');
  if(!Number.isInteger(p.birthYear)||p.birthYear<1940||p.birthYear>2008)fail('Use um ano de nascimento adulto válido para a demonstração.');
  state.profile={id:'local-demo-athlete',name:p.name.trim(),team:p.team.trim(),belt:p.belt,sex:p.sex,birthYear:p.birthYear};
 }else if(command.type==='register'){
  if(!state.profile)fail('Crie primeiro seu perfil demonstrativo.');
  const event=EVENTS.find(e=>e.id===command.eventId);if(!event||event.status!=='open')fail('As inscrições desta competição não estão abertas.');
  if(!command.acceptedRegulation)fail('Leia e aceite o edital demonstrativo.');
  if(!availableCategories(state.profile,event).some(c=>c.id===command.categoryId))fail('Escolha uma categoria compatível com o perfil.');
  if(state.registrations.some(r=>r.eventId===event.id&&r.athleteId===state.profile.id&&r.status==='active'))fail('Você já possui uma inscrição ativa nesta competição.');
  const id=`demo-reg-${state.revision+1}`;
  state.registrations.push({id,athleteId:state.profile.id,athlete:{name:state.profile.name,team:state.profile.team},eventId:event.id,categoryId:command.categoryId,status:'active',amountCents:event.price,currency:'BRL',regulationVersion:event.regulationVersion,createdAt:now,payment:{id:`demo-pay-${id}`,status:'pending',confirmedAt:null}});
 }else if(command.type==='simulate_verified_payment'){
  // Deliberately named simulation; never used as an actual provider webhook.
  const r=state.registrations.find(r=>r.id===command.registrationId&&r.athleteId===state.profile?.id);
  if(!r||r.status!=='active')fail('Inscrição demonstrativa não encontrada.');
  if(r.payment.status!=='pending')fail('O pagamento já foi processado.');
  r.payment.status='confirmed';r.payment.confirmedAt=now;
 }else fail('Operação desconhecida.');
 state.revision++;state.audit.push({action:command.type,at:now,revision:state.revision});return state;
}
