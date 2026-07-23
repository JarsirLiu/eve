import { createHook } from "#compiled/@workflow/core/index.js";

import type { CompactHookPayload } from "#channel/types.js";
import { claimHookOwnership, disposeHook } from "#execution/hook-ownership.js";

export function sessionCompactionHookToken(sessionId: string): string {
  return `${sessionId}:compact`;
}

interface SessionCompactionHook {
  readonly consumeNext: () => void;
  readonly dispose: () => Promise<CompactHookPayload | undefined>;
  readonly next: () => Promise<IteratorResult<CompactHookPayload>>;
}

/** Creates the parked-only hook used to admit one maintenance command. */
export async function createSessionCompactionHook(
  sessionId: string,
): Promise<SessionCompactionHook> {
  const hook = createHook<CompactHookPayload>({ token: sessionCompactionHookToken(sessionId) });
  await claimHookOwnership(hook);

  const iterator = hook[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<CompactHookPayload>> | undefined;
  let offered = false;

  return {
    consumeNext(): void {
      if (!offered) throw new Error("Cannot consume a compaction command before it resolves.");
      pending = undefined;
      offered = false;
    },
    async dispose(): Promise<CompactHookPayload | undefined> {
      const pendingRead = pending;
      await disposeHook(hook);
      pending = undefined;
      offered = false;

      // Disposal releases the token, but a resume that committed before the
      // release can still settle the armed iterator. Preserve that command so
      // a delivery/compaction race cannot acknowledge work and then drop it.
      if (pendingRead !== undefined) {
        try {
          const result = await pendingRead;
          return result.done ? undefined : result.value;
        } catch {
          return undefined;
        }
      }
      return undefined;
    },
    next(): Promise<IteratorResult<CompactHookPayload>> {
      if (pending === undefined) {
        pending = iterator.next();
        pending.catch(() => {});
      }
      offered = true;
      return pending;
    },
  };
}

export type { SessionCompactionHook };
