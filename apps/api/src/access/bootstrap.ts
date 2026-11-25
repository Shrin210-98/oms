import { emailSchema } from "@oms/contracts";
import { connectDatabase } from "../database.js";
import { AccessError, bootstrap } from "./service.js";

const email = emailSchema.safeParse(process.argv[2]);
if (!process.stdout.isTTY || !email.success || !process.env.DATABASE_URL) {
  console.error("Use an interactive terminal with DATABASE_URL configured: npm run staff:bootstrap -- admin@example.test");
  process.exit(1);
}
const db = connectDatabase(process.env.DATABASE_URL);
try {
  const issued = await bootstrap(db, email.data);
  console.log("Open /recover and enter this private setup code before", issued.expiresAt);
  console.log(issued.code);
} catch (error) {
  console.error(error instanceof AccessError ? error.code : "Could not initialize staff access. Check database connectivity and migrations.");
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
