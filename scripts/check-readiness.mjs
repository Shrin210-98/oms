import assert from "node:assert/strict";
import { readinessSchema } from "@oms/contracts";

const expected = process.argv[2];
assert.ok(["ready", "unavailable"].includes(expected), "Pass ready or unavailable");
const base = "http://127.0.0.1:5173/api/v1/health";
const live = await fetch(`${base}/live`, { signal: AbortSignal.timeout(8000) });
assert.equal(live.status, 200);
assert.deepEqual(await live.json(), { status: "alive" });

const response = await fetch(`${base}/ready`, { signal: AbortSignal.timeout(8000) });
const result = readinessSchema.parse(await response.json());
assert.equal(response.status, expected === "ready" ? 200 : 503);
assert.equal(result.status, expected);
assert.equal(response.headers.get("x-request-id"), result.requestId);
console.log(`API alive. Database ${result.status}. Request ${result.requestId}.`);
