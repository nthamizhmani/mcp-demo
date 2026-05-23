// Ollama adapter for the generic MCP chat server.
//
// Encapsulates everything Ollama-specific (OpenAI-style):
//   - Ollama JS client (talks to localhost:11434)
//   - Tool format: { type: 'function', function: { name, description, parameters } }
//   - Message shape: tool calls live on `message.tool_calls`; tool results go
//                    back as messages with role: 'tool'.
//   - System prompt: just another message with role: 'system'
//   - No adaptive thinking, no effort, no prompt caching (Anthropic-only features)
//
// Side-by-side with llm-claude.js this is the cleanest place to see the
// LLM-shape differences MCP is hiding from the agent loop.

import { Ollama } from 'ollama';

export function createOllamaAdapter({
  model = process.env.OLLAMA_MODEL ?? 'llama3.1:latest',
  host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
} = {}) {
  const ollama = new Ollama({ host });

  return {
    name: `ollama (${model})`,

    // MCP tools  →  OpenAI-style tool format.
    convertTools(mcpTools) {
      return mcpTools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    },

    // System prompt is just another message at the front of the array.
    initMessages(userMessages, systemPrompt) {
      return [{ role: 'system', content: systemPrompt }, ...userMessages];
    },

    async chat({ messages, tools }) {
      const response = await ollama.chat({
        model,
        messages,
        tools,
        stream: false,
      });

      const msg = response.message;
      messages.push(msg); // Append assistant turn (may carry tool_calls)

      const toolCalls = msg.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return { type: 'final', text: msg.content ?? '' };
      }

      // Ollama may return arguments as a string OR a parsed object depending on the model.
      const normalized = toolCalls.map((tc, i) => {
        const fn = tc.function;
        const args =
          typeof fn.arguments === 'string' ? JSON.parse(fn.arguments || '{}') : fn.arguments;
        return { id: tc.id ?? `call_${i}`, name: fn.name, args };
      });
      return { type: 'tool_calls', toolCalls: normalized };
    },

    // Ollama (OpenAI-style) wants ONE role:'tool' message per tool call.
    pushToolResults(messages, toolCalls, results) {
      for (let i = 0; i < toolCalls.length; i++) {
        messages.push({
          role: 'tool',
          content: typeof results[i] === 'string' ? results[i] : JSON.stringify(results[i]),
        });
      }
    },
  };
}
