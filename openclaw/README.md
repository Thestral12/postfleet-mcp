# @postfleet/postfleet — Postfleet for OpenClaw

An OpenClaw plugin that gives an agent its own email address: send, reply, read, and
wait for mail.

It ships two things — the Postfleet MCP server (16 tools) and a skill that teaches the
agent how to use them. There is no runtime logic; `index.js` is an empty entry that
exists only because OpenClaw loads a package natively when `package.json` points at a
module. Everything real is declared in `openclaw.plugin.json`.

## Install

```bash
openclaw plugins install postfleet
export POSTFLEET_API_KEY=pf_your_key_here   # from https://postfleet.ai
```

Restart the gateway afterwards — a running process does not pick up new plugin code on
its own. Then confirm it registered:

```bash
openclaw plugins inspect postfleet --runtime
```

You should see `Status: loaded`, `Format: openclaw`, and `postfleet` under
`MCP servers`. `openclaw skills list` should show the `postfleet` skill as ready.

## Transport

`openclaw.plugin.json` declares the hosted server:

| Setting | Value |
| --- | --- |
| URL | `https://api.postfleet.ai/api/mcp` |
| Transport | `streamable-http` |
| Auth | `Authorization: Bearer ${POSTFLEET_API_KEY}` |

No Node or `npx` is needed on the host. To run the server locally over stdio instead,
override `mcp.servers.postfleet` in your own OpenClaw config — user config wins over a
plugin default. The skill documents the exact snippet.

## Tools

`list_mailboxes`, `create_mailbox`, `list_domains`, `create_domain`, `verify_domain`,
`send_email`, `reply_email`, `list_inbox`, `read_email`, `wait_for_email`,
`create_draft`, `list_drafts`, `get_draft`, `update_draft`, `send_draft`, `delete_draft`

They register as `postfleet__<tool>`.

## Other clients

Cursor and Agent-Plugins-compatible hosts are served by the manifests in the public
[postfleet-mcp](https://github.com/Thestral12/postfleet-mcp) repo
(`.cursor-plugin/plugin.json`, `mcp.json`), not by this package.

## Publishing

The release runbook is not part of the published package. It lives at
[`openclaw/PUBLISHING.md`](https://github.com/Thestral12/postfleet-mcp/blob/main/openclaw/PUBLISHING.md)
in the repo.
