// Claude adapter for the generic MCP chat server.
//
// Encapsulates everything Anthropic-specific:
//   - SDK + auth (ANTHROPIC_API_KEY)
//   - Tool format: { name, description, input_schema }
//   - Message shape: assistant messages contain a `content` array of typed blocks;
//                    tool calls are `tool_use` blocks; tool results are `tool_result` blocks
//                    inside a user message.
//   - System prompt: separate top-level parameter, not a message
//   - Anthropic-only features: adaptive thinking, effort, prompt caching

import Anthropic from '@anthropic-ai/sdk';

export function createClaudeAdapter({ model = 'claude-opus-4-7', maxTokens = 4096 } = {}) {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  return {
    name: model,

    // MCP tools  →  Anthropic's tool format (rename inputSchema → input_schema).
    convertTools(mcpTools) {
      return mcpTools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    },

    // Internal state for one /chat request:
    //   - system goes in a separate parameter, so we keep it on the side
    //   - messages is the conversation array passed to the API
    initMessages(userMessages, systemPrompt) {
      return {
        system: systemPrompt,
        messages: userMessages.map((m) => ({ role: m.role, content: m.content })),
      };
    },

    async chat({ messages, tools }) {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
        cache_control: { type: 'ephemeral' }, // auto-cache the last cacheable block
        system: messages.system,
        tools,
        messages: messages.messages,
      });

      // Append assistant turn (may contain tool_use + text blocks together)
      messages.messages.push({ role: 'assistant', content: response.content });

      if (response.stop_reason === 'end_turn') {
        const text = response.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return { type: 'final', text };
      }
      if (response.stop_reason !== 'tool_use') {
        return { type: 'final', text: `[stopped: ${response.stop_reason}]` };
      }

      const toolCalls = response.content
        .filter((b) => b.type === 'tool_use')
        .map((tu) => ({ id: tu.id, name: tu.name, args: tu.input }));
      return { type: 'tool_calls', toolCalls };
    },

    // Anthropic wants ONE user message containing all tool_result blocks,
    // matched to their tool_use_id from the previous assistant turn.
    pushToolResults(messages, toolCalls, results) {
      const content = toolCalls.map((tc, i) => ({
        type: 'tool_result',
        tool_use_id: tc.id,
        content: typeof results[i] === 'string' ? results[i] : JSON.stringify(results[i]),
      }));
      messages.messages.push({ role: 'user', content });
    },
  };
}
