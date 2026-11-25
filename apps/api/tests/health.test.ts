import { pino } from "pino";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { readinessSchema } from "@oms/contracts";
import { createApp } from "../src/app.js";

const logger = pino({ enabled: false });

describe("health endpoints", () => {
  it("reports readiness after the awaited database query and correlates the response with its log", async () => {
    const check = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp(check, logger)).get("/api/v1/health/ready").expect(200);
    const result = readinessSchema.parse(response.body);
    expect(result.status).toBe("ready");
    expect(result.requestId).toBe(response.headers["x-request-id"]);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(check).toHaveBeenCalledOnce();
  });

  it("stays live during a database outage and recovers on the next successful query", async () => {
    const check = vi.fn().mockRejectedValueOnce(new Error("private driver diagnostics")).mockResolvedValue(undefined);
    const api = request(createApp(check, logger));
    await api.get("/api/v1/health/live").expect(200, { status: "alive" });
    expect(check).not.toHaveBeenCalled();
    const failed = await api.get("/api/v1/health/ready").expect(503);
    expect(readinessSchema.parse(failed.body).status).toBe("unavailable");
    expect(failed.text).not.toContain("private driver diagnostics");
    await api.get("/api/v1/health/ready").expect(200);
  });

  it("returns a JSON 404 for an unknown route", async () => {
    const response = await request(createApp(async () => {}, logger)).get("/api/v1/missing").expect(404);
    expect(response.body.code).toBe("NOT_FOUND");
  });
});
