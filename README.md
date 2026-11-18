# BJJ Arena · versão 0.3

Gestão de competições de jiu-jitsu com a marca oficial BJJ Arena. As páginas de competições, atleta e gestor agora usam uma API autenticada e banco D1. O ambiente publicado permanece privado e exclusivo para desenvolvimento: todos os eventos criados são de teste e não realizam cobranças.

## Entrega desta versão

- Identidade fornecida pelo acesso autenticado da hospedagem, com ID estável por site. O perfil esportivo é vinculado à sessão no servidor; o navegador não escolhe o usuário de uma inscrição.
- Cadastro de organização e vínculo de proprietário. Cada gestor acessa apenas os eventos da sua organização. A criação idempotente permite uma organização por proprietário nesta etapa.
- Criação e revisão de rascunho de evento de teste com data, prazo, local, preço em centavos, categorias disponíveis e texto do edital.
- Ciclo do evento: rascunho → publicado/em breve → inscrições abertas → inscrições encerradas, com versão para detectar comandos desatualizados.
- Perfil do atleta persistido, inscrições pendentes e consulta pelo portal. O servidor confere categoria, prazo, edital aceito e preço; uma restrição única impede duplicidade ativa.
- A checagem pública contém somente identificador da inscrição, nome esportivo, equipe e categoria. Inscrições pendentes não aparecem.
- A confirmação/estorno de teste exige permissão de gestão do evento, mantém indicação explícita de simulação e registra auditoria. Não existe confirmação pelo portal do atleta.
- Os dados da inscrição preservam a equipe e o nome representados no momento da inscrição, mesmo após editar o perfil.
- CSV de inscrições e histórico de operações por evento.

## Entradas

| Página | Função |
| --- | --- |
| `/index.html` | Competições publicadas, edital, inscrição e checagem. |
| `/atleta.html` | Perfil esportivo, inscrições e situação do pagamento. |
| `/gestor.html` | Organização, criação/publicação de eventos, inscritos, operações de teste e histórico. |
| `/operacao/index.html` | Laboratório esportivo anterior: placar e chaves com dados fictícios próprios salvos no navegador. Ainda não usa as inscrições da API. |

Os três portais usam dados do servidor. Não há importação automática dos dados locais do protótipo 0.2. As cores vermelho, preto e prata/cinza e a logo original `assets/logo_bjj_arena_ofc.png` foram preservadas.

## Pagamentos

Nenhuma cobrança real está habilitada. O serviço `server/registration-service.mjs` preserva o contrato e os testes do adaptador futuro: autenticar a notificação e consultar a cobrança no provedor, validando valor, moeda, conta, referência e estado atual. Ele ainda não está conectado às rotas desta versão.

A rota `/api/registrations/:id/test-payment` é restrita a gestor e a eventos `kind=test`; registra `payment_source=test`. Um evento estornado não volta a ser confirmado por uma mensagem atrasada. As rotas de pagamento real respondem indisponível. Antes de abrir inscrições reais, concluir o adaptador, webhook e repositório transacional do fluxo real, definir conta de recebimento e validar o sandbox.

## Persistência e autorização

- `db/schema.ts` define organizações, vínculos, perfis, eventos, inscrições e auditoria. As migrações SQL e metadados estão em `drizzle/`.
- `server/platform.mjs` contém regras de acesso e operações D1. Escritas relacionadas usam `batch()` atômico; perfis, eventos e inscrições usam controle de versão.
- `app/api/[...path]/route.ts` obtém a identidade autenticada pela hospedagem e encaminha as operações. Os cabeçalhos de identidade só são confiáveis atrás da fronteira da hospedagem; não expor esse Worker diretamente sem filtragem equivalente.
- Escritas exigem JSON e origem igual à aplicação; respostas da API usam `private, no-store`. Nenhuma credencial integra o código do navegador.
- `.openai/hosting.json` mantém a identidade da hospedagem e o vínculo `DB`. A migração é aplicada pela publicação; não se criam tabelas durante requisições.
- Os arquivos HTML, CSS e JS da raiz são autorais. `scripts/sync-assets.mjs` gera `public/` antes de iniciar o preview e de compilar; não editar cópias em `public/`.

## Verificação

Node.js 22.13 ou superior. Os testes da plataforma persistente usam `node:sqlite`, disponível no runtime Node 24 utilizado na entrega.

```sh
npm test
npm run db:generate
npm run build
```

Os testes cobrem o motor esportivo anterior, o contrato de pagamentos e a nova API: isolamento de organizadores, pendência fora da checagem, confirmação restrita, estorno, unicidade, prazo no fuso do evento, aceitação de edital, preço autoritativo, privacidade, conflitos de versão, rollback e persistência após reabrir o banco. O ensaio SQLite não substitui teste concorrente em D1 distribuído ou carga de campeonato real.

O starter Vinext e as integrações de hospedagem são preservados. Não foi criado workflow do GitHub Actions. Não há credenciais compartilhadas com BJJ Manager, Sign ou Exams.

## Próximas entregas

Conectar o provedor real e a confirmação verificada; completar e homologar a matriz esportiva; integrar inscrições elegíveis às chaves e ao cronograma; atribuir funções operacionais por evento; sincronizar placar e resultados entre dispositivos; ensaiar concorrência, perda de conexão, backup e restauração antes do piloto.
