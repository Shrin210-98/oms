# OMS

A learning-first B2B order management system for a furniture wholesaler. The current release includes service readiness and staff access management. The planned commercial workflow follows a hotel's order for 50 chairs, 20 desks and 10 cabinets.

## Run locally

Use Linux, Node.js **24.22.3** with its bundled npm, Docker Engine and the Docker Compose plugin. Run the commands from the repository root. With nvm, `nvm install` and `nvm use` select the version in `.nvmrc`.

```sh
cp .env.example .env
```

Choose a local URL-safe password and replace the placeholder in both entries in `.env`. Compose uses `POSTGRES_PASSWORD` when it initializes an empty volume. Prisma reads `DATABASE_URL` to connect. Keep the values in sync. Existing volumes retain the password chosen at initialization.

```sh
npm ci
npm run setup
docker compose up -d --wait db
npm run db:migrate
```

Open two terminals at the repository root.

| Terminal | Command | Purpose |
|---|---|---|
| API | `npm run dev:api` | Express listens on loopback port 3001 and reloads source changes. |
| Web | `npm run dev:web` | Vite serves React on loopback port 5173 and proxies requests under `/api` to Express. |

Open **http://127.0.0.1:5173**. The page shows the result of a fresh database read, the check time and a request ID. Match the ID to the API terminal. All three services run on the same computer. Docker publishes PostgreSQL only on loopback port 5432.

## Sign in and administer staff

After applying the migrations, run the following in a private interactive terminal. Choose an email under `example.test` for the synthetic account.

```sh
npm run staff:bootstrap -- admin@example.test
```

Open **http://127.0.0.1:5173/recover**, enter the displayed code, and choose a password of 15–128 characters. Sign in and open **Staff administration**. Before first activation, repeating bootstrap for the same address replaces the code. Activation closes bootstrap. Provision a second administrator so that either administrator can help the other recover access.

Administrators create accounts, assign one or more roles, enable or disable staff, revoke sessions and issue recovery codes. Deliver each code privately. The recipient uses the same recovery page to choose their password. Each code lasts 15 minutes and works once. Issuing a replacement immediately invalidates the previous password, code and sessions. An administrator needs a second administrator to change their own access.

Use the exact address in `APP_ORIGIN` when opening the site. State-changing endpoints check that browser origin. Production mode requires an HTTPS origin. Development uses a loopback HTTP cookie. See the [staff access guide](docs/staff-access.md) for the HTTP contract, trade-offs, exercise and SQL walkthrough.

## Trace the request

```mermaid
sequenceDiagram
  participant UI as React
  participant V as Vite proxy
  participant A as Express
  participant DB as PostgreSQL
  UI->>V: GET /api/v1/health/ready
  V->>A: Forward request
  A->>DB: Prisma reads supplier_profile
  DB-->>A: Query result
  A-->>V: JSON with status, check time and request ID
  V-->>UI: HTTP 200 or 503
```

The React effect synchronizes the status page with an external service on mount and on **Check again**. Cleanup aborts obsolete fetches. The shared Zod schema checks the network response at runtime. The UI derives its labels from one check result.

Express middleware creates a request ID before routing and logs the final status and elapsed time when the response finishes. The readiness handler awaits reads against the supplier and staff tables. While PostgreSQL processes them, Node can serve another request. Successful reads return HTTP 200 even if the tables are empty. A missing table or failed connection returns HTTP 503 with a request ID. The liveness endpoint responds independently of PostgreSQL.

| Request | Meaning |
|---|---|
| `GET /api/v1/health/live` | Express is serving requests. |
| `GET /api/v1/health/ready` | Express can read the schema installed by the initial migration. |
| Unknown API route | JSON 404 carrying the request ID. |

## Exercise and acceptance check

1. Open the browser Network panel, select **Check again**, and match the `X-Request-Id` response header to the page and the API log.
2. Run the following sequence with the API and web terminals still running. Refresh the page after each database state change. Observe that the API can be reachable while the database is unavailable.

```sh
node scripts/check-readiness.mjs ready
docker compose stop db
node scripts/check-readiness.mjs unavailable
docker compose start --wait db
node scripts/check-readiness.mjs ready
```

3. Read the first migration and predict how the primary key and check constraint enforce one seller. Open a SQL session with `docker compose exec db psql -U oms -d oms` and run the equivalent of the readiness query.

```sql
SELECT id FROM supplier_profile LIMIT 1;
```

4. Place a breakpoint on `await checkDatabase()` in `apps/api/src/app.ts` using a VS Code JavaScript Debug Terminal running `npm run dev:api`. Step into the Prisma call. Explain why the browser still needs runtime validation when both workspaces use TypeScript.

**Interview question.** What happens to the Node.js event loop while a request awaits PostgreSQL, and why would a deployment check both liveness and readiness?

## Checks and project layout

```sh
npm run typecheck
npm test
npm run build
```

Run `npm run setup` after a fresh install or changes to the Prisma schema or shared contracts. It generates the Prisma client and builds the contract package. Supertest exercises the real Express routing stack with a controllable database probe. React Testing Library covers visible outage and retry behavior. CI also runs a real PostgreSQL migration, stops the database, and verifies recovery through Vite and the compiled API.

| Path | Responsibility |
|---|---|
| `apps/web` | React 19, Vite and Tailwind CSS v4. |
| `apps/api` | Express 5, Pino structured logs, Prisma ORM and committed SQL migrations. |
| `packages/contracts` | Runtime response validation and inferred TypeScript types. |
| `compose.yaml` | Local PostgreSQL 17 with a named data volume and a readiness probe. |

To run the access integration suite, set `TEST_DATABASE_URL` to a local PostgreSQL connection that can create databases, then run `npm run test:access`. The suite creates a uniquely named disposable database, applies both migrations, exercises the Express API, and removes that database. CI runs this suite as well.

Stop the API and web terminals with Ctrl+C. Use `docker compose down` to stop the database and retain its data. The next milestone introduces customer and catalogue data after review of staff access.

## Versioned releases

System status shows the product version from the root `package.json` at build time. The web and API ship together. The private workspace package versions identify internal dependencies. Read the [changelog](CHANGELOG.md) for the user-visible changes in each release.

1. Choose the next product version. During the 0.x series, use a minor bump for a feature or breaking change and a patch bump for a compatible fix. Describe any breaking change in the release notes.
2. From the root, run `npm version minor --no-git-tag-version` or `npm version patch --no-git-tag-version`. Add a matching `## X.Y.Z` entry to the changelog and run `npm run release:check -- vX.Y.Z`, substituting the actual version.
3. Run the tests and build, commit the version, lockfile and notes together, and create an annotated tag on that commit with `git tag -a vX.Y.Z -m "OMS vX.Y.Z"`.
4. When ready to publish to a configured GitHub remote, push the release commit and that specific tag. A tag push runs the full CI suite. After it passes, Actions creates a GitHub Release with the matching notes and tagged source. Running the job again accepts an existing release.

For a local rollout, check out the tagged source in a fresh directory and follow **Run locally**. Verify the version and database readiness on System status. To return to an earlier app release, run its tag against a compatible schema. Back up PostgreSQL before applying migrations. Publishing a source release and deploying it to a host are separate steps.

Licensed under the MIT License.
