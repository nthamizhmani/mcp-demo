// Entry point: Claude over MCP.
// Glues the generic chat server (chat-mcp.js) to the Claude adapter (llm-claude.js).

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMcpChatServer } from './chat-mcp.js';
import { createClaudeAdapter } from './llm-claude.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await startMcpChatServer({
  llm: createClaudeAdapter(),
  mcpServerPath: path.resolve(__dirname, '..', 'mcp', 'server.js'),
});
