import { z } from "#compiled/zod/index.js";

/** Successful response returned after a manual compaction command is admitted. */
export interface CompactSessionResponse {
  readonly commandId: string;
  readonly ok: true;
  readonly sessionId: string;
  readonly status: "accepted";
}

export const CompactSessionResponseSchema: z.ZodType<CompactSessionResponse> = z.object({
  commandId: z.string().min(1),
  ok: z.literal(true),
  sessionId: z.string().min(1),
  status: z.literal("accepted"),
});
