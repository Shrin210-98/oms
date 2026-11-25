import { z } from "zod";

export const readinessSchema = z.object({
  status: z.enum(["ready", "unavailable"]),
  checkedAt: z.iso.datetime(),
  requestId: z.uuid(),
});

export type Readiness = z.infer<typeof readinessSchema>;
