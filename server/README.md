# API e pagamentos do BJJ Arena

`platform.mjs` está conectado às rotas `/api` da versão 0.4 e ao banco D1. Ele aplica sessão, autorização por organização, prazo, preço do evento, categoria e unicidade de inscrição ativa. A checagem é uma projeção pública limitada. Eventos desta versão são somente de teste.

`registration-service.mjs` preserva o contrato independente da integração financeira futura e seus testes. Ele não está conectado ao repositório D1 desta versão. Não importar esses módulos no navegador.

## Interface do futuro provedor

- `createCharge({ idempotencyKey, externalReference, organizerId, amountCents, currency })`: cobrança idempotente e URL de checkout pertencente ao provedor.
- `isAllowedCheckoutUrl(url)`: valida o destino de pagamento.
- `verifyAndParseWebhook({ rawBody, headers })`: valida a autenticação real da notificação e devolve `{ verified: true, id, paymentId }`.
- `fetchPayment(paymentId)`: consulta autenticada e normalização de identificador, referência, conta de recebimento, valor, moeda, estado e data de atualização.

Os estados normalizados são `pending`, `confirmed`, `settled`, `refunded`, `chargeback` e `cancelled`. Notificações repetidas ou atrasadas não podem duplicar operações ou restaurar pagamento terminal. Retorno do checkout ao navegador nunca confirma uma inscrição.

## Lacunas antes de dinheiro real

Definir provedor/conta, implementar o adaptador, repositório transacional e webhook real, reconciliação e políticas de expiração/reembolso, além de testar o sandbox oficial. A rota de simulação é restrita a gestão e `kind=test`, com auditoria e `payment_source=test`. As rotas reais permanecem indisponíveis.

## Operação esportiva

`competition.mjs` recebe apenas inscrições ativas e confirmadas, armazena o sorteio e os estados de luta em `arena_competitions` e usa o motor de `operacao/engine.mjs` no servidor. Geração, publicação e comandos exigem autorização da organização. A versão do agregado e a versão de elegibilidade do evento entram nas condições de escrita atômica. A consulta pública lê publicação e elegibilidade em uma única consulta para manter um snapshot coerente.

As rotas `/api/events/:id/competition` e suas ações `generate`, `publication` e `commands` atendem a gestão. `/api/events/:id/brackets` entrega somente a projeção esportiva publicada. Peso de conferência, identidade de acesso e auditoria ficam fora dessa projeção.
