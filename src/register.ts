import { z } from 'zod';
import { ToolError, type ToolCtx } from './context';
import { createMailbox, listMailboxes, listDomains, createDomain, verifyDomain, sendEmail, replyEmail, listInbox, readEmail, waitForEmail, createDraft, listDrafts, getDraft, updateDraft, deleteDraft, sendDraft } from './tools';

// Mirrors the REST SendRequest constraint: the `draft:` prefix is reserved for the synthetic
// idempotency keys the approval flow mints (`draft:{id}:a{n}`, spec P5). REQUIRED here even though
// REST keeps it optional: the double-send protection only exists when a key is present, and an
// optional field is precisely what an agent omits. MCP consumers re-read the schema every session,
// so tightening costs nothing — REST keeps compatibility for direct callers.
const clientIdSchema = z.string().min(1).max(256).regex(/^(?!draft:)/);

/**
 * MCP tool annotations (spec: tools/list `annotations`). Declared structurally rather than
 * imported from the SDK so this package stays transport-agnostic and testable, matching
 * McpServerLike below.
 *
 * Read them as claims we have to honour:
 * - readOnlyHint      does not modify anything
 * - destructiveHint   may destroy or overwrite existing state (only meaningful when not read-only)
 * - idempotentHint    repeating the call with the SAME arguments has no additional effect
 * - openWorldHint     reaches outside this account (i.e. real mail leaves the building)
 */
export type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

// Structural server type: keeps register.ts testable without an MCP transport. Mirrors the SDK's
// `registerTool` config object — `tool()` is deprecated in @modelcontextprotocol/sdk, and this
// shape is also where `outputSchema` lands when we declare return types.
export type McpServerLike = {
  registerTool(
    name: string,
    config: { description: string; inputSchema: Record<string, z.ZodTypeAny>; annotations?: ToolAnnotations },
    cb: (args: unknown) => Promise<ToolResult>,
  ): void;
};
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

// Reused annotation sets. A pure lookup never changes state and never leaves the account.
const READ_ONLY: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
// Sending is additive, not destructive — it creates a message rather than overwriting one — but it
// reaches the outside world. For send_email/reply_email the idempotentHint is earned ONLY by the
// REQUIRED client_id: same arguments means the same client_id, which is exactly the at-most-once
// key. If client_id ever became optional, idempotentHint here would become a lie.
// send_draft deliberately does NOT use this constant: it takes no client_id and earns the same
// claim by a different mechanism — see its own annotation.
const SEND: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
// Outer param is `unknown` (not `never`) so this matches McpServerLike's cb slot under strict
// function-argument checking; the `never`-typed `fn` still lets each call site above stay
// untyped (`wrap((a) => createMailbox(ctx, a))`) — the internal cast bridges the two.
const wrap = (fn: (args: never) => Promise<unknown>) => async (args: unknown): Promise<ToolResult> => {
  try {
    return ok(await fn(args as never));
  } catch (e) {
    // spec §8: errors an agent can recover from — message + hint, never a stack trace
    const msg = e instanceof ToolError ? `${e.message} — ${e.hint}` : 'Unexpected Postfleet error — retry once; if it persists, report it.';
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
};

// Tool descriptions are product UX (spec §5 Lovable) — each says WHEN to call it.
export function registerTools(server: McpServerLike, ctx: ToolCtx): void {
  // Registered first: it is the discovery entry point — most other tools take a mailbox_id
  // directly, and the rest consume ids reached through those (message_id, draft id, domain id).
  // Listing tools first also nudges agents to reuse an existing mailbox over creating one.
  server.registerTool(
    'list_mailboxes',
    {
      description:
        'List the mailboxes you can use, newest first, each with its id and email address. Call this when you need a mailbox_id for any other tool, or to check whether you already have a mailbox before creating one — it is usually the first call in a workflow. Returns every mailbox on the account, or just your own if your API key is scoped to a single mailbox. An empty list means you have none yet — use create_mailbox.',
      inputSchema: {},
      annotations: READ_ONLY,
    },
    wrap(() => listMailboxes(ctx)),
  );
  server.registerTool(
    'create_mailbox',
    {
      description:
        'Create a NEW email mailbox this agent owns. Call this when list_mailboxes shows you have no suitable mailbox yet — mailboxes persist across sessions, so creating a second one for the same purpose strands mail in the first. Returns a working address immediately. Optional slug personalizes the address (agent-<slug>@...). To create the mailbox on a custom domain instead of the shared one (<slug>@yourdomain.com), pass a domain_id from list_domains — the domain must be verified.',
      inputSchema: {
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/).optional()
          .describe('Optional. Personalizes the address as agent-<slug>@... Lowercase letters, digits and dashes, max 41 chars. Omit for a generated address.'),
        display_name: z.string().max(100).optional()
          .describe('Optional. Human-readable From name shown to recipients, e.g. "Acme Support Bot".'),
        extraction_schema_id: z.uuid().optional()
          .describe('Optional. Id of a JSON Schema to extract inbound mail into. Without it, messages arrive cleaned and screened but with no structured extraction.'),
        domain_id: z.uuid().optional()
          .describe('Optional. Id of a VERIFIED custom domain from list_domains, to host the mailbox at <slug>@yourdomain.com. Omit to use the shared platform domain.'),
      },
      // Not idempotent on purpose: each call mints another mailbox. That is the footgun the
      // description warns about, so the annotation must not imply retries are free.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    wrap((a) => createMailbox(ctx, a)),
  );
  server.registerTool(
    'list_domains',
    {
      description:
        "List the account's custom sending domains with their id, name, and verification status. Call this when you want to create a mailbox on a custom domain (pass the id of a verified domain as create_mailbox's domain_id), or to check whether a domain has finished verifying. Only status \"verified\" domains can host mailboxes; an empty list means only the shared platform domain is available.",
      inputSchema: {},
      annotations: READ_ONLY,
    },
    wrap(() => listDomains(ctx)),
  );
  server.registerTool(
    'create_domain',
    {
      description:
        'Register a NEW custom sending domain on this account. Call this when list_domains does not already include the domain you want to host mailboxes on. Returns the domain id, verification status, and the DNS records to add at your registrar. The domain stays pending until those records are in place — call verify_domain after publishing them. Custom domains require a paid plan. A name that is already registered with Postfleet or the email provider is a conflict, not a success; do not retry with the same name.',
      inputSchema: {
        name: z.string().min(1).max(253)
          .describe('Domain name to register, e.g. mail.example.com or example.com. Protocol and path are stripped if present.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    wrap((a) => createDomain(ctx, a)),
  );
  server.registerTool(
    'verify_domain',
    {
      description:
        'Re-check DNS for a custom domain and refresh its verification status. Call this when you have added the records returned by create_domain, or when list_domains still shows pending and you believe DNS has propagated. Returns the current status (pending, verified, or failed). Only a verified domain can be passed to create_mailbox as domain_id.',
      inputSchema: {
        id: z.uuid().describe('Id of the domain to verify, from list_domains or create_domain.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    wrap((a) => verifyDomain(ctx, a)),
  );
  server.registerTool(
    'send_email',
    {
      description:
        'Send a new email from one of your mailboxes. Call this when starting a NEW conversation; to answer an email you received, use reply_email instead (it threads correctly). Pass a client_id (any unique string you make up) and reuse the SAME client_id if you retry after an error — that guarantees the email is sent at most once. If the mailbox requires human approval, the send is queued as a draft and returns {draft_id, status:"pending_approval"} instead of a message id — that is NOT a failure and must NOT be retried; the email goes out once a human approves it (check with list_drafts).',
      inputSchema: {
        mailbox_id: z.uuid().describe('Id of the mailbox to send from, from list_mailboxes.'),
        to: z.email().describe('Recipient email address.'),
        subject: z.string().max(200).describe('Subject line, max 200 characters.'),
        text: z.string().max(50_000).describe('Plain-text body, max 50,000 characters.'),
        client_id: clientIdSchema
          .describe('REQUIRED idempotency key — any unique string you invent for this send. Reuse the SAME value when retrying after an error and the email goes out at most once; a new value sends a second copy. Cannot start with "draft:".'),
      },
      annotations: SEND,
    },
    wrap((a) => sendEmail(ctx, a)),
  );
  server.registerTool(
    'reply_email',
    {
      description:
        'Reply to an email you received. Call this when answering an existing message — recipient, subject, and conversation threading are derived automatically from the original. Pass a client_id (any unique string you make up) and reuse the SAME client_id if you retry after an error — that guarantees the reply is sent at most once. If the mailbox requires human approval, the reply is queued as a draft and returns {draft_id, status:"pending_approval"} instead of a message id — that is NOT a failure and must NOT be retried; it is sent once a human approves it (check with list_drafts).',
      inputSchema: {
        mailbox_id: z.uuid().describe('Id of the mailbox the original message arrived in.'),
        reply_to_message_id: z.uuid().describe('Id of the message being replied to, from list_inbox or read_email. Recipient, subject and threading are derived from it.'),
        text: z.string().max(50_000).describe('Plain-text reply body, max 50,000 characters.'),
        client_id: clientIdSchema
          .describe('REQUIRED idempotency key — any unique string you invent for this reply. Reuse the SAME value when retrying after an error and the reply goes out at most once; a new value sends a second copy. Cannot start with "draft:".'),
      },
      annotations: SEND,
    },
    wrap((a) => replyEmail(ctx, a)),
  );
  server.registerTool(
    'list_inbox',
    {
      description:
        'List recent messages in a mailbox, newest first, with comprehension status per message. Call this when checking what has arrived; use read_email for full content and extracted data.',
      inputSchema: {
        mailbox_id: z.uuid().describe('Id of the mailbox to list, from list_mailboxes.'),
        limit: z.number().int().min(1).max(100).optional().describe('Optional. How many messages to return, 1-100. Defaults to a small recent page.'),
      },
      annotations: READ_ONLY,
    },
    wrap((a) => listInbox(ctx, a)),
  );
  server.registerTool(
    'read_email',
    {
      description:
        'Read one email in full: cleaned body, sanitization report (screened against known hidden-content patterns), classification, and data extracted to the mailbox schema. Call this when you need the content or extraction of a specific message.',
      inputSchema: {
        message_id: z.uuid().describe('Id of the message to read, from list_inbox or wait_for_email.'),
      },
      annotations: READ_ONLY,
    },
    wrap((a) => readEmail(ctx, a)),
  );
  server.registerTool(
    'wait_for_email',
    {
      description:
        'Block until a matching email arrives in a mailbox (or time out). Call this when you just sent an email and need the reply, or are expecting an inbound message — instead of polling list_inbox yourself. Returns the full message on match, or {timed_out:true}.',
      inputSchema: {
        mailbox_id: z.uuid().describe('Id of the mailbox to watch, from list_mailboxes.'),
        from_contains: z.string().optional().describe('Optional. Only match messages whose sender address contains this substring.'),
        subject_contains: z.string().optional().describe('Optional. Only match messages whose subject contains this substring.'),
        timeout_seconds: z.number().int().min(1).max(120).optional().describe('Optional. How long to wait before giving up, 1-120 seconds. On expiry returns {timed_out:true} rather than an error.'),
      },
      // Read-only despite being long-running: it waits and reads, it never changes anything.
      annotations: READ_ONLY,
    },
    wrap((a) => waitForEmail(ctx, a)),
  );
  server.registerTool(
    'create_draft',
    {
      description:
        'Prepare an email as a draft without sending it. Call this when you want to stage a message for later or for a human to review before it goes out — send it afterward with send_draft. Same fields as send_email, or omit to/subject and pass reply_to_message_id to draft a threaded reply. Returns the draft id with status "draft".',
      inputSchema: {
        mailbox_id: z.uuid().describe('Id of the mailbox the draft belongs to, from list_mailboxes.'),
        to: z.email().optional().describe('Recipient address. Omit only when passing reply_to_message_id, which supplies it.'),
        subject: z.string().max(200).optional().describe('Subject line. Omit only when passing reply_to_message_id, which supplies it.'),
        text: z.string().max(50_000).describe('Plain-text body, max 50,000 characters.'),
        reply_to_message_id: z.uuid().optional().describe('Optional. Draft a threaded reply to this message; recipient and subject are derived from it. Cannot be changed later with update_draft.'),
      },
      // Each call stages another draft, so retrying duplicates rather than no-ops.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    wrap((a) => createDraft(ctx, a)),
  );
  server.registerTool(
    'list_drafts',
    {
      description:
        'List the open drafts in a mailbox (status draft, pending_approval, or sending), newest first. Call this when you need to see messages you have staged or that are queued waiting on human approval, e.g. after a send returned status "pending_approval".',
      inputSchema: {
        mailbox_id: z.uuid().describe('Id of the mailbox whose drafts to list, from list_mailboxes.'),
      },
      annotations: READ_ONLY,
    },
    wrap((a) => listDrafts(ctx, a)),
  );
  server.registerTool(
    'get_draft',
    {
      description:
        'Read one draft in full by its id: recipient, subject, body text, and current status. Call this when you need the content of a specific draft — e.g. to review what is queued for approval after list_drafts, or before editing it with update_draft.',
      inputSchema: {
        id: z.uuid().describe('Id of the draft to read, from create_draft or list_drafts.'),
      },
      annotations: READ_ONLY,
    },
    wrap((a) => getDraft(ctx, a)),
  );
  server.registerTool(
    'update_draft',
    {
      description:
        'Edit the to, subject, or text of a draft that has not been sent yet — omitted fields keep their current value. Call this when a draft needs changes, e.g. a human declined to approve it and you are revising it. The reply target cannot be changed (create a new draft to reply to a different message), and a draft that is already sending or sent can no longer be edited.',
      inputSchema: {
        id: z.uuid().describe('Id of the draft to edit, from create_draft or list_drafts.'),
        to: z.email().optional().describe('Optional. New recipient address. Omit to keep the current one.'),
        subject: z.string().max(200).optional().describe('Optional. New subject line. Omit to keep the current one.'),
        text: z.string().max(50_000).optional().describe('Optional. New plain-text body. Omit to keep the current one.'),
      },
      // Idempotent: writing the same field values twice leaves the draft in the same state.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    wrap((a) => updateDraft(ctx, a)),
  );
  server.registerTool(
    'send_draft',
    {
      description:
        'Send a draft you prepared, by its id. Call this when a staged draft is ready to go out. If the mailbox requires human approval, this returns 202 {draft_id, status:"pending_approval"} — the draft is queued for a human to approve, which is NOT a failure and must NOT be retried; it is sent once approved. Otherwise it sends immediately and returns the message id.',
      inputSchema: {
        id: z.uuid().describe('Id of the draft to send, from create_draft or list_drafts.'),
      },
      // Same values as SEND, spelled out because it earns them differently: send_draft takes no
      // client_id. A repeat is stopped by the atomic draft->sending claim, which 409s once the
      // draft has left 'draft', and a pending_approval draft reports 202 instead of re-queueing.
      // Either way a second call sends nothing, which is exactly what idempotentHint promises.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    wrap((a) => sendDraft(ctx, a)),
  );
  server.registerTool(
    'delete_draft',
    {
      description:
        'Discard a draft by its id so it will never be sent. Call this when a staged or pending-approval message should be withdrawn — e.g. it is no longer needed or was created by mistake. A draft that is already sending or sent cannot be deleted.',
      inputSchema: {
        id: z.uuid().describe('Id of the draft to discard, from create_draft or list_drafts.'),
      },
      // The one genuinely destructive tool: it throws work away. Idempotent because deleting an
      // already-deleted draft leaves the same end state.
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    wrap((a) => deleteDraft(ctx, a)),
  );
}
