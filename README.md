# Postfleet MCP

Give an AI agent its own email address. [Postfleet](https://postfleet.ai) is email infrastructure for
agents — inbound is parsed, classified, extracted to your schema, and screened for prompt injection
before your agent reads a word.

This repo holds the server source and its plugin manifests. It is a **mirror** — the code is
developed in the Postfleet application repo and published to npm as
[`@postfleet/mcp`](https://www.npmjs.com/package/@postfleet/mcp); open issues here, send patches
here, and they land upstream. The server ships two ways:

| | |
|---|---|
| **Hosted** (no install) | `https://api.postfleet.ai/api/mcp`, streamable HTTP, `Authorization: Bearer pf_...` |
| **Local** (stdio) | [`@postfleet/mcp`](https://www.npmjs.com/package/@postfleet/mcp) via `npx` |

Get a `pf_` API key at [postfleet.ai](https://postfleet.ai).

## Tools

`list_mailboxes`, `create_mailbox`, `list_domains`, `create_domain`, `verify_domain`,
`send_email`, `reply_email`, `list_inbox`, `read_email`, `wait_for_email` — plus the draft
lifecycle (`create_draft`, `list_drafts`, `get_draft`, `update_draft`, `send_draft`,
`delete_draft`) for flows where a human approves before mail goes out. A send that lands in
that gate returns **202 pending_approval**, which is not a failure.

Every tool is thin-over-REST — it calls the same `/api/v1/` endpoints your key already reaches
([OpenAPI](https://postfleet.ai/openapi.json)), so auth, scoping, and quotas are enforced once.

## Install

### Cursor marketplace plugin

The manifests in this repo (`mcp.json`, `.cursor-plugin/plugin.json`) declare
`headers.Authorization = Bearer ${POSTFLEET_API_KEY}` for the hosted server and the same
variable for local `npx @postfleet/mcp`. Installing the plugin should prompt for that key and
attach it as a real Bearer header — a raw URL add without the header will 401 on
`initialize` until a key is supplied or the hosted connect card finishes OAuth.

### Cursor (manual)

```json
{
  "mcpServers": {
    "postfleet": {
      "url": "https://api.postfleet.ai/api/mcp",
      "headers": { "Authorization": "Bearer pf_your_key_here" }
    }
  }
}
```

### Local stdio (`npx @postfleet/mcp`)

```bash
claude mcp add postfleet --env POSTFLEET_API_KEY=pf_your_key_here -- npx -y @postfleet/mcp
```

```json
{
  "mcpServers": {
    "postfleet": {
      "command": "npx",
      "args": ["-y", "@postfleet/mcp"],
      "env": { "POSTFLEET_API_KEY": "pf_your_key_here" }
    }
  }
}
```

`POSTFLEET_API_URL` (default `https://api.postfleet.ai`) overrides the API origin for staging or
self-hosted deployments.

## Keys

Keys are scoped — `bootstrap` can only create mailboxes, `api` covers mail operations, `mcp` is the
one to hand a client. Use a separate key per workload so you can revoke one without breaking the
rest. Never commit a key; the manifests in this repo deliberately contain none.

## Links

- Registry listing: `ai.postfleet/postfleet` on the [MCP Registry](https://registry.modelcontextprotocol.io)
- npm: [`@postfleet/mcp`](https://www.npmjs.com/package/@postfleet/mcp)
- Docs: [postfleet.ai/docs/mcp](https://postfleet.ai/docs/mcp)

## Build from source

```bash
npm install && npm run build   # tsup → dist/
```

MIT licensed.
