import {randomUUID} from 'node:crypto';

export class RegistrationError extends Error{constructor(message,status=400){super(message);this.status=status;}}
const requireValue=(condition,message,status=400)=>{if(!condition)throw new RegistrationError(message,status);};
const PAID=new Set(['confirmed','settled']);
const TERMINAL=new Set(['refunded','chargeback','cancelled']);

/** Server-only domain service. The gateway and a transactional repository must be configured.
 * No client-supplied payment state or fee is accepted. This is not a deployed payment API.
 */
export class RegistrationService{
 constructor({repository,gateway,now=()=>new Date().toISOString(),id=randomUUID}){this.repo=repository;this.gateway=gateway;this.now=now;this.id=id;}
 async createRegistration(session,{eventId,categoryId,acceptedRegulationVersion}){
  requireValue(session?.userId,'Autenticação necessária.',401);
  return this.repo.transaction(async tx=>{
   const event=await tx.getEvent(eventId),profile=await tx.getProfile(session.userId),now=this.now();
   requireValue(event&&event.status==='open','Inscrições indisponíveis.',409);
   requireValue(Date.parse(now)>=Date.parse(event.opensAt)&&Date.parse(now)<Date.parse(event.closesAt),'Fora do prazo de inscrição.',409);
   requireValue(profile?.id===session.userId,'Perfil do atleta não encontrado.',403);
   requireValue(event.regulationVersion===acceptedRegulationVersion,'A versão atual do edital deve ser aceita.');
   const category=event.categories.find(c=>c.id===categoryId);
   requireValue(category,'Categoria não encontrada.');
   requireValue(category.belt===profile.belt&&category.sex===profile.sex&&Number(event.date.slice(0,4))-profile.birthYear>=category.minAge,'Categoria incompatível com o atleta.');
   requireValue(!(await tx.findActiveRegistration(eventId,session.userId)),'Já existe uma inscrição ativa nesta competição.',409);
   requireValue(Number.isInteger(event.priceCents)&&event.priceCents>0,'Preço do evento inválido.',409);
   const registration={id:this.id(),eventId,organizerId:event.organizerId,athleteId:session.userId,athlete:{name:profile.name,team:profile.team},categoryId,status:'active',amountCents:event.priceCents,currency:'BRL',regulationVersion:event.regulationVersion,createdAt:now,payment:{providerId:null,status:'pending',updatedAt:null,confirmedAt:null}};
   await tx.saveRegistration(registration);return registration;
  });
 }
 async createCheckout(session,registrationId){
  requireValue(session?.userId,'Autenticação necessária.',401);
  requireValue(this.gateway?.createCharge,'Provedor de pagamentos ainda não configurado.',503);
  const registration=await this.repo.getRegistration(registrationId);
  requireValue(registration?.athleteId===session.userId,'Inscrição não encontrada.',404);
  requireValue(registration.status==='active'&&registration.payment.status==='pending','Esta inscrição não permite nova cobrança.',409);
  // The adapter must use this key as provider idempotency key and return an existing charge on retries.
  const charge=await this.gateway.createCharge({idempotencyKey:registration.id,externalReference:registration.id,organizerId:registration.organizerId,amountCents:registration.amountCents,currency:registration.currency});
  requireValue(charge?.id&&typeof charge.checkoutUrl==='string','Resposta inválida do provedor.',502);
  let url;try{url=new URL(charge.checkoutUrl);}catch{throw new RegistrationError('URL de pagamento inválida.',502);}
  requireValue(url.protocol==='https:'&&this.gateway.isAllowedCheckoutUrl?.(url),'Destino de pagamento não autorizado.',502);
  await this.repo.transaction(async tx=>{
   const current=await tx.getRegistration(registrationId);
   requireValue(current?.payment.status==='pending','Pagamento já atualizado.',409);
   requireValue(!current.payment.providerId||current.payment.providerId===charge.id,'Cobrança conflitante.',409);
   current.payment.providerId=charge.id;await tx.saveRegistration(current);
  });
  // A checkout URL does not confirm payment and never changes publication eligibility.
  return {checkoutUrl:charge.checkoutUrl,paymentStatus:'pending'};
 }
 async handleWebhook({rawBody,headers}){
  requireValue(this.gateway?.verifyAndParseWebhook&&this.gateway?.fetchPayment,'Provedor de pagamentos ainda não configurado.',503);
  // Adapter verifies the raw body/header credentials according to the actual provider contract.
  const notice=await this.gateway.verifyAndParseWebhook({rawBody,headers});
  requireValue(notice?.verified===true&&notice.id&&notice.paymentId,'Notificação não autenticada.',401);
  // Verify current provider state independently. Never trust a status from the browser or webhook alone.
  const payment=await this.gateway.fetchPayment(notice.paymentId);
  requireValue(payment?.id===notice.paymentId&&payment.externalReference,'Cobrança não reconhecida.',409);
  requireValue(Number.isFinite(Date.parse(payment.updatedAt)),'Data de pagamento inválida.',409);
  return this.repo.transaction(async tx=>{
   if(await tx.hasProviderEvent(notice.id))return {duplicate:true};
   const r=await tx.getRegistration(payment.externalReference);
   requireValue(r&&r.status==='active'&&r.payment.providerId===payment.id,'Cobrança sem vínculo com a inscrição.',409);
   requireValue(payment.organizerId===r.organizerId,'Conta de pagamento incompatível.',409);
   requireValue(payment.amountCents===r.amountCents&&payment.currency===r.currency,'Valor ou moeda divergente.',409);
   const status=PAID.has(payment.status)?'confirmed':payment.status;
   requireValue(['pending','confirmed','refunded','chargeback','cancelled'].includes(status),'Estado de pagamento não suportado.',409);
   const stale=r.payment.updatedAt&&Date.parse(payment.updatedAt)<=Date.parse(r.payment.updatedAt);
   if(stale||(TERMINAL.has(r.payment.status)&&!TERMINAL.has(status))){await tx.recordProviderEvent({id:notice.id,registrationId:r.id,at:this.now(),ignored:true});return {ignored:true};}
   r.payment.status=status;r.payment.updatedAt=payment.updatedAt;
   if(status==='confirmed'&&!r.payment.confirmedAt)r.payment.confirmedAt=this.now();
   await tx.saveRegistration(r);await tx.recordProviderEvent({id:notice.id,registrationId:r.id,at:this.now(),status});
   return {confirmed:status==='confirmed',registrationId:r.id};
  });
 }
 async publicChecking(eventId){return (await this.repo.listRegistrations(eventId)).filter(r=>r.status==='active'&&r.payment.status==='confirmed').map(r=>({athleteId:r.athleteId,name:r.athlete.name,team:r.athlete.team,categoryId:r.categoryId}));}
 async bracketParticipants(eventId){return this.publicChecking(eventId);}
}
