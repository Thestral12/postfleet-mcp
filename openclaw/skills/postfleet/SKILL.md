---
name: postfleet
description: Use when the agent needs its own email address — sending mail, replying in a thread, reading or polling an inbox, waiting for a message to arrive (verification codes, confirmations, replies), staging drafts for approval, or setting up a custom sending domain. Covers the Postfleet MCP tools (list_mailboxes, send_email, wait_for_email, drafts, domains).
---

# Postfleet — email for agents

Postfleet gives this agent a real mailbox. Mail sent to it arrives in an inbox the
agent can list, read, and wait on; mail the agent sends comes from its own address.

## Setup

Set `POSTFLEET_API_KEY` to a `pf_` key from https://postfleet.ai before starting the
gateway. The plugin's MCP server reads it from the environment; without it every tool
call fails with an auth error.

Tools appear as `postfleet__<tool>` (for example `postfleet__list_mailboxes`).

## The one rule: start with `list_mailboxes`

Every mailbox-scoped tool needs a `mailbox_id`, and `list_mailboxes` is where one comes
from. Call it first. Only call `create_mailbox` when the list is empty or the task
genuinely needs a second, separate address — a key bound to a single mailbox returns
just that one, so the list is also the answer to "what am I allowed to use?".

## Sending and replying

- `send_email` — needs `mailbox_id`, `to`, `subject`, `text`, and a `client_id` you
  generate. The `client_id` is an idempotency key: reuse the same value if you retry a
  send, and never reuse it for a different message.
- `reply_email` — replies in-thread. Takes `reply_to_message_id` from `list_inbox` or
  `read_email` rather than a fresh subject line. Prefer it over `send_email` whenever
  you are answering something; it keeps the thread intact for the human on the far end.

Either call can come back as `{ draft_id, status: 'pending_approval' }` instead of a
sent message. That is not an error — the mailbox requires human approval, and the
message is now a draft. Report that to the user rather than retrying the send.

## Reading and waiting

- `list_inbox` — recent messages, newest first.
- `read_email` — the full body of one `message_id`.
- `wait_for_email` — blocks until a matching message arrives. This is the tool for
  "sign up, then confirm the address": send the signup, then wait, rather than polling
  `list_inbox` in a loop.

## Drafts

`create_draft`, `list_drafts`, `get_draft`, `update_draft`, `send_draft`, `delete_draft`.

Use a draft when a human should see the message before it goes out, or when you are
composing across several turns. `send_draft` takes no `client_id` — the draft id is
already the idempotency key.

## Custom domains

`list_domains` shows the account's sending domains and their verification state.
`create_domain` adds one and returns the DNS records to publish; `verify_domain`
re-checks DNS after the records are live. Verification is not instant — if it comes
back unverified, the records have not propagated yet, so tell the user to wait rather
than calling `create_domain` again.

Pass a verified `domain_id` to `create_mailbox` to get an address on that domain
instead of a Postfleet default one.

## Local stdio instead of the hosted server

This plugin talks to the hosted endpoint at `https://api.postfleet.ai/api/mcp`. To run
the server locally instead, override the entry in your own OpenClaw config:

```json
{
  "mcp": {
    "servers": {
      "postfleet": {
        "command": "npx",
        "args": ["-y", "@postfleet/mcp"],
        "env": { "POSTFLEET_API_KEY": "${POSTFLEET_API_KEY}" }
      }
    }
  }
}
```

User config wins over a plugin default, so this replaces the hosted server without
editing the plugin. Set `POSTFLEET_API_URL` as well to point at staging or a
self-hosted deployment.
