# BJJ Arena · versão 0.4

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

## Chaves e lutas integradas nesta versão

A gestão possui o módulo **Chaves e lutas**. Após encerrar as inscrições, o gestor gera um sorteio usando exclusivamente inscrições ativas e confirmadas, revisa o rascunho e publica os confrontos. A semente e a versão do algoritmo são preservadas para reproduzir a ordem; o sorteio ainda não aplica separação por equipe nem cabeças de chave homologados.

O servidor guarda o estado esportivo do evento: conferência de peso e uniforme, cronômetro, pontos, vantagens, punições, desfazer marcações, resultado por finalização/placar/decisão/W.O., avanço e pódio. A forma da vitória é preservada; finalização não se transforma em pontos artificiais. Placar e decisão por empate exigem o término do tempo, e o portal não oferece comando para antecipá-lo.

Cada comando usa a versão atual do agregado e grava estado e auditoria no mesmo lote D1. Comandos desatualizados falham sem duplicar pontos ou avançar duas vezes. Uma área não aceita duas lutas com relógio em andamento. Ainda falta concessão de controle por mesa e ensaio de carga distribuída para operação real.

Enquanto as inscrições estiverem abertas ou em breve, o público consulta apenas a checagem de atletas confirmados, sem aba nem atalho de chaves. Um link direto de chaves conduz à checagem. Depois do encerramento, a página do evento libera a aba **Chaves e resultados**, e o atleta pode acompanhar a chave a partir da sua inscrição. Os confrontos só são exibidos após a publicação pelo gestor; o servidor também bloqueia sua consulta antecipada. A consulta recebe uma projeção de dados esportivos; peso medido, ano de nascimento, identidade de acesso, pagamentos e histórico interno não são publicados. O acompanhamento atualiza a cada oito segundos; o relógio exibido usa a referência temporal recebida do servidor.

Uma alteração de elegibilidade, como estorno ou confirmação tardia, coloca a chave publicada em revisão e retira sua projeção pública. Operações ficam bloqueadas sem reescrever resultados anteriores. Antes de qualquer conferência/placar, é possível retirar a publicação e sortear novamente; a revisão após o início é uma próxima entrega. Não se reabrem inscrições com chaves publicadas.

Limites: eventos de teste, recorte Gi adulto/master, até 64 atletas por categoria e de uma a oito áreas distribuídas de forma simples. As categorias de três atletas, os avanços livres e o atleta único reutilizam o motor inicial. Cronograma, descanso, revisão de resultados e conformidade esportiva completa permanecem pendentes.

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

- `db/schema.ts` define organizações, vínculos, perfis, eventos, inscrições, auditoria e agregados esportivos. As migrações SQL e metadados estão em `drizzle/`.
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

Os testes cobrem o motor esportivo, a ligação entre inscrições e chaves, a operação persistida, o contrato de pagamentos e a API: isolamento de organizadores, pendência fora da checagem, confirmação restrita, estorno, unicidade, prazo no fuso do evento, aceitação de edital, preço autoritativo, privacidade, conflitos de versão, rollback e persistência após reabrir o banco. O ensaio SQLite não substitui teste concorrente em D1 distribuído ou carga de campeonato real.

O starter Vinext e as integrações de hospedagem são preservados. Não foi criado workflow do GitHub Actions. Não há credenciais compartilhadas com BJJ Manager, Sign ou Exams.

## Próximas entregas

Conectar o provedor real e a confirmação verificada; completar e homologar a matriz esportiva; homologar sorteio e separar equipes/cabeças de chave; construir cronograma e descanso; atribuir funções e controle por mesa; implementar revisão de resultados; ensaiar concorrência, perda de conexão, backup e restauração antes do piloto.
