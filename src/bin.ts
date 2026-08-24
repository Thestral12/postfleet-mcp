#!/usr/bin/env node
// Local (stdio) transport for the Postfleet MCP server. Same tools as the hosted
// HTTP server — they're thin-over-REST, so this just forwards the user's pf_ key to
// the hosted API. Run via: npx @postfleet/mcp  (configured in an MCP client).
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools, type McpServerLike } from './register';

const token = process.env.POSTFLEET_API_KEY;
if (!token) {
  // stderr: stdout is the JSON-RPC channel and must stay clean.
  console.error('POSTFLEET_API_KEY is required. Get a pf_ key at https://postfleet.ai and set it in your MCP client config.');
  process.exit(1);
}

// Machine surface; override for staging/self-hosted. `||` not `??`: a set-but-blank
// env var (POSTFLEET_API_URL="") must fall back too, else origin='' makes every tool
// fetch a relative URL and fail. Trailing slash stripped so `${origin}${path}` is clean.
const origin = process.env.POSTFLEET_API_URL?.trim().replace(/\/+$/, '') || 'https://api.postfleet.ai';

// Read from the shipped package.json so serverInfo.version never drifts from the release.
// Sibling of dist/bin.js in both the workspace and the published tarball.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const server = new McpServer({ name: 'Postfleet', version });
// Cast mirrors the hosted route: McpServer.tool structurally matches McpServerLike.
registerTools(server as unknown as McpServerLike, { origin, token });

await server.connect(new StdioServerTransport());
console.error(`postfleet-mcp ready (origin: ${origin})`);
