import { defineDynamic, defineTool } from "#public/tools/index.js";

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) =>
      defineTool({
        description: "Inspect the current session",
        inputSchema: { type: "object", properties: {} },
        execute: () => ({ sessionId: ctx.session.id }),
      }),
  },
});
