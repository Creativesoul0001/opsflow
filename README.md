# OpsFlow

**Phase 3 — Customers CRM and Orders.**

OpsFlow is a multi-tenant business operations SaaS: a single platform for
managing customers, orders, inventory, support, finance, analytics and
automation, with every record scoped to the organization that owns it.

This repository contains **Phases 1–3**: the production-grade foundation
(database schema, authentication, role-based authorization, a consistent REST
API, an application shell and the test/lint/build toolchain), the **Customers**
CRM module and the **Orders** module. Both modules are fully implemented —
every record is scoped to the owning organization, served through
permission-checked REST APIs, and presented in the shell with list, detail and
create/edit pages. The remaining modules (settings, inventory, support,
finance, analytics, automation, AI) are not implemented yet.

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
  └─ api/    /api/health /api/me /api/auth/* /api/customers/* /api/orders/*
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
│   │   └── api/               # REST route handlers (thin: parse → guard → delegate)
│   ├── components/
│   │   ├── ui/                # Button, Card, Field, Alert, Spinner, states
│   │   ├── layout/            # AppShell, SidebarNav, UserMenu
│   │   ├── auth/              # login/register forms
│   │   ├── customers/         # customer forms, tables, filters, timeline
│   │   ├── orders/            # order form, table, filters, badges, workflow
│   │   ├── dashboard/         # StatCard, TrendPanel
│   │   └── module/            # shared "coming soon" placeholder
│   ├── generated/prisma/      # Prisma client (git-ignored, generated)
│   └── lib/
│       ├── api/               # errors.ts, responses.ts
│       ├── auth/              # config.ts, password.ts, session.ts
│       ├── client/            # client fetch helper + ApiRequestError
│       ├── rbac/              # permissions.ts, roles.ts, guard.ts
│       ├── services/          # auth, organization, customer, order services
│       ├── orders/            # money, calculation, status, number, validation, query
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

### Models (currently live)

- **User** — `email` (unique), `passwordHash`, `status`
- **Organization** — `name`, `slug` (unique)
- **Role** — `key` (unique: OWNER/ADMIN/MANAGER/EMPLOYEE), system reference data
- **Permission** — `key` (unique: `resource:action`), system reference data
- **RolePermission** — many-to-many join between roles and permissions
- **OrganizationMembership** — ties `User ↔ Organization` with one `Role`;
  unique on `(userId, organizationId)`
- **Customer** — `organizationId` FK + index; contact info and a `status`
  ACTIVE/ARCHIVED; archiving is a soft-delete (with reason) so history is kept
- **Order** — `organizationId` FK + index; a per-tenant `order_sequences`
  counter, unique `(organizationId, orderNumber)` with sequential `ORD-######`
  numbers; a status lifecycle (Pending → Confirmed → Processing → Shipped →
  Delivered, or Cancelled); money stored as integer minor units and the tax rate
  in basis points; totals always derived server-side
- **OrderItem** — the line items under an order (gross, per-line discount,
  line total)
- **OrderActivity** — immutable audit timeline recording creates, edits, status
  changes, assignments, cancellations and notes

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

- **Unit / integration (Vitest)** — `tests/*.test.ts`. Covers validation, RBAC
  hierarchy + guards, tenancy boundaries, error taxonomy, password hashing and
  log redaction, plus the pure business logic (customer and order
  money/calculation/status/number/validation/query). The order and customer
  service suites run against a real Postgres; runs are serialized per file to
  keep each file on its own pooled connection (see `vitest.config.mts`).
  `server-only` is stubbed for the Node test runner.
- **E2E (Playwright)** — `tests/e2e/auth.spec.ts`, `customers.spec.ts` and
  `orders.spec.ts`. They cover the register → sign-in → dashboard → sign-out
  flow, a full customer lifecycle (create, search, edit, note, archive) and a
  full order lifecycle (create with live totals preview, assign, note,
  search/filter, workflow to delivered, cancellation) plus unauthenticated API
  refusal. Requires a migrated, seeded database and a running app
  (`npm run test:e2e`). Kept out of `npm run verify` because it depends on
  external infrastructure.

```bash
npm run test         # unit tests
npm run verify       # the full gate: typecheck + lint + test + build
```

---

## What exists (Phases 1–3)

**Phase 1 — foundation:** multi-tenant data model (User → Membership →
Organization) with tenant scoping; auth (registration, login, logout, bcrypt,
JWT sessions, protected routes); RBAC (4 roles, 25 permissions, server-side
guards); REST foundation (health/me/auth endpoints, Zod validation, centralized
errors, structured logging, rate limiting); application shell with loading /
error / empty states and an honest dashboard; tooling (strict TS, ESLint,
Prettier, Vitest, Playwright, Docker, migrations + seed).

**Phase 2 — Customers CRM:** customer CRUD with search, filter, sort and
pagination; soft archive with reason; a contact timeline (created / updated /
archived / note) and notes; an order-history card on the customer detail page.

**Phase 3 — Orders:** order create/edit with validated money inputs and totals
that are always derived server-side; per-organization sequential `ORD-######`
numbers; a status workflow with two-step cancellation; assignable members and
notes along an immutable activity timeline; a list with search/filter/sort and
pagination; a detail page with the line-item table and totals; and dashboard
order statistics (total, pending, processing, delivered, cancelled, value).

## Future phases (not implemented)

- **Settings** — members, roles, organization profile
- **Inventory, Support, Finance, Analytics, Automation, AI Assistant**
  (background jobs will use Redis)

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
