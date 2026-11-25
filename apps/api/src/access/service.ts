import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as argon2 from "argon2";
import type { Staff, StaffRole } from "@oms/contracts";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";

type Tx = Prisma.TransactionClient;
export const idleMs = 30 * 60_000;
export const absoluteMs = 8 * 60 * 60_000;
const resetMs = 15 * 60_000;
const hashOptions = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };
const dummyHash = argon2.hash(randomBytes(32), hashOptions);
const secret = () => randomBytes(32).toString("base64url");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const csrfFor = (token: string) => digest("oms-csrf:" + token);
const publicFields = { id: true, email: true, active: true, version: true, roles: { select: { role: true } } } as const;

function publicUser(row: Prisma.StaffUserGetPayload<{ select: typeof publicFields }>): Staff {
  return { id: row.id, email: row.email, active: row.active, version: row.version, roles: row.roles.map(entry => entry.role).sort() };
}

export class AccessError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}
const invalidLogin = () => new AccessError(401, "INVALID_LOGIN");
const invalidReset = () => new AccessError(400, "INVALID_RESET");
const signedOut = () => new AccessError(401, "SIGN_IN_REQUIRED");

async function lockUser(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM staff_user WHERE id = ${id}::uuid FOR UPDATE`;
}

// Serialize changes made by administrators before locking actor and subject rows.
async function lockAdministration(tx: Tx) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(5873102)`;
}

function audit(tx: Tx, action: string, actorId: string | null, subjectId: string) {
  return tx.accessEvent.create({ data: { action, actorId, subjectId } });
}

async function issueCode(tx: Tx, userId: string) {
  const code = secret();
  const expiresAt = new Date(Date.now() + resetMs);
  const data = { digest: digest(code), expiresAt };
  await tx.passwordReset.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  await tx.staffSession.deleteMany({ where: { userId } });
  await tx.staffUser.update({ where: { id: userId }, data: { passwordHash: null } });
  return { code, expiresAt: expiresAt.toISOString() };
}

async function createUser(tx: Tx, email: string, roles: StaffRole[]) {
  if (await tx.staffUser.findUnique({ where: { email }, select: { id: true } })) {
    throw new AccessError(409, "EMAIL_IN_USE");
  }
  return tx.staffUser.create({ data: { email, roles: { create: roles.map(role => ({ role })) } }, select: publicFields });
}

export async function bootstrap(db: PrismaClient, email: string) {
  return db.$transaction(async tx => {
    await lockAdministration(tx);
    const users = await tx.staffUser.findMany({ take: 2 });
    const first = users[0];
    if (first && (users.length !== 1 || first.email !== email || first.activatedAt || !first.active)) {
      throw new AccessError(409, "BOOTSTRAP_CLOSED");
    }
    const user = first ?? await createUser(tx, email, ["Admin"]);
    await lockUser(tx, user.id);
    // An activation could have committed while this transaction waited for the row.
    const locked = await tx.staffUser.findUniqueOrThrow({ where: { id: user.id } });
    if (locked.activatedAt) throw new AccessError(409, "BOOTSTRAP_CLOSED");
    const code = await issueCode(tx, user.id);
    await audit(tx, "ADMIN_BOOTSTRAP", null, user.id);
    return code;
  });
}

export async function login(db: PrismaClient, email: string, password: string, previous: string) {
  const candidate = await db.staffUser.findUnique({ where: { email } });
  const hash = candidate?.passwordHash ?? await dummyHash;
  const matches = await argon2.verify(hash, password);
  if (!matches || !candidate?.active || !candidate.passwordHash) throw invalidLogin();
  return db.$transaction(async tx => {
    await lockUser(tx, candidate.id);
    const user = await tx.staffUser.findUniqueOrThrow({
      where: { id: candidate.id }, select: { ...publicFields, passwordHash: true },
    });
    if (!user.active || user.passwordHash !== hash) throw invalidLogin();
    const token = secret();
    const now = new Date();
    await tx.staffSession.deleteMany({ where: { OR: [
      { digest: digest(previous) },
      { userId: user.id, expiresAt: { lte: now } },
      { userId: user.id, lastSeenAt: { lte: new Date(+now - idleMs) } },
    ] } });
    await tx.staffSession.create({ data: {
      digest: digest(token), userId: user.id, lastSeenAt: now, expiresAt: new Date(+now + absoluteMs),
    } });
    await audit(tx, "LOGIN", user.id, user.id);
    return { token, user: publicUser(user), csrfToken: csrfFor(token) };
  });
}

export async function completeReset(db: PrismaClient, code: string, password: string) {
  const key = digest(code);
  const record = await db.passwordReset.findUnique({ where: { digest: key } });
  if (!record || record.expiresAt.getTime() <= Date.now()) throw invalidReset();
  const passwordHash = await argon2.hash(password, hashOptions);
  await db.$transaction(async tx => {
    await lockUser(tx, record.userId);
    const user = await tx.staffUser.findUniqueOrThrow({ where: { id: record.userId } });
    const used = await tx.passwordReset.deleteMany({ where: { digest: key, expiresAt: { gt: new Date() } } });
    if (!user.active || used.count !== 1) throw invalidReset();
    await tx.staffUser.update({ where: { id: user.id }, data: { passwordHash, activatedAt: user.activatedAt ?? new Date() } });
    await tx.staffSession.deleteMany({ where: { userId: user.id } });
    await audit(tx, "PASSWORD_SET", user.id, user.id);
  });
}

export type AccessMode = "read" | "write" | "adminRead" | "adminWrite";
export async function withSession<T>(
  db: PrismaClient, token: string, suppliedCsrf: string, mode: AccessMode,
  action: (tx: Tx, user: Staff) => Promise<T>,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw signedOut();
  return db.$transaction(async tx => {
    if (mode === "adminWrite") await lockAdministration(tx);
    const key = digest(token);
    const session = await tx.staffSession.findUnique({ where: { digest: key } });
    if (!session) throw signedOut();
    await lockUser(tx, session.userId);
    const now = new Date();
    const touched = await tx.staffSession.updateMany({ where: {
      digest: key, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(+now - idleMs) },
    }, data: { lastSeenAt: now } });
    if (!touched.count) throw signedOut();
    const user = publicUser(await tx.staffUser.findUniqueOrThrow({ where: { id: session.userId }, select: publicFields }));
    if (!user.active) throw signedOut();
    if (mode === "write" || mode === "adminWrite") {
      const expected = Buffer.from(csrfFor(token));
      const provided = Buffer.from(suppliedCsrf);
      if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) throw new AccessError(403, "CSRF_FAILED");
    }
    if ((mode === "adminRead" || mode === "adminWrite") && !user.roles.includes("Admin")) {
      throw new AccessError(403, "FORBIDDEN");
    }
    return action(tx, user);
  });
}

export async function logout(tx: Tx, user: Staff, token: string) {
  await tx.staffSession.delete({ where: { digest: digest(token) } });
  await audit(tx, "LOGOUT", user.id, user.id);
}

export async function directory(tx: Tx, page: number) {
  const users = await tx.staffUser.findMany({ select: publicFields, orderBy: { email: "asc" }, skip: (page - 1) * 25, take: 26 });
  return { users: users.slice(0, 25).map(publicUser), hasMore: users.length > 25 };
}

export async function provision(tx: Tx, actor: Staff, email: string, roles: StaffRole[]) {
  const row = await createUser(tx, email, roles);
  const credential = await issueCode(tx, row.id);
  await audit(tx, "STAFF_CREATED", actor.id, row.id);
  return { user: publicUser(row), ...credential };
}

async function targetUser(tx: Tx, actor: Staff, id: string) {
  if (id === actor.id) throw new AccessError(409, "SELF_ADMINISTRATION");
  await lockUser(tx, id);
  const target = await tx.staffUser.findUnique({ where: { id }, select: publicFields });
  if (!target) throw new AccessError(404, "STAFF_NOT_FOUND");
  return publicUser(target);
}

export async function updateStaff(tx: Tx, actor: Staff, id: string, roles: StaffRole[], active: boolean, version: number) {
  const target = await targetUser(tx, actor, id);
  if (target.version !== version) throw new AccessError(409, "STALE_STAFF");
  await tx.roleAssignment.deleteMany({ where: { userId: id } });
  const updated = await tx.staffUser.update({ where: { id }, select: publicFields, data: {
    active, version: { increment: 1 }, roles: { create: roles.map(role => ({ role })) },
  } });
  await tx.staffSession.deleteMany({ where: { userId: id } });
  if (!active) await tx.passwordReset.deleteMany({ where: { userId: id } });
  await audit(tx, "ACCESS_UPDATED", actor.id, id);
  return publicUser(updated);
}

export async function resetForStaff(tx: Tx, actor: Staff, id: string) {
  const target = await targetUser(tx, actor, id);
  if (!target.active) throw new AccessError(409, "STAFF_DISABLED");
  const credential = await issueCode(tx, id);
  await audit(tx, "RESET_ISSUED", actor.id, id);
  return credential;
}

export async function revokeSessions(tx: Tx, actor: Staff, id: string) {
  await targetUser(tx, actor, id);
  await tx.staffSession.deleteMany({ where: { userId: id } });
  await audit(tx, "SESSIONS_REVOKED", actor.id, id);
}
