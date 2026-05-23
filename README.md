# MCP Demo — Movies

An end-to-end learning project for **MCP (Model Context Protocol)**. Built in four layers, each adding a new abstraction on top of the last:

1. **REST API** — plain Express server that serves movie data
2. **React UI** — a browser client that calls the API directly
3. **MCP server** — wraps the same API so any MCP-aware LLM client can use it as typed tools
4. **Agent backend** — an LLM-powered chat bot that can call the tools, in three flavors:
   - **Claude + direct REST** (no MCP)
   - **Claude + MCP**
   - **Ollama + MCP** (local LLM, no API key)

The point: by the end, the same movie data flows multiple ways — raw HTTP, MCP-wrapped, and through autonomous agent loops with different LLMs on top. Two contrasts matter:

- **"Claude over REST" vs "Claude over MCP"** — what MCP adds when the LLM stays fixed.
- **"Claude over MCP" vs "Ollama over MCP"** — what stays the same when the LLM changes (everything below the MCP boundary).

## Architecture

```
                              (Browser at :5173)
                                     │
                  ┌──────────────────┼──────────────────┐
                  │                                     │
                  ↓ fetch (direct table)                ↓ POST /chat
            ┌───────────┐                       ┌────────────────┐
            │ REST API  │                       │ Agent (:3001)  │
            │  :3000    │                       └────────┬───────┘
            └─────▲─────┘                                │
                  │                            agent loop chooses ONE
                  │              ┌──────────────────────┼──────────────────────┐
                  │              │                      │                      │
                  │       Stage 1: direct        Stage 2: Claude        Stage 3: Ollama
                  │       (chat-direct.js)        + MCP                   + MCP
                  │              │           (chat-claude-mcp.js)  (chat-ollama-mcp.js)
                  │              │                      │                      │
                  │              ↓                      ↓                      ↓
                  │     ┌────────────────┐    ┌──────────────────┐   ┌────────────────┐
                  │     │ Claude (cloud) │    │ Claude (cloud)   │   │ Ollama (local) │
                  │     │ Anthropic API  │    │ Anthropic API    │   │ :11434         │
                  │     └────────┬───────┘    └────────┬─────────┘   └────────┬───────┘
                  │              │ tools live          │ tools come from MCP  │
                  │              │ inline              │                      │
                  │              │                     ↓                      ↓
                  │              │              ┌──────────────────────────────────┐
                  │              │              │     MCP server (stdio)           │
                  │              │              │     mcp/server.js                │
                  │              │              └────────────────┬─────────────────┘
                  │              │                               │ fetch
                  └──────────────┴───────────────────────────────┘
                                       all tools end at REST API :3000
```

**What stays the same across all three agent stages:** the REST API, the MCP server, the web UI, the chat HTTP surface.

**What changes:** which LLM is on the other end, and whether tools come from an inline definition or from MCP.

## Layout

```
mcp-demo/
├── .mcp.json                 makes Claude Code auto-load the MCP server
├── README.md
├── api/                      Express REST API on :3000
│   ├── package.json
│   └── server.js
├── web/                      React + Vite UI on :5173
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx           includes the chat panel
│       └── styles.css
├── mcp/                      MCP server (stdio transport)
│   ├── package.json
│   └── server.js             exposes 4 tools that wrap the REST API
└── agent/                    Chat backend (Node)
    ├── package.json
    ├── chat-mcp.js           LIBRARY: generic, LLM-agnostic MCP chat server
    ├── llm-claude.js         Claude adapter (Anthropic SDK)
    ├── llm-ollama.js         Ollama adapter (Ollama JS client)
    ├── chat-direct.js        Entry: Claude + inline tools (no MCP)
    ├── chat-claude-mcp.js    Entry: library + Claude adapter
    ├── chat-ollama-mcp.js    Entry: library + Ollama adapter
    └── README.md
```

## Prerequisites

- **Node.js 18+** (24 is what this was built on)
- **An Anthropic API key** (only needed for the chat bot layer)
  - Get one at https://console.anthropic.com/ → Settings → API Keys → Create Key
  - New accounts get some free starter credits

## Running it

You'll need multiple terminals — one per service. Stop a service with `Ctrl+C`.

### 1. REST API (required for everything else)

```sh
cd api
npm install
npm start
```

Now serving http://localhost:3000.

```sh
# Smoke test
curl http://localhost:3000/movies
curl 'http://localhost:3000/movies?year=2019'
```

| Method | Path              | Description                          |
| ------ | ----------------- | ------------------------------------ |
| GET    | `/movies`         | List all (supports `?year=YYYY`)     |
| GET    | `/movies/:id`     | Get one movie                        |
| POST   | `/movies`         | Add a movie (JSON body)              |
| DELETE | `/movies/:id`     | Delete a movie                       |

Data is in-memory — restarting the API resets it.

### 2. Web UI

```sh
cd web
npm install
npm run dev
```

Open http://localhost:5173. The table at the top calls the REST API directly. The chat panel at the bottom calls the agent backend (start that next).

### 3. MCP server

The MCP server is a child process — you don't run it standalone. Two things use it:

**Claude Code** (auto-loaded by `.mcp.json`): start `claude` from this directory. It'll prompt you to approve the `movies` server, then expose `list_movies`, `get_movie`, `add_movie`, `delete_movie` as tools.

**The agent in MCP mode** (see next step): spawns `mcp/server.js` as a subprocess at startup.

You can also probe it directly with `/tmp/mcp-probe.sh` (if it still exists from the build) to see the raw JSON-RPC over stdio.

### 4. Agent backend

Pick **one** variant to run. All three expose `POST /chat` on **port 3001**, so the web UI works identically against any of them.

```sh
cd agent
npm install
```

**Stages 1 & 2 (Claude):** need an Anthropic API key.

```sh
export ANTHROPIC_API_KEY="sk-ant-..."

# Stage 1: Claude + inline tools (no MCP)
npm run direct

# Stage 2: Claude + MCP
npm run claude
```

**Stage 3 (Ollama):** no API key, but requires Ollama installed locally.

```sh
# One-time setup:
#   Install Ollama from https://ollama.com/download
#   Then pull a tool-capable model:
ollama pull llama3.1      # default — what `npm run ollama` uses
# Make sure Ollama is running (`ollama serve`, or the desktop app).

npm run ollama
# Or with a different model:
OLLAMA_MODEL=qwen2.5:7b npm run ollama
```

Now the chat panel at http://localhost:5173 is live. Try:

- *"What 2019 movies do we have?"*
- *"Add Interstellar (2014) by Christopher Nolan, rating 8.6."*
- *"Recommend one of our movies for a sci-fi mood."*
- *"Delete RRR."*

Click the `↓ N tool calls` toggle under each reply to see the actual tool invocations and JSON results.

> **Note on Ollama:** small local models (7B–13B) are noticeably worse at tool calling than Claude. Expect occasional hallucinated args, skipped tool calls, or made-up movie titles. The default `llama3.1:latest` (8B) is fine for most demos; `qwen2.5:7b` is slightly more reliable on multi-tool prompts.

## The pedagogical contrasts

### Contrast 1: `chat-direct.js` ↔ `chat-claude-mcp.js` (what MCP adds)

Same LLM (Claude). Only two sections differ:

1. **Tool source.** Direct mode hardcodes a `tools` array with JSON schemas. MCP mode calls `mcpClient.listTools()` at startup and maps the result.
2. **Tool execution.** Direct mode has a `switch` statement with `fetch()` calls. MCP mode forwards everything to `mcpClient.callTool({name, arguments})`.

Same system prompt, same Claude API call, same agent loop, same HTTP surface. **MCP decouples the agent from its tool source** — you can swap, share, or compose tool sources without touching the agent code.

### Contrast 2: `chat-claude-mcp.js` ↔ `chat-ollama-mcp.js` (what MCP stays the same through)

Both entry points use the **same** `chat-mcp.js` library and the **same** MCP server. They differ only in which adapter they pass in — Claude vs Ollama.

What changes (lives inside the adapter): the SDK, the tool-schema wire format (Anthropic vs OpenAI-style), the message shape (tool calls inside `content` blocks vs on `message.tool_calls`), and Anthropic-specific features (adaptive thinking, `effort`, prompt caching).

What doesn't change: the MCP client setup, the tool executor, the agent loop, the HTTP shape, the system prompt, and — most importantly — `mcp/server.js`. The protocol is doing its job: the same tool surface serves both Claude and a local Llama-family model with no work on the server side.

### The refactor that made this clear

`chat-mcp.js` used to be a self-contained Claude+MCP entry point. It's now a generic library:

```
chat-mcp.js          ── generic: MCP plumbing + agent loop + HTTP
llm-claude.js        ── adapter: convertTools, initMessages, chat, pushToolResults
llm-ollama.js        ── adapter: same four methods, Ollama-flavored

chat-claude-mcp.js   ── 15-line entry: import lib + claude adapter, start
chat-ollama-mcp.js   ── 15-line entry: import lib + ollama adapter, start
```

Adding a third LLM (GPT, Mistral, Gemini, …) means a new `llm-*.js` adapter + a new entry point. The library doesn't need to change.

## How the four layers relate

| Layer       | Lives at       | Speaks                  | Knows about        | Doesn't know about       |
| ----------- | -------------- | ----------------------- | ------------------ | ------------------------ |
| REST API    | :3000          | HTTP/JSON               | movies data        | clients, LLMs            |
| Web UI      | :5173 (browser)| HTTP/JSON to REST + agent| how to render movies| Anthropic, MCP            |
| MCP server  | subprocess     | MCP (JSON-RPC over stdio)| the REST API     | LLMs, browsers           |
| Agent       | :3001          | HTTP/JSON ↔ Anthropic SDK ↔ MCP client | Claude API, the tool surface | the user, the storage |

Each layer sits on the one below and is replaceable. Swap the REST API for a database? The MCP server changes; nothing above does. Swap Claude for a different model? The agent changes; nothing else does.

## API endpoints (REST)

```sh
curl http://localhost:3000/movies
curl http://localhost:3000/movies?year=2019
curl http://localhost:3000/movies/1
curl -X POST http://localhost:3000/movies \
  -H 'content-type: application/json' \
  -d '{"title":"Arrival","director":"Denis Villeneuve","year":2016,"rating":7.9}'
curl -X DELETE http://localhost:3000/movies/2
```

## MCP tools (exposed by `mcp/server.js`)

| Tool            | Inputs                                           | Description                |
| --------------- | ------------------------------------------------ | -------------------------- |
| `list_movies`   | `year?: integer`                                 | List, optionally filtered  |
| `get_movie`     | `id: integer`                                    | Get one                    |
| `add_movie`     | `title, director, year, rating?`                 | Add a movie                |
| `delete_movie`  | `id: integer`                                    | Delete by id               |

## Agent HTTP surface

`POST :3001/chat`

Request:
```json
{ "messages": [{ "role": "user", "content": "what's from 2019?" }] }
```

Response:
```json
{
  "reply": "We have Parasite (2019) directed by Bong Joon-ho, rated 8.5.",
  "messages": [...full conversation including tool_use/tool_result blocks...],
  "trace": [{ "name": "list_movies", "input": {"year":2019}, "output": [...] }]
}
```

`GET :3001/health` → `{ ok: true, mode: "direct" | "mcp", tools?: [...] }`

## Stopping everything

```sh
lsof -ti:3000,3001,5173 | xargs kill
```

(Replaces ports 3000 for the API, 3001 for the agent, 5173 for the web UI.)

## Notes & limitations

- **Data is in-memory.** Every API restart resets to the seed list. That's intentional for a demo.
- **No auth anywhere.** Both the REST API and the agent backend accept all comers. Don't expose this to the open internet.
- **The Anthropic API key lives only on the agent backend.** The browser never sees it — that's why the agent is a separate service rather than calling Claude from the browser.
- **MCP demo is not Claude Code.** Claude Code is one MCP-aware client (configured here via `.mcp.json`). The agent in `agent/chat-claude-mcp.js` (and `chat-ollama-mcp.js`) is a different MCP-aware client — same protocol, different host. That's the whole point of having a protocol.
