import { pino } from "pino";
import { z } from "zod";
import { createApp } from "./app.js";
import { connectDatabase } from "./database.js";

const logger = pino();
const config = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
}).safeParse(process.env);
if (!config.success) {
  logger.fatal({ fields: config.error.issues.map(issue => issue.path.join(".")) }, "Invalid API configuration");
  process.exit(1);
}

const db = connectDatabase(config.data.DATABASE_URL);
const app = createApp(async () => {
  // A read against the migrated table also detects a database missing the schema.
  await db.supplierProfile.findFirst({ select: { id: true } });
}, logger);
const server = app.listen(config.data.PORT, "127.0.0.1", () => {
  logger.info({ port: config.data.PORT }, "OMS API listening");
});
function shutdown() {
  server.close(async () => {
    await db.$disconnect();
  });
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
