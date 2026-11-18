# BJJ Arena · versão 0.2

Sistema de gestão de competições de jiu-jitsu do ecossistema BJJ Digital. Esta versão de desenvolvimento substitui a página de espera por três áreas navegáveis e mantém o laboratório esportivo da primeira versão.

## Marca oficial

Logo original: `assets/logo_bjj_arena_ofc.png`, preservada sem redesenho. Paleta: vermelho, preto e tons de prata/cinza. A logo já era referenciada pela página original deste repositório em `bjjdigital.com.br/imagens/logo_bjj_arena_ofc.png`.

## Páginas

| Entrada | Função |
| --- | --- |
| `index.html` | Competições abertas/em breve, filtros, página do evento, edital, inscrição e checagem pública. |
| `atleta.html` | Cadastro demonstrativo do atleta, inscrições, situação do pagamento e acesso à checagem. |
| `gestor.html` | Painel do evento, inscrições, pagamentos, checagem e consulta ao edital. |
| `operacao/index.html` | Laboratório esportivo: placar, chaves, resultados e classificação parcial. Usa dados de teste próprios. |

## Regra de pagamento e publicação

1. Criar um cadastro de atleta não publica seu nome.
2. Criar uma inscrição gera pagamento **pendente**.
3. Abrir um checkout não confirma o pagamento.
4. Na operação real, somente o servidor validará a notificação autenticada e consultará o provedor para conferir cobrança, referência, organizador, moeda, valor e estado atual.
5. Apenas inscrição ativa com pagamento **confirmado** entra na checagem pública e na seleção de participantes para chaves.
6. Eventos repetidos são idempotentes. Estorno/chargeback remove a elegibilidade, e uma confirmação atrasada não a restaura silenciosamente.

`server/registration-service.mjs` implementa esse contrato de domínio, com injeção de repositório transacional e adaptador de pagamento. Os testes usam um repositório e gateway de teste. **Ainda não há API de pagamento implantada nem conexão com um provedor real.**

## Executar e verificar

Node.js 20 ou superior, sem dependências de execução:

```sh
npm test
npm run build
```

Servir `dist/` em HTTP. Os módulos do servidor e os testes não entram no pacote estático. Não foi criado workflow do GitHub Actions.

## Limites desta demonstração

- Eventos, preços, confirmações e atletas são fictícios. Nenhuma cobrança é realizada.
- As páginas usam localStorage (`bjj-arena-platform-demo-v2`); abas na mesma origem recebem atualizações locais.
- O cadastro é um perfil demonstrativo; não é uma conta autenticada. Não há senhas ou dados de cartão no protótipo.
- O botão “Simular pagamento aprovado” existe exclusivamente para exercitar o fluxo. Ele não integra o serviço de pagamento real.
- A separação entre gestor e atleta é uma separação de interfaces, ainda sem autorização no servidor.
- O laboratório de lutas guarda seus próprios dados e não gera as chaves das novas inscrições deste módulo.
- O motor esportivo implementa apenas parte das regras de referência. Precisa de homologação antes de um evento real.

## Próxima entrega

Conectar autenticação, repositório persistente e permissões do BJJ Arena; selecionar e configurar o provedor e sua conta de recebimento; implementar o adaptador e a rota de webhook verificada; conectar as páginas à API; integrar inscrições elegíveis ao cronograma e às chaves.

O código desta branch preserva os outros produtos BJJ. A integração de identidade do ecossistema será feita por identidade verificada, sem compartilhar dados por coincidência de nomes.
