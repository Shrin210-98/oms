import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import type { Readiness } from "@oms/contracts";

export function createApp(checkDatabase: () => Promise<void>, logger: Logger) {
  const app = express();
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.locals.requestId = requestId;
    res.set({ "X-Request-Id": requestId, "Cache-Control": "no-store" });
    const started = performance.now();
    res.on("finish", () => {
      logger.info({
        requestId, method: req.method, path: req.path,
        status: res.statusCode, durationMs: Math.round(performance.now() - started),
      }, "Request completed");
    });
    next();
  });

  app.get("/api/v1/health/live", (_req, res) => {
    res.json({ status: "alive" });
  });

  app.get("/api/v1/health/ready", async (_req, res) => {
    let status: Readiness["status"] = "ready";
    try {
      await checkDatabase();
    } catch {
      status = "unavailable";
      logger.warn({ requestId: res.locals.requestId }, "Database readiness check failed");
    }
    const result: Readiness = {
      status, checkedAt: new Date().toISOString(), requestId: res.locals.requestId,
    };
    res.status(status === "ready" ? 200 : 503).json(result);
  });

  app.use((_req, res) => {
    res.status(404).json({ code: "NOT_FOUND", requestId: res.locals.requestId });
  });

  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    logger.error({ requestId: res.locals.requestId }, "Unexpected request failure");
    res.status(500).json({ code: "INTERNAL_ERROR", requestId: res.locals.requestId });
  };
  app.use(handleError);
  return app;
}
