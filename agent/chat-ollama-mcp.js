// Entry point: Ollama over MCP.
// Glues the generic chat server (chat-mcp.js) to the Ollama adapter (llm-ollama.js).
//
// Prerequisites:
//   1. Install Ollama:  https://ollama.com/download
//   2. Pull a tool-capable model:
//        ollama pull llama3.1       (default — what `npm run ollama` uses)
//        ollama pull qwen2.5:7b     (alternative — slightly better at tool calls)
//   3. Ollama must be running (`ollama serve`, or the desktop app).
//
// Run:
//   npm run ollama
//   # Or pick a different model:
//   OLLAMA_MODEL=qwen2.5:7b npm run ollama
//
// Caveat: small local models (7B–13B) are less reliable at tool calling than
// Claude. Expect occasional hallucinated args or skipped tool calls. That's
// the cost of free + local, not a bug in the harness.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpChatServer } from './chat-mcp.js';
import { createOllamaAdapter } from './llm-ollama.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await startMcpChatServer({
  llm: createOllamaAdapter(),
  mcpServerPath: path.resolve(__dirname, '..', 'mcp', 'server.js'),
});
