import { describe, expect, it, vi } from "vitest";

import { createHook } from "#compiled/@workflow/core/index.js";
import {
  createSessionCompactionHook,
  sessionCompactionHookToken,
} from "#execution/session-compaction-hook.js";

vi.mock("#compiled/@workflow/core/index.js", () => ({
  createHook: vi.fn(),
}));

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("session compaction hook", () => {
  it("preserves a command committed while a losing delivery race is disposed", async () => {
    const read = deferred<IteratorResult<{ commandId: string; kind: "compact" }>>();
    const hook = {
      [Symbol.asyncIterator]: () => ({ next: () => read.promise }),
      dispose: vi.fn(),
      getConflict: vi.fn().mockResolvedValue(null),
      token: sessionCompactionHookToken("session-1"),
    };
    vi.mocked(createHook).mockReturnValue(hook as never);

    const compact = await createSessionCompactionHook("session-1");
    const pending = compact.next();
    const disposing = compact.dispose();
    read.resolve({ done: false, value: { commandId: "command-1", kind: "compact" } });

    await expect(pending).resolves.toEqual({
      done: false,
      value: { commandId: "command-1", kind: "compact" },
    });
    await expect(disposing).resolves.toEqual({ commandId: "command-1", kind: "compact" });
    expect(hook.dispose).toHaveBeenCalledOnce();
  });
});
