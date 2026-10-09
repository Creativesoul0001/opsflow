# OpsFlow — Architecture (Phases 1–4)

This document explains the structural decisions behind the platform and the
Customers, Orders and Inventory modules: how multi-tenancy is modelled, where the
trust boundary sits, how requests flow through the layers, and what each folder
is responsible for.

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
contain no HTTP concerns. Phase 2 (Customers), Phase 3 (Orders) and Phase 4
(Inventory) all followed this exact path — a service under `services/` and a
route handler that only wires the layers together — which is the repeatable
recipe for every future module (§8).

### The Inventory module's extra layer

Inventory adds one module the earlier phases did not need: a pure library layer
(`src/lib/inventory/`) holding the rules that decide _what a legal stock change
is_. `validation.ts` parses and narrows input, `query.ts` builds tenant-scoped
`where` clauses, and `stock-levels.ts` performs the "summed quantity against the
product's own threshold" comparison that Prisma cannot express. None of them
imports the database client, so they are unit tested against a real Postgres
only where a database is unavoidable.

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

| Role       | Scope                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| `OWNER`    | Everything, including permanent organization deletion                  |
| `ADMIN`    | All but `organization:delete`                                          |
| `MANAGER`  | Day-to-day ops; no finance writes, member/role management, or settings |
| `EMPLOYEE` | Read customers/orders/inventory, adjust stock, handle support          |

The privilege ladder (OWNER ⊃ ADMIN ⊃ MANAGER ⊃ EMPLOYEE) is asserted in
`tests/rbac.test.ts`.

### Inventory permissions (Phase 4)

The coarse `inventory:read` / `inventory:write` pair Phase 1 reserved was split
when the module was actually built, for the same reason CRM split
`customers:write` into `create`/`update`/`archive`: a member who may correct a
quantity is not necessarily one who may move stock between warehouses, and
certainly not one who may retire the catalogue.

| Key                          | Grants                                     |
| ---------------------------- | ------------------------------------------ |
| `inventory:read`             | See products, stock, warehouses, movements |
| `inventory:product:create`   | Add catalogue entries and categories       |
| `inventory:product:update`   | Edit catalogue entries and categories      |
| `inventory:product:archive`  | Archive products                           |
| `inventory:category:manage`  | Create, rename, archive categories         |
| `inventory:warehouse:manage` | Create, edit, promote, archive warehouses  |
| `inventory:stock:adjust`     | Receipts and signed adjustments            |
| `inventory:stock:transfer`   | Move stock between warehouses              |

`MANAGER` holds everything except `product:archive`; `EMPLOYEE` holds `read` and
`stock:adjust` only. The seed script reconciles these keys idempotently and
prunes anything no longer in `PERMISSION_CATALOG`.

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

### Endpoints (Inventory)

| Method | Path                       | Permission                   | Purpose                                  |
| ------ | -------------------------- | ---------------------------- | ---------------------------------------- |
| GET    | `/api/products`            | `inventory:read`             | List, search, filter, sort, paginate     |
| POST   | `/api/products`            | `inventory:product:create`   | Create a catalogue entry                 |
| GET    | `/api/products/:id`        | `inventory:read`             | Detail with per-warehouse balances       |
| PATCH  | `/api/products/:id`        | `inventory:product:update`   | Edit catalogue fields                    |
| DELETE | `/api/products/:id`        | `inventory:product:archive`  | Archive (never delete)                   |
| GET    | `/api/categories`          | `inventory:read`             | The organization's categories            |
| POST   | `/api/categories`          | `inventory:category:manage`  | Create a grouping                        |
| PATCH  | `/api/categories/:id`      | `inventory:category:manage`  | Rename or re-describe                    |
| DELETE | `/api/categories/:id`      | `inventory:category:manage`  | Archive (products become uncategorised)  |
| GET    | `/api/warehouses`          | `inventory:read`             | List with unit totals                    |
| POST   | `/api/warehouses`          | `inventory:warehouse:manage` | Create; first becomes primary            |
| GET    | `/api/warehouses/:id`      | `inventory:read`             | Detail with held stock                   |
| PATCH  | `/api/warehouses/:id`      | `inventory:warehouse:manage` | Edit, or promote to primary              |
| DELETE | `/api/warehouses/:id`      | `inventory:warehouse:manage` | Archive                                  |
| POST   | `/api/stock/receipts`      | `inventory:stock:adjust`     | Record stock arriving (positive only)    |
| POST   | `/api/stock/adjustments`   | `inventory:stock:adjust`     | Signed correction; reason mandatory      |
| POST   | `/api/stock/transfers`     | `inventory:stock:transfer`   | Move between two warehouses              |
| GET    | `/api/stock/movements`     | `inventory:read`             | The stock ledger, filtered and paginated |
| GET    | `/api/inventory/stats`     | `inventory:read`             | Dashboard counts                         |
| GET    | `/api/inventory/low-stock` | `inventory:read`             | The reorder report                       |

`/api/products` and `/api/warehouses` have no `:id` variant of their own beyond
`[id]/route.ts`, and no static segment (such as `/api/products/low-stock`) exists
below a dynamic `[id]`, so route matching never has to guess.

### Stock movement rules

- **Every change is recorded.** No balance moves without a `StockMovement` row in
  the same transaction. `quantityBefore` and `quantityAfter` make the ledger
  replayable: the first movement's `quantityBefore` plus every `quantity`
  reproduces the current balance.
- **Rows are locked before they are written.** `SELECT ... FOR UPDATE` on the
  product row first, then on its stock rows, always taken in the same order. Two
  simultaneous adjustments therefore serialize instead of both reading the same
  starting quantity and losing one write. This is the reason a second adjustment
  during a race cannot silently drop.
- **Balances never go negative.** The check runs before the movement is written,
  so the member sees a field-level error; the database's own `CHECK
(quantity >= 0)` is the backstop beneath it.
- **Transfers are two rows, one transaction.** `TRANSFER_OUT` and `TRANSFER_IN`
  commit together, so an organization's total stock is conserved and neither
  side can exist without the other.
- **Receipts are positive; adjustments may be negative.** A receipt with a
  negative quantity would let a sign mistake silently destroy stock, so the
  correction path is an adjustment with a mandatory reason on the ledger.

### Order ↔ inventory policy

| Event                                  | Stock effect                                         |
| -------------------------------------- | ---------------------------------------------------- |
| Order created                          | none — a commitment, units are still on hand         |
| Order edited (PENDING/CONFIRMED)       | none — deduction happens on confirmation, once       |
| Order **CONFIRMED**                    | deducted, primary warehouse first, then the fullest  |
| Confirmation with insufficient stock   | order stays PENDING; nothing moves (one transaction) |
| Order **CANCELLED** after confirmation | exactly what was deducted is released                |
| Order **CANCELLED** while PENDING      | nothing to release — no movement                     |
| PROCESSING / SHIPPED / DELIVERED       | none — fulfilment tracking only                      |

Both effects are **idempotent**: a retried confirmation writes no second
`ORDER_DEDUCTION`, a retried cancellation writes no second `ORDER_RELEASE`. The
`deductOrderStock` / `releaseOrderStock` functions check for an existing movement
first, and two partial unique indexes — `(orderId, productId, warehouseId, type)`
and `(transferId, productId, warehouseId, type)` — enforce it at the database
level, where a NULL in the leading column never conflicts with another NULL and
so leaves receipts and manual adjustments unlimited.

Both effects run **inside the order's own transaction** (`changeOrderStatus`,
`cancelOrder`), so a confirmation that fails on insufficient stock rolls the
status change back with it and leaves the order exactly as it was. The caller
needs `orders:update` (or `orders:cancel`); it does not need any inventory
permission, because the deduction is a consequence of the order workflow rather
than a separate inventory action.

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
