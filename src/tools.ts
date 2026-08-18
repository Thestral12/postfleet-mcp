import { callRest, type ToolCtx } from './context';

export async function createMailbox(ctx: ToolCtx, args: { slug?: string; display_name?: string; extraction_schema_id?: string; domain_id?: string }) {
  return (await callRest(ctx, 'POST', '/api/v1/mailboxes', args)) as { id: string; address: string };
}

// The other half of the create_mailbox domain_id pair: an agent can only pass a domain_id it can
// discover. Account-plane read — a mailbox-bound key gets the same 403 key_scope REST gives it.
export async function listDomains(ctx: ToolCtx) {
  return callRest(ctx, 'GET', '/api/v1/domains');
}

// Discovery: every mailbox-scoped tool needs a mailbox_id, and create_mailbox was previously the
// only source of one. A mailbox-bound key gets a single-element list (its own mailbox), so this
// answers "what can I use?" identically regardless of how the key was scoped.
export async function listMailboxes(ctx: ToolCtx) {
  return callRest(ctx, 'GET', '/api/v1/mailboxes');
}

// A send on an approval-gated mailbox does NOT error — it returns HTTP 202 with the draft shape
// below (queued for a human), which callRest passes through unchanged. The union keeps the
// draft_id visible to callers so an agent can tell "queued for approval" from "sent".
type SendResult = { id: string; thread_id: string } | { draft_id: string; status: 'pending_approval' };

// client_id is the REST idempotency key (spec rev 2.1): same client_id + same payload replays the
// stored outcome instead of sending again. Without it, an agent retrying after a network failure
// that struck AFTER the API accepted the send would deliver the email twice. Required at the MCP
// layer (REST keeps it optional): protection an agent can silently skip is protection it will skip.
export async function sendEmail(ctx: ToolCtx, args: { mailbox_id: string; to: string; subject: string; text: string; client_id: string }) {
  return (await callRest(ctx, 'POST', '/api/v1/send', args)) as SendResult;
}

export async function replyEmail(ctx: ToolCtx, args: { mailbox_id: string; reply_to_message_id: string; text: string; client_id: string }) {
  return (await callRest(ctx, 'POST', '/api/v1/send', args)) as SendResult;
}

// Thin-over-REST draft tools (spec P5). A draft is a message prepared but not yet sent; it can be
// sent later with sendDraft, or forwarded to a human when the mailbox requires approval.
export async function createDraft(
  ctx: ToolCtx,
  args: { mailbox_id: string; to?: string; subject?: string; text: string; reply_to_message_id?: string },
) {
  return (await callRest(ctx, 'POST', '/api/v1/drafts', args)) as { id: string; status: string };
}

export async function listDrafts(ctx: ToolCtx, args: { mailbox_id: string }) {
  return callRest(ctx, 'GET', `/api/v1/drafts?mailbox_id=${encodeURIComponent(args.mailbox_id)}`);
}

// The rest of the draft lifecycle (spec P5). list_drafts shows WHAT is queued; these let the agent
// act on it — read one in full, fix a draft a human bounced, or withdraw one. Without them the
// pending_approval flow was observe-only over MCP even though the REST routes existed.
export async function getDraft(ctx: ToolCtx, args: { id: string }) {
  return callRest(ctx, 'GET', `/api/v1/drafts/${encodeURIComponent(args.id)}`);
}

// reply_to_message_id is immutable server-side (re-targeting a reply can't re-thread) — not accepted here.
export async function updateDraft(ctx: ToolCtx, args: { id: string; to?: string; subject?: string; text?: string }) {
  const { id, ...body } = args;
  return callRest(ctx, 'PATCH', `/api/v1/drafts/${encodeURIComponent(id)}`, body);
}

export async function deleteDraft(ctx: ToolCtx, args: { id: string }) {
  // 204 No Content on success — callRest yields {}, which reads as a silent no-op to an agent, so
  // return an explicit confirmation instead.
  await callRest(ctx, 'DELETE', `/api/v1/drafts/${encodeURIComponent(args.id)}`);
  return { deleted: true, id: args.id };
}

// A 202 {draft_id, status:'pending_approval'} here means the send was queued for human approval —
// callRest treats 2xx as success, so this returns the body, not a thrown error.
export async function sendDraft(ctx: ToolCtx, args: { id: string }) {
  return (await callRest(ctx, 'POST', `/api/v1/drafts/${encodeURIComponent(args.id)}/send`, {})) as SendResult;
}

export async function listInbox(ctx: ToolCtx, args: { mailbox_id: string; limit?: number }) {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  return callRest(ctx, 'GET', `/api/v1/messages?mailbox_id=${encodeURIComponent(args.mailbox_id)}&limit=${limit}`);
}

export async function readEmail(ctx: ToolCtx, args: { message_id: string }) {
  const raw = (await callRest(ctx, 'GET', `/api/v1/messages/${encodeURIComponent(args.message_id)}`)) as Record<string, unknown>;
  // security: body_raw and subject_raw are the pre-sanitization originals — the exact injection
  // surface the sanitize stage strips. Neither must ever reach an agent's context via MCP.
  const { body_raw: _raw, subject_raw: _rawSubject, mailboxes: _joinArtifact, ...safe } = raw;
  return safe;
}

type WaitOpts = { pollIntervalMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> };

// The tool agent devs don't know they need (spec §5 Lovable): block until the reply arrives.
export async function waitForEmail(
  ctx: ToolCtx,
  args: { mailbox_id: string; from_contains?: string; subject_contains?: string; timeout_seconds?: number },
  opts: WaitOpts = {},
): Promise<unknown> {
  const pollMs = opts.pollIntervalMs ?? 2000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = Math.min(Math.max(args.timeout_seconds ?? 60, 1), 120) * 1000;

  const startedAt = now();
  const from = args.from_contains?.toLowerCase();
  const subject = args.subject_contains?.toLowerCase();

  for (;;) {
    const list = (await callRest(ctx, 'GET', `/api/v1/messages?mailbox_id=${encodeURIComponent(args.mailbox_id)}&limit=20`)) as {
      messages: { id: string; direction: string; from_addr: string; subject: string; created_at: string }[];
    };
    const hit = (list.messages ?? []).find((m) =>
      m.direction === 'in' &&
      Date.parse(m.created_at) >= startedAt &&
      (!from || m.from_addr.toLowerCase().includes(from)) &&
      (!subject || m.subject.toLowerCase().includes(subject)),
    );
    if (hit) return readEmail(ctx, { message_id: hit.id });
    if (now() - startedAt >= timeoutMs) {
      return { timed_out: true, waited_seconds: Math.round(timeoutMs / 1000) };
    }
    await sleep(pollMs);
  }
}
