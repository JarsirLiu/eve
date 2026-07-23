import { Client, type HandleMessageStreamEvent } from "eve/client";
import { EveTUIRunner, MockScreen, MockUserInput } from "./lib/tui.ts";

import { theme } from "./lib/theme.ts";

/**
 * Smoke test for the interactive `/compact` command.
 *
 * The session methods are replaced with a deterministic maintenance response,
 * so this test exercises the real prompt, runner, renderer, and command
 * transcript without requiring an agent server or model credentials.
 */
process.env.EVE_TUI_UNICODE = "1";

void (async () => {
  const client = new Client({ host: "http://127.0.0.1:49219" });
  const session = client.session();
  session.send = async () => {
    throw new Error("/compact must not send a model message");
  };
  session.compact = async () => ({ commandId: "compact-smoke", status: "accepted" });
  session.stream = async function* () {
    yield {
      type: "compaction.requested",
      data: {
        compactionId: "compact-smoke",
        modelId: "gpt-5",
        sequence: 1,
        sessionId: "session-smoke",
        trigger: "manual",
        usageInputTokens: null,
      },
    } as HandleMessageStreamEvent;
    yield {
      type: "compaction.completed",
      data: {
        changed: false,
        compactionId: "compact-smoke",
        modelId: "gpt-5",
        sequence: 2,
        sessionId: "session-smoke",
        trigger: "manual",
      },
    } as HandleMessageStreamEvent;
  };

  const screen = new MockScreen({ columns: 100, rows: 40 });
  const input = new MockUserInput();
  const runner = new EveTUIRunner({
    session,
    screen,
    userInput: input,
    name: "TUI compaction",
  });
  const runPromise = runner.run();
  const keepAlive = setInterval(() => {}, 1_000);

  try {
    await screen.waitForIdlePrompt(5_000);
    input.type("/compact");
    input.enter();
    await screen.waitForText("No context changes were needed.", 5_000);
    await screen.waitForIdlePrompt(5_000);

    input.type("/exit");
    input.enter();
    await runPromise;
    console.log(theme.muted("[tui-compact] command and event outcomes rendered"));
  } catch (error) {
    input.ctrlC();
    await runPromise.catch(() => {});
    throw error;
  } finally {
    clearInterval(keepAlive);
  }
})().catch((error: unknown) => {
  console.error(theme.danger("\n[tui] tui-compact smoke test failed:"), error);
  process.exitCode = 1;
});
