import type { ModelMessage } from "ai";

import type { LanguageModel, TelemetryOptions } from "ai";

import { compactMessages } from "#harness/compaction.js";
import type { CompactionConfig } from "#harness/types.js";

import { clearReadFileState } from "#runtime/framework-tools/file-state.js";
import { getTodoCompactionMessage } from "#runtime/framework-tools/todo.js";

/**
 * Re-applies framework-owned state preservation after the harness compacts
 * message history, returning any messages to append to the compacted history.
 *
 * Runs the framework's built-in preservation steps:
 * - resets read-before-write tracking, so a write after compaction re-reads
 *   the file whose read evidence was summarized away;
 * - re-injects the todo list (when present), so the model keeps its task list.
 *
 * Must be called inside the harness step's `AlsContext`; both steps read
 * durable context state.
 */
export function preserveFrameworkStateOnCompaction(): readonly ModelMessage[] {
  clearReadFileState();
  const todo = getTodoCompactionMessage();
  return todo === undefined ? [] : [todo];
}

/** Runs one compaction pass without consulting the automatic threshold. */
export async function forceCompactMessages(input: {
  readonly abortSignal?: AbortSignal;
  readonly config: CompactionConfig;
  readonly headers?: Record<string, string>;
  readonly messages: ModelMessage[];
  readonly model: LanguageModel;
  readonly onCompaction?: () => readonly ModelMessage[];
  readonly providerOptions?: Parameters<typeof import("ai").generateText>[0]["providerOptions"];
  readonly telemetry?: TelemetryOptions;
}): Promise<{ readonly changed: boolean; readonly messages: ModelMessage[] }> {
  const before = JSON.stringify(input.messages);
  const messages = await compactMessages(
    input.messages,
    input.model,
    input.config,
    input.providerOptions,
    input.telemetry,
    input.headers,
    input.abortSignal,
  );

  if (input.onCompaction) {
    messages.push(...input.onCompaction());
  }

  return { changed: before !== JSON.stringify(messages), messages };
}
