![Takatsu's Projects](https://wesleytakatsu.github.io/Pagina-Apresentacao-Pessoal/media/img/Logo-Takatsu-Projetos.png)

*[Conheça meu Linkedin!](https://www.linkedin.com/in/wesleytakatsu/)*  
*[Discover my Linkedin!](https://www.linkedin.com/in/wesleytakatsu/)*

<br>

> **🇧🇷** Criei isso pra resolver um problema meu: ficar reconfigurando token no Docker Desktop MCP Toolkit, reiniciando plugin do Obsidian REST API, gerenciando porta 27124... chato demais. Esse server lê markdown direto do disco. **Funciona em quantos projetos você quiser, sem reconfigurar nada.** Copia a pasta, builda, e já era.
>
> **🇬🇧** I built this to solve my own frustration: reconfiguring tokens in Docker Desktop MCP Toolkit, restarting the Obsidian REST API plugin, managing port 27124... a pain. This server reads markdown straight from disk. **Works across as many projects as you want, zero reconfiguration.** Copy the folder, build it, done.

# Markdown Vault MCP standalone

> **🇧🇷** Inspirado no [Obsidian MCP](https://github.com/obsidianmd/obsidian-mcp), mas criado para ir além: um MCP server focado em documentação técnica para agentes de desenvolvimento de sistemas. Sem Obsidian aberto, sem plugin REST API, sem Docker Desktop, sem MCP Toolkit, sem porta 27124, sem token `Bearer`, sem container, sem gambiarra.  
> Você tem uma pasta `docs/` com markdown? Então você já tem um vault. Este MCP server lê seus arquivos direto do disco — leve, instantâneo, sem serviços externos.  
> Copiou a pasta, rodou `npm install && npm run build`, e seus agentes de IA já enxergam tudo. Simples assim.
>
> **🇬🇧** Inspired by [Obsidian MCP](https://github.com/obsidianmd/obsidian-mcp), but built to go further: an MCP server focused on technical documentation for systems development agents. No Obsidian running, no REST API plugin, no Docker Desktop, no MCP Toolkit, no port 27124, no `Bearer` token, no containers, no hacks.  
> You have a `docs/` folder with markdown? Then you already have a vault. This MCP server reads your files straight from disk — lightweight, instant, no external services.  
> Copy the folder, run `npm install && npm run build`, and your AI agents can see everything. That's it.

Works with any MCP-compatible tool: OpenCode, Claude Code CLI, VS Code, Cursor, Windsurf, MCP Toolkit, and more.

---

## 🇧🇷 Começo Rápido

```bash
# 1. Copie esta pasta para seu projeto
cp -r obsidian-mcp-standalone /caminho/do/seu/projeto/obsidian-mcp

# 2. Instale e compile
cd /caminho/do/seu/projeto/obsidian-mcp
npm install
npm run build

# 3. Teste
npm test
```

Pronto. O servidor detecta automaticamente a pasta `docs/` na raiz do seu projeto.

## 🇬🇧 Quick Start

```bash
# 1. Copy this folder to your project
cp -r obsidian-mcp-standalone /path/to/your/project/obsidian-mcp

# 2. Install & build
cd /path/to/your/project/obsidian-mcp
npm install
npm run build

# 3. Test it
npm test
```

That's it. The server auto-detects `docs/` in your project root.

---

## 🇧🇷 Ferramentas

| Ferramenta | O que faz |
|------------|-----------|
| `list_files` | Lista arquivos `.md`, opcionalmente com tamanho e data de modificação |
| `read_file` | Lê uma nota como conteúdo, metadados, outline ou JSON completo |
| `search` | Busca texto literal ou regex, com filtros de path, limite e contexto |
| `append_file` | Adiciona conteúdo ao fim da nota ou dentro de uma seção por heading |
| `write_file` | Cria nota; sobrescrita exige `overwrite: true` e pode usar `expectedSha256` |
| `replace_in_file` | Substitui texto literal ou regex dentro de uma nota |
| `patch_note` | Faz append, prepend ou replace dentro de uma seção por heading |
| `manage_frontmatter` | Lê, define ou remove chaves simples de frontmatter YAML |
| `list_tags` | Lista tags de frontmatter e tags inline, com contagem e arquivos opcionais |
| `manage_tags` | Lista, adiciona ou remove tags em frontmatter, inline ou ambos |
| `get_periodic_note` | Retorna o nome do arquivo para nota periódica (diária, semanal, etc.) |
| `obsidian_get_backlinks` | Encontra arquivos Markdown que referenciam uma nota |
| `obsidian_impact_analysis` | Analisa riscos antes de mover, renomear ou deletar uma nota |
| `obsidian_generate_index` | Gera, simula ou atualiza um índice Markdown do vault |
| `obsidian_diagnose_docs` | Diagnostica links quebrados, anchors quebrados, órfãos, títulos e frontmatter |
| `obsidian_extract_tasks` | Extrai tarefas `TODO`, `FIXME`, `@todo` e checkboxes |
| `obsidian_build_context_pack` | Monta um pacote de contexto otimizado para agentes de IA |
| `obsidian_find_relevant_notes` | Busca notas relevantes com ranking heurístico |
| `obsidian_safe_rename_note` | Renomeia nota atualizando wikilinks e links Markdown |
| `obsidian_lint_markdown_vault` | Linta o vault com checks voltados para IA e Obsidian, com fix opcional e dry-run |
| `obsidian_generate_agent_briefing` | Gera um briefing curto para uma tarefa de agente |

## 🇬🇧 Tools

| Tool | What it does |
|------|-------------|
| `list_files` | List `.md` files, optionally with size and modification time |
| `read_file` | Read a note as content, metadata, outline, or full JSON |
| `search` | Search literal text or regex with path, limit, and context options |
| `append_file` | Append content to the note end or under a heading section |
| `write_file` | Create notes; overwrite requires `overwrite: true` and can use `expectedSha256` |
| `replace_in_file` | Replace literal text or regex matches inside one note |
| `patch_note` | Append, prepend, or replace content under a heading |
| `manage_frontmatter` | Get, set, or delete simple YAML frontmatter keys |
| `list_tags` | List frontmatter and inline tags, with counts and optional files |
| `manage_tags` | List, add, or remove tags in frontmatter, inline text, or both |
| `get_periodic_note` | Get filename for daily/weekly/monthly note |
| `obsidian_get_backlinks` | Find markdown files that reference a target note |
| `obsidian_impact_analysis` | Analyze risk before moving, renaming, or deleting a note |
| `obsidian_generate_index` | Generate, preview, or update a markdown vault index |
| `obsidian_diagnose_docs` | Diagnose broken links, broken anchors, orphans, titles, and frontmatter |
| `obsidian_extract_tasks` | Extract `TODO`, `FIXME`, `@todo`, and checkbox tasks |
| `obsidian_build_context_pack` | Build an optimized context pack for AI agents |
| `obsidian_find_relevant_notes` | Find relevant notes with heuristic ranking |
| `obsidian_safe_rename_note` | Rename a note and update wikilinks/Markdown links |
| `obsidian_lint_markdown_vault` | Lint the vault for AI and Obsidian usage, with optional fix and dry-run |
| `obsidian_generate_agent_briefing` | Generate a short briefing for an agent task |

## 🇧🇷🇬🇧 Advanced agent-oriented tools

Estas ferramentas foram pensadas para agentes que precisam entender, reorganizar e usar documentação Markdown sem carregar o vault inteiro no contexto. Elas funcionam direto no filesystem, com Obsidian fechado, sem plugin REST API, sem porta HTTP e sem Docker.

These tools are built for agents that need to understand, reorganize, and use markdown docs without loading the whole vault into context. They work directly on the filesystem, with Obsidian closed, no REST API plugin, no HTTP port, and no Docker.

### `obsidian_get_backlinks`

```json
{
  "input": { "path": "docs/backend/auth.md", "includeContext": true },
  "output": {
    "target": "docs/backend/auth.md",
    "backlinks": [
      {
        "path": "docs/index.md",
        "matches": [{ "line": 12, "text": "- [[backend/auth]]" }]
      }
    ],
    "count": 1
  }
}
```

### `obsidian_impact_analysis`

```json
{
  "input": { "path": "docs/backend/auth.md" },
  "output": {
    "path": "docs/backend/auth.md",
    "exists": true,
    "title": "Autenticação",
    "frontmatter": { "status": "active", "type": "guide" },
    "tags": ["backend", "auth"],
    "outgoingLinks": ["docs/backend/routes.md"],
    "backlinks": ["docs/index.md", "AGENTS.md"],
    "risks": [
      "This note is referenced by 2 files.",
      "Deleting or moving it may break links."
    ]
  }
}
```

### `obsidian_generate_index`

```json
{
  "input": {
    "path": "docs",
    "target": "docs/index.md",
    "mode": "hierarchical",
    "includeDescriptions": true,
    "overwrite": false,
    "dryRun": false
  },
  "output": {
    "target": "docs/index.md",
    "created": true,
    "updated": false,
    "filesIndexed": 18
  }
}
```

Generated content uses wikilinks when possible:

```md
# Índice da documentação

## backend

- [[backend/auth]] — Autenticação — Guia sobre autenticação JWT
- [[backend/routes]] — Rotas protegidas
```

Dry-run returns a preview and does not write the target file:

```json
{
  "input": {
    "path": "docs",
    "target": "docs/index.md",
    "includeDescriptions": true,
    "overwrite": true,
    "dryRun": true
  },
  "output": {
    "dryRun": true,
    "target": "docs/index.md",
    "wouldCreate": false,
    "wouldUpdate": true,
    "filesIndexed": 18,
    "contentPreview": "# Índice da documentação\n\n...",
    "previewTruncated": false
  }
}
```

### `obsidian_diagnose_docs`

```json
{
  "input": {
    "path": "docs",
    "checks": [
      "broken_links",
      "broken_anchors",
      "missing_titles",
      "duplicate_titles",
      "empty_files",
      "orphan_notes",
      "missing_frontmatter",
      "large_files"
    ]
  },
  "output": {
    "path": "docs",
    "summary": { "filesScanned": 42, "issuesFound": 8 },
    "issues": [
      {
        "type": "broken_links",
        "severity": "error",
        "file": "docs/index.md",
        "line": 14,
        "message": "Link points to missing note: docs/setup/env.md"
      },
      {
        "type": "broken_anchors",
        "severity": "warning",
        "file": "docs/index.md",
        "line": 15,
        "message": "Link points to existing note but missing heading: docs/backend/auth.md#JWT"
      }
    ]
  }
}
```

### `obsidian_extract_tasks`

```json
{
  "input": { "path": "docs", "includeDone": false, "groupBy": "file" },
  "output": {
    "path": "docs",
    "count": 2,
    "tasks": [
      {
        "file": "docs/setup/docker.md",
        "line": 21,
        "done": false,
        "text": "Ajustar Docker Compose"
      }
    ],
    "groups": [
      {
        "file": "docs/setup/docker.md",
        "tasks": [
          {
            "file": "docs/setup/docker.md",
            "line": 21,
            "done": false,
            "text": "Ajustar Docker Compose"
          }
        ]
      }
    ]
  }
}
```

### `obsidian_build_context_pack`

```json
{
  "input": {
    "topic": "como rodar o projeto com Docker",
    "path": "docs",
    "maxTokens": 12000,
    "include": ["docs/**/*.md", "AGENTS.md"],
    "exclude": ["docs/archive/**"],
    "mode": "agent"
  },
  "output": {
    "topic": "como rodar o projeto com Docker",
    "estimatedTokens": 4200,
    "filesUsed": ["AGENTS.md", "docs/index.md", "docs/setup/docker.md"],
    "content": "# Context Pack: como rodar o projeto com Docker\n\n..."
  }
}
```

For generic tasks, the context pack gives initial priority to central files when they exist: `AGENTS.md`, `README.md`, `docs/index.md`, and `index.md` files inside the scanned path. It still respects `maxTokens` and does not return the whole vault.

### `obsidian_find_relevant_notes`

```json
{
  "input": {
    "query": "autenticação JWT no backend",
    "path": "docs",
    "limit": 10,
    "strategy": "hybrid"
  },
  "output": {
    "query": "autenticação JWT no backend",
    "results": [
      {
        "path": "docs/backend/auth.md",
        "score": 18.5,
        "title": "Autenticação",
        "matchedBy": ["title", "heading", "content", "tag"],
        "snippet": "..."
      }
    ]
  }
}
```

### `obsidian_safe_rename_note`

```json
{
  "input": {
    "from": "docs/backend/auth.md",
    "to": "docs/backend/autenticacao.md",
    "updateLinks": true,
    "dryRun": true
  },
  "output": {
    "dryRun": true,
    "from": "docs/backend/auth.md",
    "to": "docs/backend/autenticacao.md",
    "filesToUpdate": [{ "path": "docs/index.md", "replacements": 2 }],
    "wouldRename": true
  }
}
```

### `obsidian_lint_markdown_vault`

```json
{
  "input": { "path": "docs", "fix": false, "dryRun": false },
  "output": {
    "path": "docs",
    "summary": { "filesScanned": 20, "issuesFound": 5, "fixed": 0 },
    "issues": [
      {
        "type": "multiple_h1",
        "severity": "warning",
        "file": "docs/backend/auth.md",
        "line": 48,
        "message": "File contains multiple H1 headings."
      }
    ]
  }
}
```

When `fix` is `true`, only safe formatting fixes are applied: trailing spaces are removed and a final newline is ensured. When `fix` and `dryRun` are both `true`, files are not changed and the output includes `dryRun`, `summary.wouldFix`, and `fixes`.

### `obsidian_generate_agent_briefing`

```json
{
  "input": {
    "task": "implementar autenticação JWT no backend",
    "path": "docs",
    "maxTokens": 6000
  },
  "output": {
    "task": "implementar autenticação JWT no backend",
    "estimatedTokens": 3500,
    "recommendedFiles": [
      "AGENTS.md",
      "docs/index.md",
      "docs/backend/auth.md"
    ],
    "content": "# Briefing para agente\n\n..."
  }
}
```

## 🇧🇷 Boas práticas para agentes com `AGENTS.md` + `docs/index.md`

- Coloque `AGENTS.md` na raiz do vault/projeto com regras operacionais: comandos, padrões de código, limites de segurança e decisões que o agente deve respeitar.
- Mantenha `docs/index.md` como mapa principal da documentação. A tool `obsidian_generate_index` pode criar ou atualizar esse arquivo.
- Antes de uma tarefa grande, chame `obsidian_generate_agent_briefing` para obter a ordem de leitura recomendada.
- Para montar contexto sem estourar a janela do modelo, prefira `obsidian_build_context_pack` em vez de pedir todos os arquivos.
- Antes de renomear ou deletar uma nota, use `obsidian_impact_analysis` e depois `obsidian_safe_rename_note` com `dryRun: true`.

## 🇬🇧 Best practices for agents with `AGENTS.md` + `docs/index.md`

- Put `AGENTS.md` at the vault/project root with operating rules: commands, coding standards, safety limits, and decisions the agent must follow.
- Keep `docs/index.md` as the main documentation map. `obsidian_generate_index` can create or refresh it.
- Before a larger task, call `obsidian_generate_agent_briefing` to get the recommended reading order.
- To fit model context windows, prefer `obsidian_build_context_pack` instead of loading every file.
- Before renaming or deleting a note, use `obsidian_impact_analysis`, then `obsidian_safe_rename_note` with `dryRun: true`.

## 🇧🇷 Recursos MCP

| Resource URI | O que expõe |
|--------------|-------------|
| `obsidian://vault/{path}` | Nota em JSON com conteúdo, frontmatter, tags, links, headings e metadados |
| `obsidian://tags` | Todas as tags encontradas no vault, com contagem e arquivos |
| `obsidian://status` | Status standalone do servidor, transporte, vault e contagem de notas |

## 🇬🇧 MCP Resources

| Resource URI | What it exposes |
|--------------|-----------------|
| `obsidian://vault/{path}` | Note JSON with content, frontmatter, tags, links, headings, and metadata |
| `obsidian://tags` | All vault tags with counts and files |
| `obsidian://status` | Standalone server status, transport, vault, and note count |

## 🇧🇷 Segurança para agentes

- Operações de nota aceitam apenas arquivos `.md` e `.markdown`.
- Todo path é resolvido dentro do vault; travessia de diretório é bloqueada.
- Symlinks que apontam para fora do vault são rejeitados nas operações avançadas e nos paths resolvidos pelo servidor.
- `write_file` não sobrescreve arquivo existente sem `overwrite: true`.
- Operações de escrita podem usar `expectedSha256` para evitar sobrescrever conteúdo que mudou desde a última leitura.
- `obsidian_generate_index` e `obsidian_lint_markdown_vault` suportam `dryRun` para simular operações de escrita.
- Frontmatter é suportado para YAML simples comum em Obsidian; objetos YAML complexos podem ser reserializados de forma simplificada.

## 🇬🇧 Agent Safety

- Note operations only accept `.md` and `.markdown` files.
- Every path is resolved inside the vault; directory traversal is blocked.
- Symlinks that point outside the vault are rejected by advanced operations and resolved server paths.
- `write_file` does not overwrite existing files unless `overwrite: true` is passed.
- Write operations can use `expectedSha256` to avoid replacing content that changed after the last read.
- `obsidian_generate_index` and `obsidian_lint_markdown_vault` support `dryRun` to preview write operations.
- Frontmatter supports common simple Obsidian YAML; complex YAML objects may be serialized in a simplified form.

---

## 🇧🇷 Configuração

Por padrão o servidor define o vault nesta ordem:

1. Variável de ambiente `OBSIDIAN_VAULT_PATH`
2. Pasta `docs/` relativa ao próprio script (`obsidian-mcp/dist/../../docs`)
3. Pasta `docs/` relativa ao diretório atual (`./docs`)

```bash
# Sobrescrever o caminho do vault
OBSIDIAN_VAULT_PATH=/outro/vault node dist/index.js
```

## 🇬🇧 Configuration

By default the server chooses the vault in this order:

1. `OBSIDIAN_VAULT_PATH` environment variable
2. `docs/` relative to the server script location (`obsidian-mcp/dist/../../docs`)
3. `docs/` relative to the current working directory (`./docs`)

```bash
# Override vault path
OBSIDIAN_VAULT_PATH=/some/other/vault node dist/index.js
```

---

## 🇧🇷🇬🇧 Integração com Ferramentas de IA / Integrating with AI Tools

### OpenCode

**🇧🇷** Crie ou edite `opencode.json` na raiz do projeto.  
**🇬🇧** Create or edit `opencode.json` in your project root.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "obsidian-vault": {
      "type": "local",
      "command": ["node", "obsidian-mcp/dist/index.js"],
      "enabled": true
    }
  }
}
```

### Claude Code CLI

**🇧🇷** Para configuração compartilhada do projeto, crie `.mcp.json` na raiz.  
**🇬🇧** For shared project configuration, create `.mcp.json` in the project root.

```json
{
  "mcpServers": {
    "obsidian-vault": {
      "type": "stdio",
      "command": "node",
      "args": ["obsidian-mcp/dist/index.js"]
    }
  }
}
```

Ou adicione pelo CLI:

```bash
claude mcp add --transport stdio obsidian-vault -- node obsidian-mcp/dist/index.js
```

### VS Code

**🇧🇷** Crie `.vscode/mcp.json` na raiz do projeto, ou configure globalmente nas settings.  
**🇬🇧** Create `.vscode/mcp.json` in your project root, or configure globally in VS Code settings.

```json
{
  "servers": {
    "obsidian-vault": {
      "type": "stdio",
      "command": "node",
      "args": ["obsidian-mcp/dist/index.js"]
    }
  }
}
```

### MCP Toolkit / Desktop Apps

**🇧🇷** Adicione um novo servidor MCP:  
**🇬🇧** Add a new MCP server:

```
Name / Nome:       Obsidian Vault
Command / Comando: node
Arguments:         [/caminho/completo/obsidian-mcp/dist/index.js]
                  [/full/path/to/obsidian-mcp/dist/index.js]
```

---

## 🇧🇷 Estrutura do Projeto

```
obsidian-mcp/
├── src/index.ts              # Registro MCP, tools legadas e resources
├── src/core/advanced.ts      # Tools avançadas para agentes e helpers Markdown
├── src/core/advanced-helpers.ts
├── src/core/advanced-types.ts
├── test/mcp-smoke.mjs        # Teste MCP de ferramentas e resources
├── dist/index.js             # Compilado (gerado automaticamente)
├── package.json
├── tsconfig.json
└── README.md
```

## 🇬🇧 Project Structure

```
obsidian-mcp/
├── src/index.ts              # MCP registration, legacy tools, and resources
├── src/core/advanced.ts      # Advanced agent tools and markdown helpers
├── src/core/advanced-helpers.ts
├── src/core/advanced-types.ts
├── test/mcp-smoke.mjs        # MCP smoke test for tools and resources
├── dist/index.js             # Compiled output (generated)
├── package.json
├── tsconfig.json
└── README.md
```

---

## 🇧🇷 Como Funciona

O servidor usa o [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) para expor ferramentas de leitura/escrita via **stdio** (stdin/stdout). **Não abre porta de rede** — só quem iniciou o processo consegue se comunicar com ele. Todo o tráfego fica confinado ao pipe interno entre a ferramenta de IA e o servidor.

Todas as operações de arquivo são restritas ao diretório do vault — travessia de path é bloqueada.

Usa **apenas Node.js** e lê arquivos `.md`/`.markdown` diretamente do sistema de arquivos. Sem serviços externos, sem daemons, sem Docker.

## 🇬🇧 How It Works

The server uses the [Model Context Protocol SDK](https://github.com/modelcontextprotocol/typescript-sdk) to expose read/write tools over **stdio** (stdin/stdout). **No network port is opened** — only the process that started it can talk to it. All traffic stays inside the internal pipe between the AI tool and the server.

All file operations are sandboxed to the vault directory — path traversal is blocked.

It uses **only Node.js** and reads `.md`/`.markdown` files directly from the filesystem. No external services, no running daemons, no Docker.

---

## 🇧🇷 Por que não usar o plugin do Obsidian diretamente?

O plugin `obsidian-local-rest-api` do Obsidian MCP original exige o Obsidian aberto e serve apenas um vault por vez. Este server standalone melhora essa abordagem:

- **Funciona sem o Obsidian aberto** — não depende do aplicativo
- **Zero configuração** por projeto
- **Portátil** — copie a pasta, instale, pronto
- **Sem chaves de API, sem tokens, sem portas**
- **Previsível** — lê arquivos direto, sem cache obsoleto
- **Focado em agentes de desenvolvimento** — tools otimizadas para contexto de IA e documentação técnica

## 🇬🇧 Why Not Just Use the Obsidian Plugin?

The original Obsidian MCP's `obsidian-local-rest-api` plugin requires Obsidian to be open and can only serve one vault at a time. This standalone server improves on that approach:

- **Works without Obsidian running** — no app dependency
- **Zero configuration** per project
- **Portable** — copy the folder, install, done
- **No API keys, no tokens, no ports**
- **Predictable** — reads files directly, no caching issues
- **Focused on dev agents** — tools optimized for AI context and technical documentation

---

## 🇧🇷 Por que não usar container?

Rodar este MCP server dentro de um container (Docker/Podman) adiciona complexidade sem benefício:

- **Permissão de arquivos** — O container roda como `root` ou `node`, enquanto seus arquivos no host pertencem a outro usuário. A pasta `docs/` precisa de montagem com `:z` ou `--user` mapeado, senão o container não consegue ler ou escrever.
- **Auto-detect quebra** — A lógica que encontra `docs/` automaticamente pelo caminho do script não funciona dentro do container.
- **Stdio complica** — MCP usa comunicação via stdin/stdout. Rodar isso num container exige flags `-i`/`--interactive` e nem toda ferramenta de IA lida bem com isso.

**Conclusão:** Rode direto no host. Só precisa de Node.js — sem container, sem configuração extra, sem dor de cabeça.

## 🇬🇧 Why not use a container?

Running this MCP server inside a container (Docker/Podman) adds complexity with no upside:

- **File permissions** — The container runs as `root` or `node`, but your files on the host belong to another user. Mounting `docs/` requires `:z` or `--user` mapping, or the container can't read or write.
- **Auto-detect breaks** — The logic that finds `docs/` relative to the script path doesn't work inside a container.
- **Stdio complications** — MCP communicates over stdin/stdout. Running that inside a container requires `-i`/`--interactive` flags, and not every AI tool handles it well.

**Bottom line:** Run directly on the host. All you need is Node.js — no container, no extra setup, no headaches.
