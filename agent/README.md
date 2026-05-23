# Agent backend

Chat backend that lets an LLM call the Movies API as tools.

The interesting structure: **one generic MCP chat server, multiple LLM adapters.** Each entry point glues the framework to an adapter in ~15 lines.

```
chat-mcp.js          ──┐                           generic library
                       │                           (MCP plumbing + agent loop + HTTP)
                       ▼
                 ┌──────────────┐
                 │ adapter:     │
                 │  llm-claude  │  or  llm-ollama
                 └──────────────┘
                       ▲
                       │
chat-claude-mcp.js ────┘   ←── `npm run claude`
chat-ollama-mcp.js ────┘   ←── `npm run ollama`

chat-direct.js   ←── `npm run direct`  (separate — no MCP at all, demonstrates the baseline)
```

## Files

| File                    | Role                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `chat-mcp.js`           | **Generic MCP chat server.** Owns MCP client, agent loop, Express. No LLM SDK imports.   |
| `llm-claude.js`         | **Claude adapter.** Imports `@anthropic-ai/sdk`. Exports `createClaudeAdapter()`.        |
| `llm-ollama.js`         | **Ollama adapter.** Imports `ollama`. Exports `createOllamaAdapter()`.                   |
| `chat-claude-mcp.js`    | Entry: wires the generic server to the Claude adapter                                    |
| `chat-ollama-mcp.js`    | Entry: wires the generic server to the Ollama adapter                                    |
| `chat-direct.js`        | Self-contained Claude + inline tools (no MCP). Kept for the contrast with `chat-mcp.js`. |

All entries expose `POST /chat` on **port 3001**, so the web UI works against any of them.

## Adapter contract

A minimal interface — implement these four methods to plug in any LLM:

```js
{
  name: string,

  // MCP tools → LLM-native tool format
  convertTools(mcpTools) → llmTools,

  // Initialize the per-request message state (opaque to the framework)
  initMessages(userMessages, systemPrompt) → state,

  // Make one LLM call. The adapter MUST push the assistant turn onto `state`.
  // Returns:
  //   { type: 'final',      text }
  //   { type: 'tool_calls', toolCalls: [{id, name, args}, ...] }
  async chat({ messages: state, tools }) → result,

  // Push tool execution results back onto `state` in the LLM's native format
  pushToolResults(state, toolCalls, results) → void,
}
```

Adding GPT, Mistral, or any other LLM is a new file shaped like `llm-claude.js`.

## Setup

```sh
npm install
```

For the Claude entry:

```sh
export ANTHROPIC_API_KEY="sk-ant-..."   # from console.anthropic.com
```

For the Ollama entry:

```sh
# One-time install: https://ollama.com/download
ollama pull llama3.1      # default — what `npm run ollama` uses
# (or `ollama pull qwen2.5:7b` — slightly better at tool calls)
# Ollama must be running (`ollama serve` or the desktop app)
```

## Run

Make sure the REST API on :3000 is up first.

```sh
npm run direct      # Claude + inline tools (no MCP)
npm run claude      # Claude + MCP
npm run ollama      # Ollama + MCP
# Or:
OLLAMA_MODEL=qwen2.5:7b npm run ollama
```

Test directly:

```sh
curl -X POST http://localhost:3001/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"What movies do we have from 2019?"}]}'

curl http://localhost:3001/health
```

Or use the chat panel at http://localhost:5173.

## What changes between the variants

### `chat-direct.js` → `chat-claude-mcp.js` (no MCP vs MCP, LLM held constant)

Same LLM (Claude). Only two sections differ:
1. `chat-claude-mcp.js` (via the library) spawns the MCP server and discovers tools at startup.
2. The tool executor calls `mcpClient.callTool()` instead of `fetch()`.

System prompt, LLM call, agent loop, and HTTP shape are identical. **The tool source is interchangeable** — that's MCP's value.

### `chat-claude-mcp.js` → `chat-ollama-mcp.js` (LLM swap, MCP held constant)

Both use the same `chat-mcp.js` library and the same MCP server. The only difference is which adapter they pass in:

| | Claude adapter (`llm-claude.js`) | Ollama adapter (`llm-ollama.js`) |
| --- | -------------------------------------------- | -------------------------------------------- |
| SDK | `@anthropic-ai/sdk` | `ollama` |
| Auth | `ANTHROPIC_API_KEY` | none — runs on your machine |
| Tool format | `{name, description, input_schema}` | `{type:'function', function:{name, description, parameters}}` |
| System prompt | `system` parameter on the API call | `{role:'system'}` message at the front |
| Tool calls land at | `response.content` (filter `tool_use`) | `response.message.tool_calls` |
| Tool results format | `{role:'user', content:[{type:'tool_result', ...}]}` | one `{role:'tool', content:<json>}` per call |
| Anthropic-only features | Adaptive thinking, `effort`, prompt caching | n/a |

Everything that LLM-shape-specific lives behind the adapter. Everything MCP-related lives in `chat-mcp.js`. The two never need to know about each other.

**Caveat for the Ollama adapter:** small local models (7B–13B) are noticeably worse at tool calling than Claude. Expect occasional hallucinated args, skipped tool calls, or made-up movie titles. The default `llama3.1:latest` (8B) is fine for most demos; `qwen2.5:7b` is slightly more reliable on multi-tool prompts.
