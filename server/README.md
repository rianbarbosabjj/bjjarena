# Contrato do servidor de inscrições

Este diretório contém lógica de domínio testada. Não representa uma API implantada. Nunca importar este serviço no navegador.

## Autenticação e repositório

A camada HTTP futura deve validar a sessão no servidor e passar `session.userId`. O repositório deve oferecer `transaction(callback)`, `getRegistration(id)` e `listRegistrations(eventId)`; dentro da transação: `getEvent`, `getProfile`, `getRegistration`, `findActiveRegistration`, `saveRegistration`, `hasProviderEvent` e `recordProviderEvent`.

São necessárias transações reais, unicidade de inscrição ativa por atleta/evento, unicidade de identificação do evento do provedor e vínculo único de cobrança. As funções de gestão precisam de autorização por organizador/evento, e a consulta pública precisa respeitar a publicação e o calendário de checagem do evento.

## Adaptador do provedor

Interface obrigatória:

- `createCharge({ idempotencyKey, externalReference, organizerId, amountCents, currency })` retorna identificador estável e URL do checkout. Repetições devem recuperar a mesma cobrança.
- `isAllowedCheckoutUrl(url)` valida destinos de checkout que pertencem ao provedor configurado.
- `verifyAndParseWebhook({ rawBody, headers })` verifica o mecanismo real de autenticação do provedor e retorna `{ verified: true, id, paymentId }` somente quando autenticado. O corpo original deve chegar sem alteração à verificação.
- `fetchPayment(paymentId)` consulta a API autenticada do provedor e normaliza `{ id, externalReference, organizerId, amountCents, currency, status, updatedAt }`.

Os estados normalizados são `pending`, `confirmed`, `settled`, `refunded`, `chargeback` e `cancelled`. A data deve representar a atualização autoritativa do pagamento. A implementação do adaptador deve conferir os eventos, os valores e os estados específicos do provedor escolhido; não presumir que ele utiliza esses mesmos nomes.

Em indisponibilidade do provedor, a confirmação falha sem publicar o atleta. Notificações repetidas e fora de ordem não geram publicações duplicadas nem recuperam um pagamento terminal. O retorno do checkout ao navegador não chama uma função que marca o pagamento como confirmado.

Antes de ligar pagamentos reais, implementar persistência, autorizações, verificação do provedor, reconciliação, políticas de expiração/estorno e ensaio com o sandbox oficial. Não há credenciais neste repositório.
