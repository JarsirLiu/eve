import { defineDynamic, defineSkill } from "#public/skills/index.js";

export default defineDynamic({
  events: {
    "session.started": () =>
      defineSkill({
        description: "A retained dynamic skill",
        markdown: "Use the retained skill.",
        files: { "references/example.txt": "Retained skill content." },
      }),
  },
});
