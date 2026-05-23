// Generic MCP chat server — LLM-agnostic.
//
// This module owns everything that doesn't depend on which LLM is doing the talking:
//   - Spawning the MCP server subprocess and connecting over stdio
//   - Discovering tools via tools/list
//   - The agent loop (call LLM → execute tool calls → feed results back → repeat)
//   - The Express HTTP surface (/health, /chat)
//
// What it does NOT know:
//   - Which LLM SDK to use
//   - What tool format that LLM expects
//   - How that LLM encodes messages, system prompts, or tool results
//
// All LLM-specific behavior is delegated to a `llm` adapter — see llm-claude.js
// and llm-ollama.js for two implementations.
//
// The adapter contract:
//   {
//     name: string,
//     convertTools(mcpTools)               → llmTools (LLM's native tool format)
//     initMessages(userMessages, system)   → opaque message state
//     async chat({ messages, tools })      → { type: 'final', text } | { type: 'tool_calls', toolCalls }
//                                              toolCalls = [{ id, name, args }]
//                                              The adapter MUST also push the assistant message onto `messages`.
//     pushToolResults(messages, toolCalls, results)  → mutates `messages`
//   }
//
// Usage (see chat-claude-mcp.js or chat-ollama-mcp.js):
//   import { startMcpChatServer } from './chat-mcp.js';
//   import { createClaudeAdapter } from './llm-claude.js';
//   await startMcpChatServer({ llm: createClaudeAdapter(), mcpServerPath: '...', systemPrompt: '...' });

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import express from 'express';
import cors from 'cors';

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful assistant that manages a small movie catalog. ' +
  'When the user asks about movies, use the available tools to fetch real data — ' +
  'do not invent titles. Keep replies brief and conversational.';

export async function startMcpChatServer({
  llm,
  mcpServerPath,
  moviesApi = process.env.MOVIES_API ?? 'http://localhost:3000',
  port = 3001,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
  maxIterations = 10,
}) {
  if (!llm) throw new Error('startMcpChatServer requires an llm adapter');
  if (!mcpServerPath) throw new Error('startMcpChatServer requires mcpServerPath');

  // ---------------------------------------------------------------------------
  // 1. Connect to the MCP server (spawn it as a stdio subprocess)
  // ---------------------------------------------------------------------------
  const mcpClient = new Client(
    { name: 'mcp-demo-agent', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: 'node',
    args: [mcpServerPath],
    env: { ...process.env, MOVIES_API: moviesApi },
  });
  await mcpClient.connect(transport);

  // ---------------------------------------------------------------------------
  // 2. Discover tools and ask the adapter to translate them
  // ---------------------------------------------------------------------------
  const { tools: mcpTools } = await mcpClient.listTools();
  const llmTools = llm.convertTools(mcpTools);
  const toolNames = mcpTools.map((t) => t.name);

  console.log(`[${llm.name}] discovered ${mcpTools.length} MCP tools:`, toolNames.join(', '));

  // ---------------------------------------------------------------------------
  // 3. Tool executor — forwards to MCP
  // ---------------------------------------------------------------------------
  async function executeTool(name, input) {
    const result = await mcpClient.callTool({ name, arguments: input });
    const text = (result.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n');
    if (result.isError) return { error: text };
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Agent loop — generic
  // ---------------------------------------------------------------------------
  async function runChatLoop(userMessages) {
    const messages = llm.initMessages(userMessages, systemPrompt);
    const trace = [];

    for (let i = 0; i < maxIterations; i++) {
      const result = await llm.chat({ messages, tools: llmTools });

      if (result.type === 'final') {
        return { reply: result.text, trace };
      }
      if (result.type !== 'tool_calls') {
        return { reply: `[unexpected adapter result type: ${result.type}]`, trace };
      }

      const toolResults = [];
      for (const tc of result.toolCalls) {
        const out = await executeTool(tc.name, tc.args);
        trace.push({ name: tc.name, input: tc.args, output: out });
        toolResults.push(out);
      }
      llm.pushToolResults(messages, result.toolCalls, toolResults);
    }
    return { reply: '[max iterations reached]', trace };
  }

  // ---------------------------------------------------------------------------
  // 5. HTTP server
  // ---------------------------------------------------------------------------
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) =>
    res.json({ ok: true, llm: llm.name, tools: toolNames }),
  );

  app.post('/chat', async (req, res) => {
    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'body must be { messages: [...] }' });
    }
    try {
      const result = await runChatLoop(messages);
      res.json(result);
    } catch (err) {
      console.error('chat error:', err);
      res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  app.listen(port, () => {
    console.log(`[${llm.name}] agent listening on http://localhost:${port}`);
  });

  // ---------------------------------------------------------------------------
  // 6. Clean shutdown — close the MCP subprocess on exit
  // ---------------------------------------------------------------------------
  const shutdown = async () => {
    await mcpClient.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { mcpClient };
}
