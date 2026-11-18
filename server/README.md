# API e pagamentos do BJJ Arena

`platform.mjs` está conectado às rotas `/api` da versão 0.3 e ao banco D1. Ele aplica sessão, autorização por organização, prazo, preço do evento, categoria e unicidade de inscrição ativa. A checagem é uma projeção pública limitada. Eventos desta versão são somente de teste.

`registration-service.mjs` preserva o contrato independente da integração financeira futura e seus testes. Ele não está conectado ao repositório D1 desta versão. Não importar esses módulos no navegador.

## Interface do futuro provedor

- `createCharge({ idempotencyKey, externalReference, organizerId, amountCents, currency })`: cobrança idempotente e URL de checkout pertencente ao provedor.
- `isAllowedCheckoutUrl(url)`: valida o destino de pagamento.
- `verifyAndParseWebhook({ rawBody, headers })`: valida a autenticação real da notificação e devolve `{ verified: true, id, paymentId }`.
- `fetchPayment(paymentId)`: consulta autenticada e normalização de identificador, referência, conta de recebimento, valor, moeda, estado e data de atualização.

Os estados normalizados são `pending`, `confirmed`, `settled`, `refunded`, `chargeback` e `cancelled`. Notificações repetidas ou atrasadas não podem duplicar operações ou restaurar pagamento terminal. Retorno do checkout ao navegador nunca confirma uma inscrição.

## Lacunas antes de dinheiro real

Definir provedor/conta, implementar o adaptador, repositório transacional e webhook real, reconciliação e políticas de expiração/reembolso, além de testar o sandbox oficial. A rota de simulação é restrita a gestão e `kind=test`, com auditoria e `payment_source=test`. As rotas reais permanecem indisponíveis.
