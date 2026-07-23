---
issue: TBD
status: in_progress
last_updated: "2026-07-23"
---

# Manual session compaction

## Summary

eve currently compacts a session automatically from the tool loop when the
estimated input exceeds the configured threshold. Users of an agent have no
framework-owned operation for requesting the same maintenance explicitly.

Add manual compaction as a session maintenance command. The command must be
serialized by the durable session driver and must reuse the existing
compaction pipeline. It must not be implemented as a special user message,
an authored tool, or a direct history mutation in an HTTP handler.

The first release should target parked conversation sessions only. An active
turn returns a typed conflict instead of being cancelled or silently queued.
Queuing a maintenance command during an active turn is a separate follow-up
that requires the same admission ordering guarantees as channel turn steering.

## Existing design

The current flow has four relevant boundaries:

```text
tool loop
    -> shouldCompact()
    -> compactMessages()
    -> onCompaction() framework-state preservation
    -> durable session snapshot

HTTP / SDK / channel input
    -> runtime hook
    -> session driver
    -> turn workflow
    -> durable session snapshot
```

- `harness/tool-loop.ts#maybeCompact` decides whether automatic compaction is
  needed and emits `compaction.requested` / `compaction.completed`.
- `harness/compaction.ts#compactMessages` owns tool-result capping, recent
  window selection, checkpoint summarization, and provider resumption guards.
- `harness/types.ts#ToolLoopHarnessConfig.onCompaction` lets the execution
  layer preserve framework-owned state after compaction.
- `execution/workflow-steps.ts` hydrates and persists the session through a
  durable snapshot.
- `execution/workflow-entry.ts` owns the long-lived session driver. It already
  serializes turns and public deliveries through workflow hooks.
- `protocol/message.ts` already exposes compaction lifecycle events, but those
  events currently assume compaction happens inside a normal turn.

The implementation must preserve this ownership model. The session driver is
the only component that admits a maintenance command, and a workflow step is
the only component that mutates durable session history.

## Typical post-turn flow

In conversation mode, a completed assistant reply does not destroy the
session. The driver settles the turn, persists the latest snapshot, emits
`session.waiting`, and parks while waiting for the next delivery. This is the
natural point for a user to request manual compaction:

```text
assistant reply completed
    -> session.waiting / parked driver
    -> ClientSession.compact()
    -> compact admission on the parked session
    -> durable compaction step
    -> snapshot replacement
    -> compaction.completed (changed: true | false)
    -> session remains parked for the next user message
```

The compact request should wake the same session driver that owns the public
delivery lifecycle. It must be admitted through one serialized command path
alongside normal delivery; two independent workflow hooks must not race and
infer ordering from promise timing. A parked-only MVP can reject a request
that arrives after a turn has become active with `409 active_turn`. Supporting
queueing during an active turn is a separate admission-ledger change.

This post-turn path does not start a model turn. It emits no user message,
assistant reply, `turn.started`, or fabricated `turnId`. The command only
replaces the durable history, then returns the driver to its existing parked
state. A session with no compressible history still completes successfully
with `changed: false`.

## Change surface

The MVP is a medium-sized cross-layer change, but it does not require changing
the automatic compaction decision or the normal turn loop. The affected
surfaces are:

- harness: expose a forced invocation of the existing compaction pipeline and
  report whether the history changed;
- protocol and client: add the compact operation, acknowledgement, route, and
  additive compaction metadata;
- execution: add the parked-session command admission and one durable step
  that hydrates, compacts, preserves framework state, and atomically persists;
- tests and docs: cover parked admission, active-turn rejection, idempotency,
  failure atomicity, event-stream behavior, and the public API.

The normal send, automatic threshold check, cancellation, HITL flow, task-mode
flow, and child-session routing should remain unchanged in the MVP. The main
risk is command admission and replay ordering, not the summary algorithm.

## Design principles

Manual compaction is a first-class session maintenance operation. It has its
own trigger, lifecycle, and persistence boundary, and it reuses the automatic
compaction pipeline and framework-state preservation hooks.

The operation is owned by the durable session driver. It must not replace an
in-memory task, depend on a process-local queue, or mutate history in an HTTP
handler. The driver provides ordering and replay guarantees; the workflow step
is the only place that writes the replacement snapshot.

Manual compaction is separate from a user conversation turn. In the
parked-session MVP it emits a `compactionId` and `trigger: "manual"`, but no
synthetic `turnId`, `turn.started`, user message, or assistant reply.

## Proposed public API

The public surface should mirror existing session and cancellation surfaces:

```ts
await session.compact();
```

The low-level runtime surface is:

```ts
agent.requestCompaction({
  sessionId,
  commandId,
});
```

The framework HTTP surface is:

```text
POST /eve/v1/session/:sessionId/compact
```

The request body is optional. `commandId` may be supplied for retry
idempotency. A successful request returns `202` and an acknowledgement that
the command was durably admitted. Completion is observed on the session event
stream, not by holding the HTTP request open for the summarization model call.

Custom channel routes should eventually expose a continuation-addressed
`compact()` helper. The helper must use the same runtime operation as the
framework HTTP route; channel adapters must not implement their own history
logic.

The CLI/TUI `/compact` command should call `ClientSession.compact()` and render
the existing stream events. It should not send the literal text `/compact` to
the agent model.

## Observable semantics

| Session state                         | Manual compaction behavior                                            |
| ------------------------------------- | --------------------------------------------------------------------- |
| No session exists                     | Typed no-session error; never starts a new session.                   |
| Parked conversation session           | Admit and execute one maintenance operation.                          |
| Active turn                           | Return `409 active_turn`; do not cancel, interrupt, or reorder input. |
| Pending authorization or HITL request | Return a typed busy result; preserve the pending request.             |
| Task-mode or non-resumable session    | Reject until a durable successor policy exists.                       |
| No compressible history               | Succeed with `changed: false`; do not call the model.                 |
| Duplicate `commandId`                 | Return the original acknowledgement/result; do not append twice.      |
| Compaction model failure              | Emit a compaction failure event and leave the prior snapshot intact.  |

Manual compaction is forced with respect to the automatic threshold, but it
does not introduce a second algorithm. It uses the configured compaction model
and target threshold, the existing recent-window policy, and the same
framework-state preservation callback. A manual request may therefore be a
model-free tool-result cap, a model summary, or a no-op depending on history.

Manual compaction is not a model turn. It must not emit `turn.started`,
`message.received`, or a fabricated `turnId`. It keeps the session resumable
and does not create an assistant reply.

## Protocol events

Extend the existing compaction events additively:

```ts
interface CompactionMetadata {
  readonly compactionId: string;
  readonly trigger: "automatic" | "manual";
}
```

`compaction.requested` and `compaction.completed` should carry this metadata.
For manual maintenance events, `turnId` must be optional because no logical
turn owns the operation. `compaction.completed` should also carry `changed`.

Add `compaction.failed` for an asynchronously admitted manual command. The
event should contain the operation id, trigger, stable error code, and session
id. A failure is recoverable: the session remains parked and its previous
durable history remains authoritative.

Existing automatic event consumers must continue to work when they ignore the
new fields. New clients must treat unknown event fields as forward-compatible
and must not assume every compaction event has a `turnId`.

## Ownership and durability

The first release should use a parked-only maintenance hook owned by the
session driver:

```text
compact request
    -> authenticated session route
    -> stable parked-session command hook
    -> driver claims the command
    -> runCompactionStep (use step)
    -> emit requested/completed or failed
    -> write the new durable snapshot
    -> re-arm the normal delivery hook
```

The compaction step must:

1. Read the latest durable snapshot immediately before transforming it.
2. Hydrate the current turn agent and compaction model configuration.
3. Invoke the shared compaction pipeline with an explicit force request.
4. Run `onCompaction()` inside the same context used by normal turns.
5. Write the replacement snapshot only after the compaction result is ready.
6. Emit completion only after the snapshot write is durable.

Do not add a new `NextDriverAction` union arm in the first implementation.
That protocol is explicitly closed for pinned drivers; a new arm would need a
durable version/migration and capability rollout. Keep the maintenance command
at the session-driver boundary or add an optional field to an existing
forward-compatible payload only after compatibility tests prove the behavior.

The command acknowledgement must be idempotent across route retries,
workflow replay, and deployment retries. The command id and result state must
be owned by the driver, not by process-local memory.

## Compatibility and risk controls

The first release deliberately does not support active-turn queuing. This
avoids changing the existing delivery race between the public delivery hook,
the turn control hook, cancellation, and HITL responses.

The later active-turn design must follow the admission-ledger model in
`research/channel-turn-steering.md`: every delivery and maintenance command
needs a durable sequence, explicit ownership, and a consumed/released result.
It must not race two independent hooks and infer ordering from promise timing.

Other required safeguards:

- Automatic compaction behavior and threshold triggering remain unchanged.
- The existing todo/read-state preservation path is shared, not duplicated.
- Compaction failure never replaces the last good snapshot.
- Authentication is applied to the new route exactly as for session messages.
- A compact command cannot fall through to `run()` and create a new session.
- Child sessions are not exposed through a root-session maintenance shortcut.
- Existing clients can ignore new event fields without breaking.
- The session token-limit accounting decision is explicit and covered by tests;
  the manual path must not accidentally bypass configured limits.

## Implementation sequence

1. Add pure harness support for forced compaction and result metadata.
2. Add protocol types, route paths, acknowledgement schema, and client API.
3. Add parked-session driver command ownership and the durable compaction step.
4. Add event emission, failure handling, idempotency, and snapshot tests.
5. Add the TUI command and public documentation. The TUI now registers
   `/compact` for local and remote sessions, calls `ClientSession.compact()`
   without sending model text, follows the same session stream, and renders
   accepted, completed, no-change, and failure outcomes.
6. Add a deterministic hosted e2e evaluation using the compaction regression
   fixture or a focused manual-compaction fixture.

The active-turn queue is a separate proposal. It should not be included in the
same change unless the admission ledger and pinned-driver compatibility work
are already complete.

## Verification

Focused tests must cover:

- forced model-free and model-backed compaction;
- checkpoint replacement and previous-checkpoint updates;
- tool-result capping and recent-window preservation;
- todo and read-before-write state preservation;
- parked-session admission and active-turn rejection;
- duplicate command ids and workflow replay;
- concurrent normal delivery versus compaction admission;
- compaction model failure and snapshot atomicity;
- authentication and unknown-session responses;
- client state and event-stream behavior.

Repository checks for the implementation are `pnpm fmt`, `pnpm lint`,
`pnpm typecheck`, `pnpm guard:invariants`, the focused unit/integration tests,
`pnpm docs:check`, and the relevant CI-only e2e evaluation. A published
`eve` API change requires a patch changeset.

The TUI command and prompt registry are covered by the focused unit tests in
`packages/eve/src/cli/dev/tui/prompt-commands.test.ts` and
`packages/eve/src/cli/dev/tui/runner.test.ts`. The repository checks completed
for this stage are `pnpm lint`, `pnpm typecheck`, `pnpm guard:invariants`, and
`pnpm docs:check`; the hosted e2e evaluation remains pending.

## Out of scope

- Treating `/compact` as an authored model message or tool.
- Rewriting or deleting the original durable event stream.
- Cancelling an active model or tool operation.
- Active-turn compaction queueing in the first release.
- Compaction of task-mode successor sessions.
- User-provided summary text or a custom summarizer hook.
- A new compaction threshold or a second compaction algorithm.

## Success criteria

- A client can request compaction without sending model-visible text.
- The operation uses the same compaction and framework-state preservation logic
  as automatic compaction.
- The result is durable, observable, authenticated, and idempotent.
- Existing automatic compaction, delivery, cancellation, HITL, and subagent
  behavior remains unchanged.
- Active-turn behavior is explicit and safe rather than timing-dependent.
