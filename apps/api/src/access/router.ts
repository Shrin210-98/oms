import express, { type Request } from "express";
import { parse as parseCookie } from "cookie";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { loginSchema, passwordResetSchema, provisionSchema, updateStaffSchema } from "@oms/contracts";
import type { PrismaClient } from "../generated/prisma/client.js";
import {
  AccessError, absoluteMs, completeReset, csrfFor, directory, login, logout, provision,
  resetForStaff, revokeSessions, updateStaff, withSession, type AccessMode,
} from "./service.js";

export function accessRouter(db: PrismaClient, origin: string) {
  const router = express.Router();
  const secure = new URL(origin).protocol === "https:";
  const cookieName = secure ? "__Host-oms_session" : "oms_session";
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, path: "/", secure };
  const token = (req: Request) => parseCookie(req.headers.cookie ?? "")[cookieName] ?? "";
  function authorized<T>(req: Request, mode: AccessMode, action: Parameters<typeof withSession<T>>[4]) {
    return withSession(db, token(req), req.get("X-CSRF-Token") ?? "", mode, action);
  }
  const id = (req: Request) => z.uuid().parse(req.params.id);
  const throttle = rateLimit({
    windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ code: "TRY_LATER", requestId: res.locals.requestId }),
  });

  router.use((req, _res, next) => {
    if (["POST", "PATCH"].includes(req.method)) {
      if (req.get("origin") !== origin) throw new AccessError(403, "ORIGIN_DENIED");
      if (!req.is("application/json")) throw new AccessError(415, "JSON_REQUIRED");
    }
    next();
  }, express.json({ limit: "8kb" }));

  router.post("/auth/login", throttle, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const session = await login(db, input.email, input.password, token(req));
    res.cookie(cookieName, session.token, { ...cookieOptions, maxAge: absoluteMs });
    res.json({ user: session.user, csrfToken: session.csrfToken });
  });
  router.post("/auth/reset", throttle, async (req, res) => {
    const input = passwordResetSchema.parse(req.body);
    await completeReset(db, input.code, input.password);
    res.sendStatus(204);
  });
  router.get("/auth/session", async (req, res) => {
    const user = await authorized(req, "read", async (_tx, actor) => actor);
    res.json({ user, csrfToken: csrfFor(token(req)) });
  });
  router.post("/auth/logout", async (req, res) => {
    await authorized(req, "write", (tx, user) => logout(tx, user, token(req)));
    res.clearCookie(cookieName, cookieOptions).sendStatus(204);
  });
  router.get("/admin/staff", async (req, res) => {
    res.json(await authorized(req, "adminRead", tx => {
      const page = z.coerce.number().int().min(1).max(100000).default(1).parse(req.query.page);
      return directory(tx, page);
    }));
  });
  router.post("/admin/staff", async (req, res) => {
    const created = await authorized(req, "adminWrite", (tx, actor) => {
      const input = provisionSchema.parse(req.body);
      return provision(tx, actor, input.email, input.roles);
    });
    res.status(201).json(created);
  });
  router.patch("/admin/staff/:id", async (req, res) => {
    res.json(await authorized(req, "adminWrite", (tx, actor) => {
      const input = updateStaffSchema.parse(req.body);
      return updateStaff(tx, actor, id(req), input.roles, input.active, input.version);
    }));
  });
  router.post("/admin/staff/:id/reset", async (req, res) => {
    res.json(await authorized(req, "adminWrite", (tx, actor) => resetForStaff(tx, actor, id(req))));
  });
  router.post("/admin/staff/:id/revoke", async (req, res) => {
    await authorized(req, "adminWrite", (tx, actor) => revokeSessions(tx, actor, id(req)));
    res.sendStatus(204);
  });
  return router;
}
