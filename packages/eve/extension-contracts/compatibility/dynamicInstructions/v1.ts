import { defineDynamic, defineInstructions } from "#public/instructions/index.js";

export default defineDynamic({
  events: {
    "session.started": () => defineInstructions({ markdown: "Use the retained instructions." }),
  },
});
