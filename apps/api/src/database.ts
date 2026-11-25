import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

export function connectDatabase(connectionString: string) {
  const adapter = new PrismaPg({
    connectionString,
    connectionTimeoutMillis: 2500,
    statement_timeout: 2500,
    query_timeout: 3000,
    max: 5,
  });
  return new PrismaClient({ adapter });
}
