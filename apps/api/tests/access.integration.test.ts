import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { pino } from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { connectDatabase } from "../src/database.js";
import { accessRouter } from "../src/access/router.js";
import { bootstrap, completeReset, idleMs } from "../src/access/service.js";
import { issuedCodeSchema, sessionSchema, staffSchema } from "@oms/contracts";

const base = process.env.TEST_DATABASE_URL;
if (!base) throw new Error("Set TEST_DATABASE_URL to a PostgreSQL instance that permits creating temporary test databases.");
const databaseName = "oms_access_" + randomBytes(10).toString("hex");
const url = new URL(base);
url.pathname = "/" + databaseName;
const control = connectDatabase(base);
const db = connectDatabase(url.href);
const origin = "http://127.0.0.1:5173";
const adminEmail = "admin@example.test";
const password = randomBytes(24).toString("hex");
const prefix = "/api/v1";
let created = false;

function http(site = origin) {
  return request(createApp(async () => {}, pino({ enabled: false }), accessRouter(db, site)));
}
type Client = ReturnType<typeof http>;

async function signIn(api: Client, email = adminEmail, site = origin) {
  const response = await api.post(prefix + "/auth/login").set("Origin", site).send({ email, password }).expect(200);
  const session = sessionSchema.parse(response.body);
  const rawCookie = String(response.headers["set-cookie"]?.[0]);
  const cookie = rawCookie.split(";")[0]!;
  return { session, cookie, rawCookie, headers: { Cookie: cookie, Origin: site, "X-CSRF-Token": session.csrfToken } };
}

async function addStaff(api: Client, admin: Awaited<ReturnType<typeof signIn>>) {
  const email = randomUUID() + "@example.test";
  const response = await api.post(prefix + "/admin/staff").set(admin.headers).send({ email, roles: ["Sales"] }).expect(201);
  const user = staffSchema.parse(response.body.user);
  const { code } = issuedCodeSchema.parse(response.body);
  const setPassword = () => api.post(prefix + "/auth/reset").set("Origin", origin).send({ code, password });
  return { user, code, setPassword };
}

beforeAll(async () => {
  await control.$executeRawUnsafe('CREATE DATABASE "' + databaseName + '"');
  created = true;
  execFileSync("prisma", ["migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url.href }, stdio: "pipe",
  });
  const first = await bootstrap(db, adminEmail);
  const second = await bootstrap(db, adminEmail);
  await expect(completeReset(db, first.code, password)).rejects.toMatchObject({ code: "INVALID_RESET" });
  await completeReset(db, second.code, password);
}, 30000);

afterAll(async () => {
  await db.$disconnect();
  if (created) await control.$executeRawUnsafe('DROP DATABASE "' + databaseName + '"');
  await control.$disconnect();
});

describe("staff access over HTTP and PostgreSQL", () => {
  it("closes bootstrap, rotates session tokens on login, and clears the cookie on logout", async () => {
    await expect(bootstrap(db, adminEmail)).rejects.toMatchObject({ code: "BOOTSTRAP_CLOSED" });
    const api = http();
    const admin = await signIn(api);
    expect(admin.rawCookie).toContain("HttpOnly");
    expect(admin.rawCookie).toContain("SameSite=Lax");
    const again = await api.post(prefix + "/auth/login").set(admin.headers).send({ email: adminEmail.toUpperCase(), password }).expect(200);
    expect(Object.keys(again.body.user).sort()).toEqual(["active", "email", "id", "roles", "version"]);
    const newCookie = String(again.headers["set-cookie"]?.[0]).split(";")[0]!;
    expect(newCookie).not.toEqual(admin.cookie);
    await api.get(prefix + "/auth/session").set("Cookie", admin.cookie).expect(401);
    const leave = await api.post(prefix + "/auth/logout").set({
      Origin: origin, Cookie: newCookie, "X-CSRF-Token": again.body.csrfToken,
    }).send({}).expect(204);
    expect(leave.headers["set-cookie"]?.[0]).toMatch(/Expires=Thu, 01 Jan 1970/);
    await api.get(prefix + "/auth/session").set("Cookie", newCookie).expect(401);
    const https = "https://oms.example.test";
    const secure = await signIn(http(https), adminEmail, https);
    expect(secure.rawCookie).toMatch(/^__Host-oms_session=/);
    expect(secure.rawCookie).toContain("Secure");
  });

  it("checks origin, CSRF, authentication and permissions and keeps the acting admin enabled", async () => {
    const api = http();
    const admin = await signIn(api);
    const resource = prefix + "/admin/staff";
    await api.get(resource).expect(401);
    await api.post(prefix + "/auth/login").send({ email: adminEmail, password }).expect(403);
    await api.post(prefix + "/auth/login").set("Origin", origin).type("form").send({ email: adminEmail, password }).expect(415);
    const input = { email: "someone@example.test", roles: ["Sales"] };
    await api.post(resource).set({ Cookie: admin.cookie, Origin: origin }).send(input).expect(403);
    await api.post(resource).set({ ...admin.headers, Origin: "https://different.example.test" }).send(input).expect(403);
    await api.patch(resource + "/" + admin.session.user.id).set(admin.headers).send({ active: false, roles: ["Sales"], version: 1 }).expect(409);
    const staff = await addStaff(api, admin);
    await staff.setPassword().expect(204);
    const sales = await signIn(api, staff.user.email);
    await api.get(resource).set(sales.headers).expect(403);
    await api.post(resource).set(sales.headers).send(input).expect(403);
    await api.post(resource).set(admin.headers).send({ email: staff.user.email.toUpperCase(), roles: ["Finance"] }).expect(409);
  });

  it("atomically consumes a reset, invalidates prior credentials, and rejects expired codes", async () => {
    const api = http();
    const admin = await signIn(api);
    const staff = await addStaff(api, admin);
    const attempts = await Promise.all([staff.setPassword(), staff.setPassword()]);
    expect(attempts.map(r => r.status).sort()).toEqual([204, 400]);
    const stored = await db.staffUser.findUniqueOrThrow({ where: { id: staff.user.id } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    const sales = await signIn(api, staff.user.email);
    const reset = await api.post(prefix + "/admin/staff/" + staff.user.id + "/reset").set(admin.headers).send({}).expect(200);
    const saved = await db.passwordReset.findUniqueOrThrow({ where: { userId: staff.user.id } });
    expect(saved.digest).not.toBe(reset.body.code);
    await api.get(prefix + "/auth/session").set(sales.headers).expect(401);
    await api.post(prefix + "/auth/login").set("Origin", origin).send({ email: staff.user.email, password }).expect(401);
    await db.passwordReset.update({ where: { userId: staff.user.id }, data: { expiresAt: new Date(0) } });
    await api.post(prefix + "/auth/reset").set("Origin", origin).send({ code: reset.body.code, password }).expect(400);
  });

  it("enforces versioned role changes, revocation, and disablement for existing sessions", async () => {
    const api = http();
    const admin = await signIn(api);
    const staff = await addStaff(api, admin);
    await staff.setPassword().expect(204);
    const path = prefix + "/admin/staff/" + staff.user.id;
    const old = await signIn(api, staff.user.email);
    const edit = { roles: ["Finance", "Manager"], active: true, version: 1 };
    await api.patch(path).set(admin.headers).send(edit).expect(200);
    await api.patch(path).set(admin.headers).send(edit).expect(409);
    await api.get(prefix + "/auth/session").set(old.headers).expect(401);
    const current = await signIn(api, staff.user.email);
    expect(current.session.user.roles).toEqual(["Finance", "Manager"]);
    await api.post(path + "/revoke").set(admin.headers).send({}).expect(204);
    await api.get(prefix + "/auth/session").set(current.headers).expect(401);
    const last = await signIn(api, staff.user.email);
    await api.patch(path).set(admin.headers).send({ ...edit, active: false, version: 2 }).expect(200);
    await api.get(prefix + "/auth/session").set(last.headers).expect(401);
    await api.post(path + "/reset").set(admin.headers).send({}).expect(409);
    await api.post(prefix + "/auth/login").set("Origin", origin).send({ email: staff.user.email, password }).expect(401);
    const actions = await db.accessEvent.findMany({ where: { actorId: admin.session.user.id, subjectId: staff.user.id } });
    expect(actions.map(entry => entry.action)).toContain("SESSIONS_REVOKED");
  });

  it("enforces idle and absolute expiry and throttles repeated requests", async () => {
    const api = http();
    const admin = await signIn(api);
    await db.staffSession.updateMany({ where: { userId: admin.session.user.id }, data: { lastSeenAt: new Date(Date.now() - idleMs) } });
    await api.get(prefix + "/auth/session").set(admin.headers).expect(401);
    const fresh = await signIn(api);
    await db.staffSession.updateMany({ where: { userId: admin.session.user.id }, data: { expiresAt: new Date(0) } });
    await api.get(prefix + "/auth/session").set(fresh.headers).expect(401);
    const limited = http();
    for (let attempt = 0; attempt < 30; attempt++) {
      await limited.post(prefix + "/auth/login").set("Origin", origin).send({}).expect(400);
    }
    await limited.post(prefix + "/auth/reset").set("Origin", origin).send({}).expect(429);
  });
});
