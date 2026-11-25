import { z } from "zod";

export const readinessSchema = z.object({
  status: z.enum(["ready", "unavailable"]),
  checkedAt: z.iso.datetime(),
  requestId: z.uuid(),
});

export type Readiness = z.infer<typeof readinessSchema>;

export const staffRole = z.enum(["Admin", "Sales", "Manager", "Finance", "Operations"]);
export type StaffRole = z.infer<typeof staffRole>;
export const rolesSchema = z.array(staffRole).min(1).max(5)
  .refine(roles => new Set(roles).size === roles.length, "Choose each role once");
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const loginSchema = z.strictObject({ email: emailSchema, password: z.string().min(1).max(128) });
export const passwordResetSchema = z.strictObject({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: z.string().min(15).max(128),
});
export const provisionSchema = z.strictObject({ email: emailSchema, roles: rolesSchema });
export const updateStaffSchema = z.strictObject({
  roles: rolesSchema, active: z.boolean(), version: z.int().positive(),
});
export const staffSchema = z.object({
  id: z.uuid(), email: emailSchema, roles: rolesSchema, active: z.boolean(), version: z.int().positive(),
});
export type Staff = z.infer<typeof staffSchema>;
export const sessionSchema = z.object({ user: staffSchema, csrfToken: z.string().length(64) });
export type StaffSession = z.infer<typeof sessionSchema>;
export const issuedCodeSchema = z.object({ code: z.string().length(43), expiresAt: z.iso.datetime() });
export const directorySchema = z.object({ users: z.array(staffSchema), hasMore: z.boolean() });
