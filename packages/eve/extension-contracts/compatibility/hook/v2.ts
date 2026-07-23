import { defineHook } from "#public/hooks/index.js";

export default defineHook({
  events: {
    "session.started": (_event, ctx) => {
      console.info("session started", ctx.session.id);
    },
  },
});
