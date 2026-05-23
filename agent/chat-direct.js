// Stage 1: Direct tool calls.
//
// The agent backend defines its own tools inline. Each tool's `execute`
// function calls the Movies REST API directly with `fetch`. No MCP involved.
//
// Architecture:
//   Browser → POST :3001/chat → this server
//                              → Anthropic API (tool_use loop)
//                              → fetch :3000 (REST API)
//                              ← assistant reply
//   ← reply

import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import cors from 'cors';

const API = process.env.MOVIES_API ?? 'http://localhost:3000';
const PORT = 3001;

// -----------------------------------------------------------------------------
// Tool definitions — passed to Claude on every request
// -----------------------------------------------------------------------------
const tools = [
  {
    name: 'list_movies',
    description: 'List movies in the catalog. Optionally filter by release year.',
    input_schema: {
      type: 'object',
      properties: {
        year: { type: 'integer', description: 'Release year to filter by' },
      },
    },
  },
  {
    name: 'get_movie',
    description: 'Get a single movie by its numeric id.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
  },
  {
    name: 'add_movie',
    description: 'Add a movie to the catalog. Returns the created record with its assigned id.',
    input_schema: {
      type: 'object',
      properties: {
        title:    { type: 'string' },
        director: { type: 'string' },
        year:     { type: 'integer' },
        rating:   { type: 'number', description: 'Rating 0–10 (optional)' },
      },
      required: ['title', 'director', 'year'],
    },
  },
  {
    name: 'delete_movie',
    description: 'Delete a movie by id. Returns the deleted record.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
  },
];

// -----------------------------------------------------------------------------
// Tool executor — directly hits the REST API
// -----------------------------------------------------------------------------
async function executeTool(name, input) {
  switch (name) {
    case 'list_movies': {
      const url = input.year != null ? `${API}/movies?year=${input.year}` : `${API}/movies`;
      const res = await fetch(url);
      return await res.json();
    }
    case 'get_movie': {
      const res = await fetch(`${API}/movies/${input.id}`);
      if (res.status === 404) return { error: `No movie with id ${input.id}` };
      return await res.json();
    }
    case 'add_movie': {
      const res = await fetch(`${API}/movies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      return await res.json();
    }
    case 'delete_movie': {
      const res = await fetch(`${API}/movies/${input.id}`, { method: 'DELETE' });
      if (res.status === 404) return { error: `No movie with id ${input.id}` };
      return await res.json();
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// -----------------------------------------------------------------------------
// Agent loop — manual tool_use loop per the SDK pattern
// -----------------------------------------------------------------------------
const SYSTEM_PROMPT =
  'You are a helpful assistant that manages a small movie catalog. ' +
  'When the user asks about movies, use the available tools to fetch real data — ' +
  'do not invent titles. Keep replies brief and conversational.';

const client = new Anthropic();

async function runChatLoop(messages) {
  const working = [...messages];
  const trace = [];

  for (let i = 0; i < 10; i++) {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      tools,
      messages: working,
    });

    working.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const text = response.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { reply: text, messages: working, trace };
    }

    if (response.stop_reason !== 'tool_use') {
      return {
        reply: `[stopped with reason: ${response.stop_reason}]`,
        messages: working,
        trace,
      };
    }

    const toolUseBlocks = response.content.filter((b) => b.type === 'tool_use');
    const toolResults = [];
    for (const tu of toolUseBlocks) {
      const result = await executeTool(tu.name, tu.input);
      trace.push({ name: tu.name, input: tu.input, output: result });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      });
    }
    working.push({ role: 'user', content: toolResults });
  }
  return { reply: '[max iterations reached]', messages: working, trace };
}

// -----------------------------------------------------------------------------
// HTTP server
// -----------------------------------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, mode: 'direct' }));

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
    res.status(500).json({ error: err.message ?? String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`agent (direct mode) listening on http://localhost:${PORT}`);
  console.log(`  forwarding tool calls to ${API}`);
});
