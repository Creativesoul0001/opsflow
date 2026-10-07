# OpsFlow — Architecture (Phases 1–3)

This document explains the structural decisions behind the platform, the
Customers CRM module and the Orders module: how multi-tenancy is modelled,
where the trust boundary sits, how requests flow through the layers, and what
each folder is responsible for.

For setup instructions see the [README](../README.md).

---

## 1. Layering

Requests move strictly downward; each layer only calls the one below it.

```
  HTTP request
      │
      ▼
Route handler            src/app/api/**/route.ts
  · thin: parse → authorize → delegate → wrap response
      │
      ▼
Validation               src/lib/validation.ts
  · Zod schemas, parseOrThrow, body size ceiling
      │
      ▼
Authorization guards     src/lib/rbac/guard.ts, src/lib/tenancy.ts
  · requireSessionUser → requireMembership → assertPermission
      │
      ▼
Service                  src/lib/services/**
  · business rules; the only layer that coordinates multiple models
      │
      ▼
Prisma                   src/lib/db.ts  (lazy singleton over @prisma/adapter-pg)
      │
      ▼
PostgreSQL
```

**Why this matters:** route handlers contain no business logic and services
contain no HTTP concerns. Phase 2 (Customers) and Phase 3 (Orders) both followed
this exact path — a service under `services/` and a route handler that only
wires the layers together — which is the repeatable recipe for every future
module (§8).

---

## 2. Multi-tenancy

### The model

```
User ──< OrganizationMembership >── Organization
              │
              └── role ──< RolePermission >── Permission
```

- A `User` can belong to **many** organizations.
- `OrganizationMembership` is the join. It holds the user's `roleId` for that
  organization and is unique on `(userId, organizationId)` — one role per org.
- `Role` and `Permission` are **global reference data**, not tenant-owned, so
  role definitions stay consistent across every organization. They are seeded by
  `prisma/seed.ts` and reconciled (not accumulated) on each run.

### The trust boundary

`src/lib/tenancy.ts` is the single place where tenant scope is decided.
`requireMembership(user, organizationId)`:

1. loads the membership for `(userId, organizationId)`,
2. rejects with `AuthorizationError` if none exists,
3. rejects if the membership is not `ACTIVE`.

The `userId` always comes from the verified session — never from the request
body or a query parameter. A client-supplied `organizationId` is only ever a
_request_ for a tenant; it is checked against Postgres and, if unauthorized,
rejected. There is deliberately **no fallback to a default tenant** on a
missing or stale id, because a silent fallback is how cross-tenant leaks
happen.

### Forward compatibility for business tables

Every future business model (Customer, Order, Product, Ticket, …) **must**:

- carry a non-null `organizationId` with a foreign key to `Organization`,
- be indexed on `organizationId` (usually first in a composite index),
- be queried only through a service that has already resolved a verified
  membership,
- never be reachable by passing an id alone.

---

## 3. Authentication

- **Auth.js v5 (NextAuth)** with a Credentials provider and the **JWT** session
  strategy.
- **JWT, not database sessions,** was chosen deliberately: it requires **zero
  extra tables** (`Account`, `Session`, `VerificationToken` are not needed),
  keeping the Phase 1 schema to exactly the models the product needs.
- Because the session is stateless, authorization is **never** read from the
  token. `loadAuthorizationContext` re-reads the membership and its role's
  permissions from Postgres on every request, so revoking a membership or
  changing a role takes effect on the next request.
- **Registration** is a first-class service (`registerWithOrganization`) rather
  than an Auth.js callback, because signing up must atomically create the
  user, their first organization, and the OWNER membership. It runs in one
  interactive transaction; the bcrypt hash is computed _before_ the transaction
  so a pooled connection is not held for ~250 ms.
- **Passwords:** bcrypt, cost 12 (`src/lib/auth/password.ts`).
- The Auth.js config is built **lazily** (`getAuth()`) so importing the module —
  which Next.js does during `next build` — does not require runtime secrets.

---

## 4. Authorization (RBAC)

- The backend enforces permission checks; hiding a button is UX, never
  security.
- Permissions are `resource:action` strings defined once in
  `rbac/permissions.ts` and seeded into the database. Roles map to permission
  sets in `rbac/roles.ts`.
- Guards (`rbac/guard.ts`): `hasPermission`, `hasEveryPermission`,
  `hasSomePermission`, `assertPermission`, `assertOrganization`.
- Every protected page calls `assertPermission` server-side, so a direct URL to
  a module the member cannot access returns 403 even though the nav hides it.

### Roles

| Role       | Scope                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| `OWNER`    | Everything, including permanent organization deletion                     |
| `ADMIN`    | All but `organization:delete`                                             |
| `MANAGER`  | Day-to-day ops; no finance writes, member/role management, or settings    |
| `EMPLOYEE` | Read customers/orders/inventory + support; no destructive or admin powers |

The privilege ladder (OWNER ⊃ ADMIN ⊃ MANAGER ⊃ EMPLOYEE) is asserted in
`tests/rbac.test.ts`.

---

## 5. API conventions

- **Envelope:** success → `{ data, meta? }`; error →
  `{ error: { code, message, details? } }`. `details` is present only for
  client-safe errors.
- **Error codes** (`api/errors.ts`): `VALIDATION_FAILED`, `UNAUTHENTICATED`,
  `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `DATABASE_ERROR`,
  `INTERNAL_ERROR`. Clients branch on `code`, not on status.
- **Centralized handling:** `route(handler)` wraps every route; `toAppError`
  normalizes any thrown value (including Zod and Prisma errors) into an
  `AppError`. Non-exposed errors are logged with their cause and replaced with a
  generic message, so stack traces and SQL never reach a client.
- **Statuses:** 200 ok, 201 created, 204 no content, 400/401/403/404/409/422/429,
  500 unexpected, 503 health-down.
- Every authenticated response is sent with `cache-control: no-store`.

### Endpoints (Phase 1)

| Method   | Path                      | Auth    | Purpose                                    |
| -------- | ------------------------- | ------- | ------------------------------------------ |
| GET      | `/api/health`             | public  | Liveness/readiness; 503 if DB unreachable  |
| GET      | `/api/me`                 | session | Current user + orgs + resolved permissions |
| POST     | `/api/auth/register`      | public  | Create user + organization + OWNER (201)   |
| POST     | `/api/auth/login`         | public  | Credentials sign-in, sets session cookie   |
| POST     | `/api/auth/logout`        | public  | Invalidate session (204)                   |
| GET/POST | `/api/auth/[...nextauth]` | public  | Auth.js protocol routes (session, csrf, …) |

No placeholder endpoints were added; the foundation is intentionally minimal.
The business modules built on it, however, follow the same conventions.

### Endpoints (Customers)

| Method | Path                            | Permission         | Purpose                                 |
| ------ | ------------------------------- | ------------------ | --------------------------------------- |
| GET    | `/api/customers`                | `customers:read`   | List, search, filter, sort, paginate    |
| POST   | `/api/customers`                | `customers:create` | Create (201)                            |
| GET    | `/api/customers/:id`            | `customers:read`   | Detail incl. notes                      |
| PATCH  | `/api/customers/:id`            | `customers:update` | Edit contact / company                  |
| PATCH  | `/api/customers/:id/assignment` | `customers:assign` | Assign / unassign an active member      |
| DELETE | `/api/customers/:id`            | `customers:update` | Soft-archive with optional reason (204) |
| PATCH  | `/api/customers/:id/notes`      | `customers:update` | Append a note                           |
| GET    | `/api/customers/:id/activities` | `customers:read`   | Audit timeline                          |

### Endpoints (Orders)

| Method | Path                         | Permission      | Purpose                                              |
| ------ | ---------------------------- | --------------- | ---------------------------------------------------- |
| GET    | `/api/orders`                | `orders:read`   | List, search, filter, sort, paginate                 |
| POST   | `/api/orders`                | `orders:create` | Create; totals derived server-side (201)             |
| GET    | `/api/orders/:id`            | `orders:read`   | Detail with items, customer, assignment              |
| PATCH  | `/api/orders/:id`            | `orders:update` | Edit customer / money inputs (PENDING/CONFIRMED)     |
| DELETE | `/api/orders/:id`            | `orders:cancel` | Cancel with optional reason (204)                    |
| POST   | `/api/orders/:id/status`     | `orders:update` | Move forward one step per the workflow policy        |
| PATCH  | `/api/orders/:id/assignment` | `orders:assign` | Assign / unassign an active member                   |
| POST   | `/api/orders/:id/notes`      | `orders:update` | Append a note                                        |
| GET    | `/api/orders/:id/activities` | `orders:read`   | Audit timeline                                       |
| GET    | `/api/orders/members`        | `orders:assign` | Assignable members (declared _before_ `:id`)         |
| GET    | `/api/orders/stats`          | `orders:read`   | Dashboard counts + revenue (declared _before_ `:id`) |

### Money and workflow rules (Orders)

- Money travels as a decimal string (`"120.50"`); it is parsed to integer minor
  units and stored that way. A tax rate is stored in basis points and rendered
  as a percentage string.
- `subtotal`, `tax` and `total` are **outputs of `computeOrderTotals`
  (`src/lib/orders/calculation.ts`)**, never client inputs — the schemas reject
  them outright, so a payload cannot claim totals that disagree with its lines.
  All arithmetic is integer-based; the client shows a live preview from the same
  pure module.
- Order numbers are `ORD-######` sequential **per organization** (unique
  `(organizationId, sequence)`), allocated inside the create transaction.
- The status workflow is Pending → Confirmed → Processing → Shipped →
  Delivered; Cancelled is allowed from Pending/Confirmed/Processing only.
  Transitions and terminal-state immutability are enforced in the service (the
  UI only mirrors them), and both Delivered and Cancelled are final states that
  preserve the record and its history.
- Single-record lookups are `findFirst` on `(id, organizationId)` and return
  the same 404 for a missing id as for someone else's id, so existence is never
  leaked across tenants.

---

## 6. Error handling & validation

- All external input passes through Zod (`validation.ts`). Auth payloads use
  `.strict()` so an unexpected field (e.g. an attempt to smuggle `roleId`) is a
  422 rather than being silently ignored.
- Request bodies are capped (`readJsonBody`, 16 KB) and rejected before
  buffering when `content-length` is present.
- The error taxonomy is centralized; each class carries an HTTP status, a
  stable `code`, and an `expose` flag controlling what reaches the client.

---

## 7. Security

- **Tenant isolation:** enforced at the service boundary (see §2).
- **Sessions:** httpOnly, same-site cookie; short max age (8 h). Authorization
  re-checked per request, so a leaked-but-valid token is limited to the read
  scope its user actually still has.
- **Passwords:** bcrypt cost 12; never logged; timing-equalized login (a
  dummy hash is compared when the user is unknown to reduce enumeration).
- **Injection:** Prisma parameterizes queries; SQL injection is not possible.
- **Headers:** `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS (see `next.config.ts`). CSP is deferred to a
  nonce-based policy in Phase 2 rather than shipped with `unsafe-inline`.
- **Rate limiting:** fixed-window limiter with a pluggable `RateLimitStore`
  (in-memory today, Redis-ready). Auth endpoints are limited by client IP.
- **Secrets:** only `.env` holds them; it is git-ignored. `AUTH_SECRET` must be
  ≥32 chars. TLS verification is never disabled.

---

## 8. Extending with a new module

Adding a module is a bounded, repeatable set of steps, proven by Customers
(Phase 2) and Orders (Phase 3):

1. **Prisma:** add the model(s) with `organizationId` FK + index.
2. **RBAC:** reuse existing permission keys (the full vocabulary is already
   seeded) or add a key in `rbac/permissions.ts` and re-run `db:seed`.
3. **Service:** `src/lib/services/<module>.service.ts`, always taking a verified
   `organizationId`.
4. **API:** `src/app/api/<module>/route.ts` using `route(...)`, `parseOrThrow`,
   and the guards.
5. **UI:** flip `status` to `'available'` for the entry in `modules.ts` and
   replace the placeholder page with the real one; the sidebar updates itself.

The module registry (`src/lib/modules.ts`) is the single source of truth for
navigation, phase status, and the permission required to see a module.

---

## 9. Key trade-offs

| Decision                      | Rationale                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| JWT sessions (no DB sessions) | Keeps the schema to the essential 5 models; costs immediate-revocation, mitigated by per-request re-check |
| Registration as a service     | Needs a multi-model transaction Auth.js callbacks can't express                                           |
| Lazy Prisma / Auth.js init    | `next build` must not need a database or runtime secrets                                                  |
| In-memory rate limiter        | Adequate for Phase 1; store interface is the Redis seam                                                   |
| Permission keys, not roles    | Feature code checks stable `resource:action` keys; roles stay data                                        |
