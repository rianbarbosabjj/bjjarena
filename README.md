# BJJ Arena · versão 0.7

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

Cada comando usa a versão atual do agregado e grava estado e auditoria no mesmo lote D1. Comandos desatualizados falham sem duplicar pontos ou avançar duas vezes. Uma área mantém uma única luta iniciada, inclusive durante pausas, até a confirmação do resultado. Ainda falta concessão de controle por mesa e ensaio de carga distribuída para operação real.

Enquanto as inscrições estiverem abertas ou em breve, o público consulta apenas a checagem de atletas confirmados, sem aba nem atalho de chaves. Um link direto de chaves conduz à checagem. Depois do encerramento, a página do evento libera a aba **Chaves e resultados**, e o atleta pode acompanhar a chave a partir da sua inscrição. Os confrontos só são exibidos após a publicação pelo gestor; o servidor também bloqueia sua consulta antecipada. A consulta recebe uma projeção de dados esportivos; peso medido, ano de nascimento, identidade de acesso, pagamentos e histórico interno não são publicados. O acompanhamento atualiza a cada oito segundos; o relógio exibido usa a referência temporal recebida do servidor.

Uma alteração de elegibilidade, como estorno ou confirmação tardia, coloca a chave publicada em revisão e retira sua projeção pública. Operações ficam bloqueadas sem reescrever resultados anteriores. Antes de qualquer conferência/placar, é possível retirar a publicação e sortear novamente; a revisão seletiva descrita abaixo permite refazer categorias afetadas que ainda não foram operadas. Não se reabrem inscrições com chaves publicadas.

Limites: eventos de teste, recorte Gi adulto/master, até 64 atletas por categoria e de uma a oito áreas distribuídas de forma simples. As categorias de três atletas, os avanços livres e o atleta único reutilizam o motor inicial. A revisão de resultados e a conformidade esportiva completa permanecem pendentes.

## Cronograma, chamadas e descanso (0.5)

A gestão possui **Cronograma e chamadas**. Depois de publicar as chaves, defina data/hora em Brasília (UTC−03) e intervalo de troca de zero a 600 segundos. A fila estima os horários por área a partir da duração das lutas, classificatórias, descanso, relógio em andamento e resultados já confirmados. As previsões avançam com o horário do servidor e não são uma promessa de início exato. Sem horário definido, ainda é possível chamar e operar as lutas, com indicação de previsão a definir.

É possível mudar uma luta ainda não chamada/iniciada de área e posição. O servidor rejeita ordens que coloquem uma luta antes da sua classificatória, inclusive dependências circulares entre áreas. Lutas chamadas precisam ter sua chamada cancelada antes da mudança. Lutas iniciadas ou concluídas não podem ser remanejadas.

Cada luta aceita até três chamadas auditadas e confirmação/retração de presença dos participantes definidos. A conferência de peso/uniforme continua independente da presença na chamada. O início exige os dois atletas aprovados e presentes, descanso cumprido e área livre. Uma luta pausada reserva a área; retomar a mesma luta não reinicia o descanso. Um W.O. por ausência é manual, exige três chamadas, vencedor presente/aprovado e adversário ausente, antes do início. Três chamadas nunca eliminam automaticamente. Essa sequência é uma política operacional de teste do Arena, não uma reprodução integral do procedimento da federação.

O perfil de descanso usa a duração da categoria entre lutas e o dobro antes da final. Conta a partir do resultado de uma luta efetivamente disputada, também para o perdedor que retorna em chave de três atletas. W.O. e avanço livre não iniciam outro intervalo. Referência consultada em 18/11/2026: **IBJJF General Competition Guidelines, artigo 1.4**, manual oficial JUN/2024 v6.1, disponível em https://ibjjf.com/books-videos/. As alterações de 2027 e a matriz completa continuam sujeitas à homologação do perfil do evento.

O público recebe apenas a fila esportiva, horários e chamadas. Presenças, pesagem e auditoria permanecem na gestão. Chaves, cronograma e chamadas só aparecem após o encerramento das inscrições e a publicação das chaves; links antecipados direcionam para a checagem. Mudança na elegibilidade bloqueia chamadas, remanejamento e cronograma juntamente com as demais operações. Todos os comandos preservam versão, autorização e auditoria atômica.

A configuração e as chamadas são extensões compatíveis do agregado JSON existente; não há alteração das migrações aplicadas. Estados anteriores recebem valores iniciais sem reescrever resultados ou relógios. Novas lutas desses estados também passam a exigir chamada, presença e descanso; lutas que já foram iniciadas continuam podendo ser retomadas.

## Revisão seletiva das chaves (0.6)

A gestão oferece **Revisão das chaves**, com uma proposta calculada no servidor a partir das inscrições ativas e confirmadas. Ela mostra entradas, saídas, categorias preservadas, resultados preservados e chamadas que serão canceladas. Aplicar exige justificativa de 15 a 600 caracteres, confirmação explícita, versões atuais e a identificação da proposta conferida.

A revisão refaz somente categorias cuja composição mudou e que ainda não tenham luta iniciada, resultado registrado ou premiação de atleta único conferida. Conferências dos atletas mantidos são preservadas, chamadas das categorias refeitas são canceladas e as novas lutas recebem identificadores próprios. Categorias não afetadas mantêm seus confrontos, resultados, placares, áreas e relógios, inclusive se uma luta estiver em andamento. O cronograma é recalculado e a publicação informa a revisão.

Uma mudança que atinja uma categoria já operada bloqueia a proposta inteira. Trocar participantes em categorias operadas, rever resultados, retirar atletas após participação ou aplicar desistência técnica exigem um fluxo próprio ainda não implementado. A revisão desta versão não altera a situação financeira nem cria elegibilidade para atletas pendentes/estornados.

`arena_competition_reviews` guarda os estados anterior e posterior, versões, responsável e justificativa; a migração acrescenta a tabela sem alterar as migrações aplicadas. Estado esportivo, registro da revisão e auditoria são escritos no mesmo lote D1. Conflito de versão, nova mudança financeira ou falha ao guardar o histórico impede a aplicação. A versão anterior é preservada para análise; não há restauração automática pela interface.

Proposta, justificativa e estados anteriores são privados da organização. Antes do encerramento das inscrições, a API continua retendo chaves/cronograma; o usuário público recebe apenas a checagem dos confirmados. Aplicar a revisão exige inscrições encerradas e chaves já publicadas.

Validação: 97 testes automatizados, verificação TypeScript e ensaio adicional no Miniflare D1. O cenário de revisão inclui uma categoria com resultado preservado e outra que passa de dois para três atletas após confirmação tardia. A revisão visual usa um componente com dados fictícios e as chaves públicas da prévia local; o fluxo autenticado hospedado continua pendente de acesso à conta.

## Plataforma para organizadores e planos (0.7)

O produto segue o modelo definido pelo usuário: uma plataforma para vários gestores se cadastrarem, escolherem um plano e utilizarem os recursos em sua própria organização. A prévia continua privada; a abertura comercial depende de cadastro público independente, condições comerciais e cobrança real.

`/planos.html` apresenta o fluxo **cadastro da organização → escolha do plano → criação dos eventos**. Novas organizações precisam selecionar um plano de teste antes de criar eventos. A gestão oferece **Meu plano**, com comparação, confirmação explícita da escolha e ampliação de recursos. Somente o proprietário seleciona o plano; um gestor delegado continua usando os recursos liberados sem alterar a seleção comercial.

Os planos **Inscrições** e **Competição** são configurações demonstrativas, não uma definição comercial aprovada. Inscrições libera eventos/edital, inscrições, pagamento de teste e checagem; Competição inclui também chaves/conferência/placar, cronograma/chamadas e revisão. Preços, limites, duração e condições ficam indefinidos. Não há cobrança, contratação, renovação ou plano pago ativado nesta entrega. Ampliações de recursos são permitidas no teste; reduções e cancelamento dependem da futura política comercial.

O catálogo possui versão. A seleção guarda plano, versão do catálogo e recursos concedidos pelo servidor em `arena_plan_selections`, com auditoria. Dados de preço, status de pagamento ou recursos enviados pelo navegador não concedem direitos adicionais. A API aplica os bloqueios de módulos e inclui a versão da seleção nas escritas de eventos/chaves/cronograma/revisão; uma mudança concorrente impede a gravação com a autorização antiga.

A migração 0003 acrescenta a tabela de escolhas e identifica novas organizações. Os ambientes de teste anteriores mantêm acesso compatível; isso não os transforma em assinaturas comerciais. Novos cadastros são marcados pelo servidor e não podem pedir acesso legado no formulário.

O acesso da prévia ainda usa identidade do ChatGPT. A hospedagem permanece privada e sua audiência não foi ampliada. Nenhum usuário real foi convidado e nenhuma mensagem foi enviada. O fluxo completo com cadastro público independente e cobrança dos planos ainda precisa ser conectado antes da comercialização.

Validação: 111 testes automatizados aprovados, TypeScript e compilação; ensaio Miniflare D1 com dois organizadores independentes, plano obrigatório, recursos básicos, ampliação e isolamento. Revisão visual da página de planos e do atalho que conserva a opção escolhida na entrada da gestão. O fluxo autenticado de criação/seleção não foi conferido visualmente na hospedagem por exigir login; as operações foram verificadas nos serviços e no D1.

## Entradas

| Página | Função |
| --- | --- |
| `/index.html` | Competições publicadas, edital, inscrição e checagem. |
| `/planos.html` | Planos demonstrativos e entrada do organizador. |
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

Definir preços, limites e política comercial; conectar cadastro público independente, cobrança dos planos e provedor real de inscrições; completar e homologar a matriz esportiva; homologar sorteio e separar equipes/cabeças de chave; homologar a operação de cronograma, descanso e chamadas; atribuir funções e controle por mesa; implementar revisão técnica de resultados e categorias já operadas; ensaiar concorrência, perda de conexão, backup e restauração antes do piloto.
