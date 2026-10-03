# OpsFlow

**Phase 1 — platform foundation.**

OpsFlow is a multi-tenant business operations SaaS: a single platform for
managing customers, orders, inventory, support, finance, analytics and
automation, with every record scoped to the organization that owns it.

This repository currently contains **Phase 1 only**: the production-grade
foundation — database schema, authentication, role-based authorization,
a consistent REST API, an application shell and the test/lint/build
toolchain. The business modules are intentionally _not_ implemented yet.

---

## Technology stack

| Concern          | Choice                                             |
| ---------------- | -------------------------------------------------- |
| Framework        | Next.js 16 (App Router, React 19, Turbopack)       |
| Language         | TypeScript 5.9 (`strict`)                          |
| Styling          | Tailwind CSS 4 (CSS-first `@theme` tokens)         |
| Database         | PostgreSQL 17                                      |
| ORM              | Prisma 7 (`prisma-client` generator, `pg` adapter) |
| Validation       | Zod 4                                              |
| Auth             | Auth.js v5 (NextAuth), Credentials + JWT sessions  |
| Password hashing | bcrypt (cost 12)                                   |
| Unit tests       | Vitest 5                                           |
| E2E tests        | Playwright                                         |
| Lint / format    | ESLint 10 (type-aware) + Prettier 3                |
| Local infra      | Docker Compose (Postgres + Redis)                  |

---

## Architecture overview

```
Browser
  │
  ▼
Next.js App Router
  ├─ (auth)  /login  /register          → public, REST-backed auth forms
  ├─ (app)   /dashboard + module pages  → server-rendered, session required
  └─ api/    /api/health /api/me /api/auth/*
        │
        ▼
Route handlers (thin)                     src/app/api/**
        │  parseOrThrow(Zod) → requireSession → requireMembership → assertPermission
        ▼
Services                                  src/lib/services/**
        │  business rules; the only layer that touches multiple models
        ▼
Prisma                                    src/lib/db.ts  (lazy singleton)
        ▼
PostgreSQL
```

Cross-cutting concerns live in `src/lib`:

- **auth** — Auth.js config, password hashing, session helpers
- **rbac** — permission catalogue, role definitions, guards
- **tenancy** — membership resolution (the tenant trust boundary)
- **api** — error taxonomy, response envelopes, route wrapper
- **validation** — Zod schemas + `parseOrThrow`
- **rate-limit** — fixed-window limiter with a pluggable store
- **modules** — module registry (nav, phase status, permissions)

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the fuller picture,
including the multi-tenancy model and request flow.

---

## Folder structure

```
.
├── prisma/
│   ├── migrations/            # committed SQL migrations
│   ├── schema.prisma          # User, Organization, Membership, Role, Permission
│   └── seed.ts                # idempotent permissions + roles seed
├── src/
│   ├── app/
│   │   ├── (auth)/            # /login, /register  (public)
│   │   ├── (app)/             # /dashboard + module pages (protected)
│   │   └── api/               # REST route handlers
│   ├── components/
│   │   ├── ui/                # Button, Card, Field, Alert, Spinner, states
│   │   ├── layout/            # AppShell, SidebarNav, UserMenu
│   │   ├── auth/              # login/register forms
│   │   ├── dashboard/         # StatCard, TrendPanel
│   │   └── module/            # shared "coming soon" placeholder
│   ├── generated/prisma/      # Prisma client (git-ignored, generated)
│   └── lib/
│       ├── api/               # errors.ts, responses.ts
│       ├── auth/              # config.ts, password.ts, session.ts
│       ├── client/            # client fetch helper + ApiRequestError
│       ├── rbac/              # permissions.ts, roles.ts, guard.ts
│       ├── services/          # auth.service.ts, organization.service.ts
│       ├── db.ts  env.ts  logger.ts  modules.ts  rate-limit.ts  validation.ts
│       └── tenancy.ts         # membership/authorization resolution
├── tests/
│   ├── *.test.ts              # Vitest unit/integration tests
│   ├── e2e/                   # Playwright specs
│   └── stubs/server-only.ts   # inert server-only for unit tests
├── docs/ARCHITECTURE.md
├── docker-compose.yml         # Postgres + Redis for local dev
├── .env.example               # copy to .env; never commit .env
```

---

## Local setup

### Prerequisites

- Node.js **>= 20.19** (developed on 24)
- Docker Desktop (for the local Postgres/Redis) — _or_ any reachable Postgres
- npm 10+

### 1. Install dependencies

```bash
npm install
```

### 2. Start infrastructure

```bash
docker compose up -d
```

This starts Postgres on `localhost:5432` and Redis on `localhost:6379`.

> Redis is provisioned for **future** background jobs; nothing in Phase 1 reads it.

### 3. Configure environment

```bash
cp .env.example .env
# Generate a real auth secret and paste it into AUTH_SECRET:
openssl rand -base64 32
```

`.env` is git-ignored. **Never commit real secrets.**

### 4. Create the database schema

```bash
npm run db:migrate     # applies prisma/migrations to your database
npm run db:seed        # idempotent: seeds permissions + the 4 roles
```

### 5. Run the app

```bash
npm run dev            # http://localhost:3000
```

Open <http://localhost:3000/register>, create an account (this also creates your
first organization and makes you its **OWNER**), then sign in.

---

## Environment variables

| Variable                  | Required | Default                 | Purpose                                               |
| ------------------------- | -------- | ----------------------- | ----------------------------------------------------- |
| `DATABASE_URL`            | yes      | —                       | PostgreSQL connection string                          |
| `AUTH_SECRET`             | yes      | —                       | ≥32-char secret that signs session JWTs               |
| `AUTH_TRUST_HOST`         | no       | `true`                  | Validate the Host header (keep `true` behind a proxy) |
| `APP_URL`                 | no       | `http://localhost:3000` | Server-side app origin                                |
| `NEXT_PUBLIC_APP_NAME`    | no       | `OpsFlow`               | Display name                                          |
| `NEXT_PUBLIC_APP_URL`     | no       | `http://localhost:3000` | Public app URL                                        |
| `LOG_LEVEL`               | no       | `info`                  | `debug`/`info`/`warn`/`error`/`silent`                |
| `RATE_LIMIT_ENABLED`      | no       | `true`                  | Toggle request rate limiting                          |
| `RATE_LIMIT_MAX_ATTEMPTS` | no       | `10`                    | Attempts per window                                   |
| `RATE_LIMIT_WINDOW_MS`    | no       | `60000`                 | Window size in ms                                     |
| `REDIS_URL`               | no       | —                       | Reserved for Phase 2; unused in Phase 1               |

Environment is validated with Zod on first access (`src/lib/env.ts`); invalid or
missing required values fail fast with a clear message.

---

## Database setup

Prisma 7 keeps the datasource URL in `prisma7.config.ts`, not in `schema.prisma`.

```bash
npm run db:migrate    # create/apply a dev migration
npm run db:deploy     # apply committed migrations (CI / production)
npm run db:seed       # seed permissions + roles (idempotent)
npm run db:studio     # browse data in Prisma Studio
```

### Models (Phase 1)

- **User** — `email` (unique), `passwordHash`, `status`
- **Organization** — `name`, `slug` (unique)
- **Role** — `key` (unique: OWNER/ADMIN/MANAGER/EMPLOYEE), system reference data
- **Permission** — `key` (unique: `resource:action`), system reference data
- **RolePermission** — many-to-many join between roles and permissions
- **OrganizationMembership** — ties `User ↔ Organization` with one `Role`;
  unique on `(userId, organizationId)`

IDs are UUIDv7. Timestamps use `@default(now())` / `@updatedAt` throughout.

---

## Development commands

| Command                | What it does                                  |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Start the dev server                          |
| `npm run build`        | Generate Prisma client + production build     |
| `npm start`            | Serve the production build                    |
| `npm run typecheck`    | `tsc --noEmit`                                |
| `npm run lint`         | ESLint (type-aware)                           |
| `npm run lint:fix`     | ESLint with autofix                           |
| `npm run format`       | Prettier write                                |
| `npm run format:check` | Prettier check                                |
| `npm run test`         | Vitest (unit)                                 |
| `npm run test:watch`   | Vitest watch mode                             |
| `npm run test:e2e`     | Playwright (needs a running app + database)   |
| `npm run db:migrate`   | Prisma dev migration                          |
| `npm run db:deploy`    | Prisma migrate deploy                         |
| `npm run db:seed`      | Seed roles + permissions                      |
| `npm run db:studio`    | Prisma Studio                                 |
| `npm run verify`       | typecheck + lint + test + build (the CI gate) |

---

## Testing

- **Unit / integration (Vitest)** — `tests/*.test.ts`. Covers validation,
  RBAC hierarchy + guards, organization access control, error taxonomy and
  password hashing/log-redaction. No database required; `server-only` is stubbed
  for the Node test runner.
- **E2E (Playwright)** — `tests/e2e/auth.spec.ts`. Exercises the register →
  sign-in → dashboard → sign-out flow. Requires a migrated, seeded database and
  a running app (`npm run test:e2e`). Kept out of `npm run verify` because it
  depends on external infrastructure.

```bash
npm run test         # unit tests
npm run verify       # the full gate: typecheck + lint + test + build
```

---

## Phase 1 scope (what exists)

- Multi-tenant data model (User → Membership → Organization) with future-ready
  tenant scoping
- Auth: registration (creates user + organization + OWNER atomically), login,
  logout, bcrypt hashing, JWT sessions, protected routes
- RBAC: 4 roles, 25 permissions, permission-based server-side guards
- REST foundation: `GET /api/health`, `GET /api/me`, auth endpoints, Zod
  validation, centralized errors, structured logging, rate limiting
- Application shell: responsive sidebar/topnav/user menu, loading / error /
  empty states, an honest dashboard (metrics explicitly "No data yet")
- Placeholder pages for every planned module, honestly labelled "coming soon"
- Tooling: strict TS, ESLint, Prettier, Vitest, Playwright, Docker (Postgres +
  Redis), migrations + seed

## Future phases (not implemented)

- **Phase 2** — Customers, Orders, Settings (members, roles, org profile)
- **Phase 3** — Inventory, Support, Analytics
- **Phase 4** — Finance, Automation, AI Assistant + background jobs on Redis

---

## Security notes

- Passwords are bcrypt-hashed (cost 12); plain-text is never stored or logged.
- Sessions are httpOnly-cookie JWTs; **tenant access and permissions are
  re-verified against the database on every request**, never trusted from the
  token, so revoking a membership or changing a role takes effect immediately.
- An organization id from a client is never trusted without a matching ACTIVE
  membership (`src/lib/tenancy.ts`).
- Input is validated with Zod at every boundary; auth payloads are `.strict()`.
- Prisma parameterizes all queries, so SQL injection is not possible.
- Errors never leak stack traces, SQL, or driver messages to clients.
- Baseline security headers are set in `next.config.ts`.
- **TLS verification is never disabled.** `NODE_TLS_REJECT_UNAUTHORIZED` and
  `strict-ssl=false` are not used anywhere.

### Known limitations (Phase 1)

- The rate limiter is **in-memory per process** (`src/lib/rate-limit.ts`); it is
  not shared across instances. The store interface is the seam for a Redis-backed
  implementation in Phase 2.
- Prisma's CLI dependencies pull a few dev-only advisories (`mysql2`,
  `deepmerge-ts`); they are migration tooling for MySQL and are not part of the
  runtime path. OpsFlow uses PostgreSQL only.

---

## License

See [LICENSE](LICENSE) if present; otherwise all rights reserved.
