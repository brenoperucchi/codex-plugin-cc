# Sugestões e Achados — RFC Driver do Agentic Loop

**Arquivo de origem:** `docs/plans/vamos-escreve-o-plano-twinkly-sun.md`  
**Documento complementar:** `docs/AGENTIC_LOOP_DEV_WORKFLOW.md`  
**Contexto:** `codex-plugin-cc` como motor do agentic loop, com o Driver propondo a próxima task para o projeto `contabil`.  
**Status deste arquivo:** consolidação de review, achados, recomendações e cutline de implementação v1.

---

## 1. Veredito executivo

O RFC está bem encaminhado e deve seguir para **review adversarial** e depois para um **v1 mínimo em modo dry-run**.

A decisão recomendada é:

- **Aprovar o desenho conceitual.**
- **Não implementar o fluxo completo ainda.**
- **Começar por um Driver propose-only, read-only e dry-run.**
- **Manter Gate-A humano obrigatório.**
- **Não permitir autoexecução na v1.**
- **Não escrever no inbox no primeiro corte.**
- **Não tocar zonas sensíveis sem aprovação explícita.**

O RFC acerta ao separar o problema em duas partes:

1. **Motor já existente:** `inbox-watcher`, `/codex:rescue --worktree`, review adversarial, smoke tests, Gate-B humano, commit.
2. **Controlador faltante:** descobrir próxima task, ranquear, escopar, propor, pedir aprovação e só então preparar handoff.

O caso TASK-182 mostrou que o motor funciona. O que falta é o Driver que faz o ciclo ficar mais proativo sem remover o humano dos portões críticos.

---

## 2. Achados principais

### 2.1 O RFC está certo em manter v1 como `propose-only`

A melhor decisão do RFC é tratar a v1 como um **proponente em cadência**, não como agente autônomo.

Isso reduz risco porque o Driver:

- lê backlog;
- filtra candidatas;
- escolhe uma task;
- pede ao `codex-ws --schema` para estruturar uma proposta;
- apresenta a proposta ao humano;
- só avança se houver aprovação explícita.

Esse modelo dá proatividade sem transformar o sistema em automação cega.

### 2.2 O Driver deve ser uma camada fina

O Driver não deve substituir o motor existente. Ele deve apenas orquestrar:

```text
Discover → Select → Propose → Gate-A → Handoff opcional → Motor existente
```

O motor Execute/Verify não deve mudar na v1.

### 2.3 O seletor deve ser determinístico

A seleção inicial não deve depender de LLM.

O selector deve usar sinais objetivos já existentes:

- `status: To Do`;
- dependências concluídas;
- milestone mais próxima;
- prioridade;
- data de criação;
- ausência de zona sensível;
- existência de acceptance criteria executáveis;
- dedup/deferred state.

O LLM só entra depois, para estruturar `scope`, `ACs`, `verify_plan`, riscos e justificativa.

### 2.4 A estimativa de tamanho é o maior risco técnico da proposta

A regra “≤5 arquivos / ≤150 LOC” é boa como intenção, mas não deve depender apenas do LLM.

LLMs podem subestimar escopo. Isso é aceitável na v1 propose-only, mas perigoso para v2.

Recomendação:

- heurística determinística primeiro;
- proposer retorna `estimated_files`, `estimated_loc` e `estimate_confidence`;
- `confidence < 0.7` vira `needs_human_sizing`;
- `unknown` deve ser tratado como **não seguro**;
- para v2, exigir metadados humanos na task, como `expected_files`, `risk_zone` e `auto_eligible`.

### 2.5 O estado de dedup deve ficar em `.state/<id>.yml`

Não recomendo criar `status: Deferred` dentro da task markdown.

`Deferred` é estado operacional temporário, não estado real do backlog. A task pode continuar `To Do`, mas não deve reaparecer imediatamente.

Melhor formato:

```yaml
task_id: TASK-123
deferred: true
reason: "Escopo maior que 5 arquivos"
deferred_by: "human"
deferred_at: "2026-06-22T21:40:00Z"
deferred_until: null
task_fingerprint: "sha256-do-conteudo-da-task"
```

O campo `task_fingerprint` é importante. Se a task for editada e reescopada, o defer antigo pode expirar automaticamente.

### 2.6 Detecção de zona sensível deve ser fail-closed

Para v1, label + path-glob é suficiente porque nada executa sozinho.

Para v2, recomendo **duplo gate**:

```text
auto_eligible: true
AND
não bate em denylist de zona sensível
AND
tem AC executável
AND
tem expected_files
AND
passa no selector
```

`auto_eligible: true` deve ser whitelist explícita, mas nunca deve substituir o filtro de zona sensível.

### 2.7 Cadência deve começar on-demand

Não recomendo relógio fixo no início.

Começar com:

```bash
/loop propose
```

ou:

```bash
node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run
```

Depois de 1 ou 2 semanas de propostas úteis, testar cadência diária.

### 2.8 Uma proposta por rodada é melhor que shortlist top-3

Não recomendo apresentar 3 propostas completas. Isso aumenta carga cognitiva e incentiva rubber-stamp.

Melhor:

```text
Proposta principal: TASK-123
Por que agora: ...

Por que as próximas não entraram:
- TASK-124: bloqueada por dependency
- TASK-125: zona sensível
- TASK-126: sem AC executável
```

Isso permite auditar o selector sem transformar a decisão em uma lista grande demais.

### 2.9 `why_now` deve ser baseado em evidência

O Driver pode gerar `why_now`, mas não deve inventar narrativa.

O ideal é retornar também `why_now_evidence`:

```json
{
  "why_now": "TASK-182 está em milestone m-1, priority high e todas as dependências estão Done.",
  "why_now_evidence": [
    "milestone=m-1",
    "priority=high",
    "dependencies_done=true",
    "created_date=2026-06-20"
  ]
}
```

Para v2, se a task tiver `why_now:` no frontmatter, o Driver deve usar o valor humano como fonte principal.

### 2.10 Handoff deve ser separado da proposta

Não recomendo que o mesmo comando proponha e escreva no inbox.

Melhor fluxo:

```bash
node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run
```

Isso gera:

```text
proposal_id: prop_20260622_001
```

Após aprovação humana:

```bash
node tools/driver.mjs approve prop_20260622_001 --write-inbox
```

Assim, o Driver não “propõe e age” no mesmo passo. Ele propõe, congela a proposta, espera aprovação e só então escreve o handoff.

---

## 3. Mudanças recomendadas no RFC antes de implementar

### 3.1 Adicionar seção “Contrato do Proposal Artifact”

O RFC precisa definir formalmente o artefato gerado pelo Driver.

Sugestão:

```json
{
  "proposal_id": "prop_YYYYMMDD_NNN",
  "task_id": "TASK-182",
  "task_fingerprint": "sha256",
  "selected_by": {
    "milestone": "m-1",
    "priority": "high",
    "dependencies_done": true,
    "created_date": "2026-06-20"
  },
  "scope": "...",
  "acceptance_criteria": [],
  "verify_plan": [],
  "estimated_files": 4,
  "estimated_loc": 120,
  "estimate_confidence": 0.74,
  "zone": "safe|sensitive|unknown",
  "why_now": "...",
  "why_now_evidence": [],
  "risks": [],
  "decision": "pending|approved|rejected|deferred"
}
```

Esse contrato resolve:

- rastreabilidade;
- dedup;
- aprovação;
- auditoria;
- comparação entre proposta e execução real;
- base futura para v2.

### 3.2 Adicionar regra: o proposer não pode fortalecer AC fraco sozinho

Se a task não possui acceptance criteria executável, ela deve ir para fila humana de planejamento.

Regra sugerida:

> O proposer pode reformular ACs para clareza, mas não pode transformar uma task sem critério verificável em uma task “executável” sozinho. Se os ACs forem fracos, ambíguos ou não testáveis, a proposta deve sair como `needs_planning`.

### 3.3 Adicionar estados explícitos de decisão

Cada proposta deve terminar em um dos estados:

```text
pending
approved
rejected
deferred
needs_planning
needs_human_sizing
sensitive_advisory
```

### 3.4 Separar `propose`, `approve` e `defer`

Recomendo três comandos ou subcomandos:

```bash
node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run
node tools/driver.mjs approve prop_YYYYMMDD_NNN --write-inbox
node tools/driver.mjs defer prop_YYYYMMDD_NNN --reason "escopo grande demais"
```

A v1 pode implementar apenas `propose --dry-run`.

### 3.5 Registrar “por que as próximas não foram escolhidas”

Além da proposta principal, o output deve mostrar descartes relevantes.

Exemplo:

```json
{
  "selected": "TASK-182",
  "rejected_candidates_summary": [
    {
      "task_id": "TASK-190",
      "reason": "dependency_not_done"
    },
    {
      "task_id": "TASK-191",
      "reason": "sensitive_zone: billing"
    },
    {
      "task_id": "TASK-192",
      "reason": "missing_executable_acceptance_criteria"
    }
  ]
}
```

Isso reduz opacidade do selector e ajuda a detectar erro de priorização.

---

## 4. Respostas às perguntas abertas do RFC

### Q1. Estimativa de tamanho pré-execução

Não confiar no `codex-ws` sozinho.

Recomendação:

- usar heurística determinística;
- pedir ao proposer `estimated_files`, `estimated_loc`, `estimate_confidence`;
- se `estimate_confidence < 0.7`, marcar `needs_human_sizing`;
- se tamanho for desconhecido, tratar como não seguro;
- para v2, exigir campos humanos de sizing na task.

### Q2. Local do estado de dedup

Usar `.state/<id>.yml` com `task_fingerprint`.

Não recomendo `status: Deferred` na task porque mistura backlog com estado operacional.

### Q3. Detecção de zona sensível

Para v1: label + path-glob fail-closed é suficiente.

Para v2: exigir `auto_eligible: true` como whitelist explícita, além da denylist de zonas sensíveis.

### Q4. Cadência vs runaway

Começar on-demand dentro do `/loop`.

Depois, testar 1×/dia se as propostas forem boas e não gerarem ruído.

### Q5. Dono do `why_now`

Híbrido:

- se a task tiver `why_now` humano no frontmatter, usar isso;
- se não tiver, o Driver gera com base em evidências objetivas;
- sempre retornar `why_now_evidence`.

### Q6. Uma proposta vs shortlist top-3

Uma proposta principal por rodada.

Mostrar apenas um resumo dos candidatos descartados e o motivo.

### Q7. Ponte do handoff

Escrever handoff somente após aprovação explícita.

Não fazer `propose` e `write-inbox` no mesmo comando.

---

## 5. Cutline recomendado para v1 mínimo

Implementar apenas:

1. `tools/driver.mjs propose --contabil-dir ... --dry-run`;
2. parser de task markdown;
3. selector determinístico;
4. detector de zona sensível fail-closed;
5. dedup read-only;
6. `propose.schema.json`;
7. 1 chamada `codex-ws --schema`;
8. output JSON + markdown;
9. testes unitários com fixtures.

Não implementar ainda:

- `approve`;
- `--write-inbox`;
- gravação real em `.state`;
- integração real com `inbox-watcher`;
- modo auto;
- clock diário;
- qualquer escrita em backlog ou inbox.

---

## 6. Plano de implementação v1 sugerido

### Fase 1 — fixtures e parser

Criar fixtures de tasks markdown cobrindo:

- task válida;
- task com dependency aberta;
- task sensível por label;
- task sensível por path glob;
- task sem AC executável;
- task deferred;
- task com question aberta no inbox;
- task com prioridade/milestone diferentes.

### Fase 2 — selector determinístico

Implementar seleção sem LLM:

```text
read_tasks
→ parse_frontmatter
→ parse_acceptance_criteria
→ check_dependencies
→ check_sensitive_zone
→ check_dedup_state
→ rank
→ return top candidate + rejected_candidates_summary
```

### Fase 3 — schema do proposer

Criar `propose.schema.json` com campos obrigatórios:

- `proposal_id`;
- `task_id`;
- `task_fingerprint`;
- `scope`;
- `acceptance_criteria`;
- `verify_plan`;
- `estimated_files`;
- `estimated_loc`;
- `estimate_confidence`;
- `zone`;
- `why_now`;
- `why_now_evidence`;
- `risks`;
- `decision`.

### Fase 4 — integração read-only com `codex-ws --schema`

O Driver envia a task escolhida para o proposer e recebe payload tipado.

A saída deve salvar ou imprimir dois formatos:

- JSON completo;
- resumo Markdown para o humano.

Na v1, preferir apenas imprimir em stdout ou escrever em `output/driver/proposals/` se esse diretório já for gitignored.

### Fase 5 — testes

Testes com `node --test`:

- selector escolhe a task correta;
- selector rejeita zona sensível;
- selector trata unknown como sensível;
- selector respeita dependency;
- selector respeita deferred;
- selector rejeita AC não executável;
- ranking por milestone → priority → created_date;
- proposal artifact passa no schema.

---

## 7. Zonas sensíveis recomendadas

O Driver deve tratar como sensível qualquer task que toque ou declare intenção de tocar:

### No projeto `contabil`

- billing;
- fiscal/impostos;
- ledger/dinheiro;
- autenticação;
- autorização;
- Pundit/policies;
- migrations;
- webhooks;
- pagamentos;
- dados financeiros/fiscais;
- produção/deploy.

### No `codex-plugin-cc`

- `sandbox_mode`;
- `approval_policy`;
- `lib/codex-config.mjs`;
- spawn/kill de processo;
- `lib/process.mjs`;
- `lib/spawner.mjs`;
- broker lifecycle;
- stop-review-gate;
- estado/jobs/worktrees;
- manifestos de release;
- marketplace/plugin publish;
- `~/.codex/config.toml`;
- credenciais, tokens ou arquivos de estado local.

Regra: **unknown = sensitive**.

---

## 8. Stop conditions adicionais

Parar e pedir decisão humana se:

- não houver task segura;
- task selecionada tiver AC fraco;
- task selecionada tiver estimativa baixa confiança;
- proposer retornar schema inválido;
- proposer discordar do selector sobre zona;
- `estimated_files > 5`;
- `estimated_loc > 150`;
- tocar zona sensível;
- houver question aberta no inbox;
- houver deferred ativo e fingerprint igual;
- a task não tiver origem rastreável;
- a task exigir decisão de produto;
- a task exigir mudança de arquitetura;
- a task exigir alteração no motor Execute/Verify.

---

## 9. Prompt sugerido para review adversarial do RFC

```bash
node tools/review-loop.mjs request \
  --artifact docs/plans/vamos-escreve-o-plano-twinkly-sun.md \
  --transport ws \
  --ask "
Faça uma review adversarial deste RFC.

Contexto:
Este RFC propõe uma camada Driver para o agentic loop do codex-plugin-cc.
O v1 é propose-only: o driver seleciona uma task do backlog do projeto contabil,
rascunha escopo/ACs/verify_plan via codex-ws --schema, apresenta ao humano no Gate-A
e só depois de aprovação pode escrever um handoff no inbox. O motor Execute/Verify
permanece inalterado.

Foque especialmente em:

1. A estimativa pré-execução de <=5 arquivos / <=150 LOC é confiável?
2. O estado de dedup deve ficar em .state/<id>.yml, status Deferred na task, ou inbox?
3. label+path-glob fail-closed é suficiente para zonas sensíveis?
4. O v2 deve exigir auto_eligible: true como whitelist?
5. A cadência /loop deve ser on-demand, diária ou outra?
6. O why_now deve ser gerado pelo driver ou vir da task?
7. Uma proposta por rodada é melhor que shortlist top-3?
8. O driver deve escrever o handoff após OK ou apenas marcar a task?
9. Quais modos de falha o RFC ainda não cobre?
10. O que precisa mudar antes de virar implementação mínima?

Não implemente código.
Retorne:
- verdict: approve | approve_with_changes | reject
- top_risks
- required_changes_before_code
- answers_to_open_questions
- suggested_v1_cutline
"
```

---

## 10. Prompt sugerido para implementação v1 mínima

Usar somente depois da review adversarial e depois de consolidar alterações no RFC.

```bash
node tools/review-loop.mjs request \
  --artifact docs/plans/vamos-escreve-o-plano-twinkly-sun.md \
  --transport ws \
  --ask "
Implemente apenas o v1 mínimo do Driver em modo dry-run.

Escopo permitido:
1. Criar tools/driver.mjs com subcomando propose.
2. Implementar parser de tasks markdown do projeto contabil.
3. Implementar selector determinístico.
4. Implementar detector de zona sensível fail-closed.
5. Implementar leitura read-only de .state para dedup.
6. Criar propose.schema.json.
7. Integrar uma chamada read-only com codex-ws --schema.
8. Produzir output JSON e Markdown.
9. Adicionar testes unitários com fixtures.

Fora de escopo:
- approve;
- write-inbox;
- escrita real em .state;
- integração com inbox-watcher;
- modo auto;
- cadência diária;
- alteração no motor Execute/Verify.

Critérios de aceitação:
- node --test passa;
- npm test passa;
- npm run build passa;
- dry-run não altera arquivos do projeto contabil;
- nenhuma escrita em inbox;
- unknown zone é tratado como sensitive;
- tarefa sem AC executável vira needs_planning.
"
```

---

## 11. Checklist antes de escrever código

- [ ] RFC revisado adversarialmente.
- [ ] Perguntas abertas respondidas.
- [ ] Seção “Contrato do Proposal Artifact” adicionada.
- [ ] Regra de AC fraco adicionada.
- [ ] Estados de decisão definidos.
- [ ] Cutline v1 registrada no RFC.
- [ ] `propose` separado de `approve`.
- [ ] Sem escrita em inbox na primeira versão.
- [ ] Sem modo auto.
- [ ] Sem alteração do motor Execute/Verify.
- [ ] Zonas sensíveis definidas como fail-closed.
- [ ] Testes unitários planejados com fixtures.

---

## 12. Checklist de pronto para v1 dry-run

- [ ] `node tools/driver.mjs propose --contabil-dir ~/Devs/contabil --dry-run` executa.
- [ ] Selector retorna uma única proposta principal.
- [ ] Output mostra por que as próximas candidatas foram descartadas.
- [ ] Proposal artifact segue schema.
- [ ] Nenhum arquivo do `contabil` é alterado.
- [ ] Nenhum arquivo de inbox é alterado.
- [ ] `.state` é apenas lido.
- [ ] Unknown zone vira sensitive.
- [ ] Task sem AC executável vira `needs_planning`.
- [ ] Task com estimativa incerta vira `needs_human_sizing`.
- [ ] Testes unitários passam.
- [ ] `npm test` passa.
- [ ] `npm run build` passa.

---

## 13. Recomendação final

A evolução correta é:

```text
1. Review adversarial do RFC
2. Consolidar alterações no RFC
3. Implementar selector/proposer v1 em dry-run
4. Rodar com backlog real por alguns dias
5. Medir utilidade das propostas
6. Só depois implementar approve/write-inbox
7. Só muito depois discutir autoexecução v2
```

A v1 deve provar uma coisa simples:

> O Driver consegue escolher e estruturar uma próxima task útil, segura e pequena melhor do que o humano fazendo triagem manual do zero.

Se isso for verdade, o próximo passo é `approve --write-inbox`.

Se isso não for verdade, não vale avançar para automação.

---

## 14. Resumo em uma frase

O RFC está no caminho certo: implemente primeiro um **Driver propose-only, read-only, dry-run, com selector determinístico e Gate-A humano**, e adie qualquer escrita no inbox ou autoexecução até provar que as propostas são úteis e seguras.
