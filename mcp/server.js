// MCP server that wraps the Movies REST API.
//
// What "wraps" means here:
//   - The REST API at http://localhost:3000 still does the real work.
//   - This server speaks the Model Context Protocol over stdio.
//   - Each MCP tool below calls the REST API with `fetch` and returns the
//     result in MCP's expected shape (`{ content: [...] }`).
//   - An MCP-aware client (Claude Code, Claude Desktop, etc.) spawns this
//     process, discovers the tools by name+schema, and invokes them.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API = process.env.MOVIES_API ?? 'http://localhost:3000';

const server = new McpServer({
  name: 'movies',
  version: '1.0.0',
});

// Helper: turn any JSON-able value into an MCP tool result.
const ok = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});
const fail = (message) => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

server.registerTool(
  'list_movies',
  {
    title: 'List movies',
    description: 'List all movies in the catalog. Optionally filter by release year.',
    inputSchema: {
      year: z.number().int().optional().describe('Filter to movies from this release year'),
    },
  },
  async ({ year }) => {
    const url = year != null ? `${API}/movies?year=${year}` : `${API}/movies`;
    const res = await fetch(url);
    if (!res.ok) return fail(`API returned HTTP ${res.status}`);
    return ok(await res.json());
  },
);

server.registerTool(
  'get_movie',
  {
    title: 'Get a movie',
    description: 'Get a single movie by its numeric id.',
    inputSchema: {
      id: z.number().int().describe('Movie id'),
    },
  },
  async ({ id }) => {
    const res = await fetch(`${API}/movies/${id}`);
    if (res.status === 404) return fail(`No movie with id ${id}`);
    if (!res.ok) return fail(`API returned HTTP ${res.status}`);
    return ok(await res.json());
  },
);

server.registerTool(
  'add_movie',
  {
    title: 'Add a movie',
    description: 'Add a new movie to the catalog. Returns the created record (with its assigned id).',
    inputSchema: {
      title: z.string().describe('Movie title'),
      director: z.string().describe('Director name'),
      year: z.number().int().describe('Release year'),
      rating: z.number().optional().describe('Rating 0–10 (optional)'),
    },
  },
  async ({ title, director, year, rating }) => {
    const res = await fetch(`${API}/movies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, director, year, rating }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return fail(body.error ?? `API returned HTTP ${res.status}`);
    }
    return ok(await res.json());
  },
);

server.registerTool(
  'delete_movie',
  {
    title: 'Delete a movie',
    description: 'Delete a movie by id. Returns the deleted record.',
    inputSchema: {
      id: z.number().int().describe('Movie id'),
    },
  },
  async ({ id }) => {
    const res = await fetch(`${API}/movies/${id}`, { method: 'DELETE' });
    if (res.status === 404) return fail(`No movie with id ${id}`);
    if (!res.ok) return fail(`API returned HTTP ${res.status}`);
    return ok(await res.json());
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is fine for logs; stdout is reserved for the JSON-RPC protocol.
console.error(`movies MCP server connected (proxying ${API})`);
