import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/lib/db';
import { AuthorizationError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import type { AuthorizationContext } from '@/lib/rbac/guard';
import {
  addCustomerNote,
  archiveCustomer,
  assignCustomer,
  createCustomer,
  getCustomer,
  getCustomerStats,
  listAssignableMembers,
  listCustomerActivities,
  listCustomers,
  updateCustomer,
} from '@/lib/services/customer.service';
import { coerceCustomerListQuery, updateCustomerSchema } from '@/lib/customers/validation';

/**
 * CRM service behaviour against a real PostgreSQL database.
 *
 * These tests exist because the highest-risk CRM claims cannot be proven without
 * one: that `mode: 'insensitive'` search actually works, that pagination happens
 * in the database, and above all that one organization cannot see or touch
 * another's customers. Mocks would assert the query I wrote, not the rows
 * Postgres returns.
 *
 * They run against a throwaway database created per run and are skipped when
 * `DATABASE_URL` is absent, so `npm run verify` stays hermetic and CI-safe.
 */

const ENABLED = Boolean(process.env.DATABASE_URL);

/** `ValidationError` keeps its per-field messages under `details.issues`. */
function fieldIssues(error: unknown): { path: string; message: string }[] {
  return (
    (error as { details?: { issues?: { path: string; message: string }[] } }).details?.issues ?? []
  );
}

describe.skipIf(!ENABLED)('customer service (database)', () => {
  const created: { organizationId: string; userId: string }[] = [];

  const OWNER = '11111111-1111-4111-8111-111111111111';
  const OTHER = '22222222-2222-4222-8222-222222222222';

  /** A context that holds every customer permission. */
  function asOwner(organizationId: string, name: string) {
    return {
      userId: randomUUID(),
      email: `${name.toLowerCase()}@example.com`,
      name,
      organizationId,
      organizationName: 'Test Org',
      roleKey: 'OWNER',
      roleName: 'Owner',
      permissions: new Set<string>(Object.values(PERMISSIONS)),
    } as AuthorizationContext;
  }

  /** A context with an explicit permission set, to test enforcement. */
  function asMember(organizationId: string, permissions: string[]) {
    return {
      userId: randomUUID(),
      email: 'member@example.com',
      name: 'Member',
      organizationId,
      organizationName: 'Test Org',
      roleKey: 'EMPLOYEE',
      roleName: 'Employee',
      permissions: new Set<string>(permissions),
    } as AuthorizationContext;
  }

  let ownerA: AuthorizationContext;
  let ownerB: AuthorizationContext;
  let memberA: AuthorizationContext;

  /** Adds a user with an ACTIVE membership in an existing organization. */
  async function addMember(
    organizationId: string,
    userId: string,
    email: string,
    name: string,
    roleKey: string,
  ) {
    await db.user.create({
      data: { id: userId, email, name, passwordHash: 'not-used-in-these-tests' },
    });

    const role = await db.role.findFirstOrThrow({ where: { key: roleKey } });
    await db.organizationMembership.create({
      data: { organizationId, userId, roleId: role.id },
    });

    return userId;
  }

  /** Creates a fresh organization with a single OWNER member. */
  async function seedOrganization(id: string, name: string, userId: string, email: string) {
    await db.organization.create({
      data: {
        id,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(0, 8)}`,
      },
    });

    return addMember(id, userId, email, 'Starter Owner', 'OWNER');
  }

  beforeAll(async () => {
    // The fixed ids below are reused across runs, so a previous interrupted run
    // must not leave rows behind. Cascades clean up the dependents.
    await db.organization.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
    await db.user.deleteMany({
      where: { email: { endsWith: '@example.com' } },
    });

    ownerA = asOwner(OWNER, 'Ada');
    ownerB = asOwner(OTHER, 'Grace');
    memberA = asMember(OWNER, [PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.CUSTOMERS_CREATE]);

    await seedOrganization(OWNER, 'Analytical Engines', ownerA.userId, ownerA.email);
    await seedOrganization(OTHER, 'Compilers Inc', ownerB.userId, ownerB.email);

    // Point the seeded users' names at the context names so activity attribution
    // reads the way a member would see it.
    await db.user.update({ where: { id: ownerA.userId }, data: { name: 'Ada' } });
    await db.user.update({ where: { id: ownerB.userId }, data: { name: 'Grace' } });

    // A genuinely limited member of org A, holding only read + create.
    await addMember(OWNER, memberA.userId, memberA.email, 'Member', 'EMPLOYEE');

    created.push({ organizationId: OWNER, userId: ownerA.userId });
    created.push({ organizationId: OTHER, userId: ownerB.userId });
  });

  afterAll(async () => {
    // Cascades remove customers, memberships and activity for these orgs.
    await db.organization.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
    await db.user.deleteMany({
      where: { id: { in: [...created.map((entry) => entry.userId), memberA.userId] } },
    });
    await db.$disconnect();
  });

  const list = (context: AuthorizationContext, overrides: Record<string, unknown> = {}) =>
    listCustomers(context, coerceCustomerListQuery(overrides));

  describe('create and read', () => {
    it('creates a customer with defaults and reads it back', async () => {
      const createdDto = await createCustomer(ownerA, {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: `ada-${randomUUID()}@example.com`,
      });

      expect(createdDto.status).toBe('ACTIVE');
      expect(createdDto.customerType).toBe('INDIVIDUAL');
      expect(createdDto.fullName).toBe('Ada Lovelace');
      expect(createdDto.archivedAt).toBeNull();

      const fetched = await getCustomer(ownerA, createdDto.id);
      expect(fetched.email).toBe(createdDto.email);
    });

    it('reports a duplicate email against the field rather than leaking the constraint', async () => {
      const email = `dupe-${randomUUID()}@example.com`;

      await createCustomer(ownerA, { firstName: 'A', lastName: 'One', email });

      // The raw Prisma message names the database constraint, which means nothing
      // to the member who typed the address.
      const error = await createCustomer(ownerA, {
        firstName: 'B',
        lastName: 'Two',
        email,
      }).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(ValidationError);
      const issues = fieldIssues(error);
      expect(issues[0]?.path).toBe('email');
      expect(issues[0]?.message).toMatch(/already used/i);
      expect(JSON.stringify(issues)).not.toContain('customers_organization_id_email_key');
    });

    it('allows the same email in a different organization', async () => {
      const email = `shared-${randomUUID()}@example.com`;

      await createCustomer(ownerA, { firstName: 'Shared', lastName: 'Email', email });
      await expect(
        createCustomer(ownerB, { firstName: 'Shared', lastName: 'Email', email }),
      ).resolves.toMatchObject({ email });
    });

    it('records a CREATED activity attributed to the actor', async () => {
      const customer = await createCustomer(ownerA, {
        firstName: 'Timed',
        lastName: 'Entry',
        email: `timed-${randomUUID()}@example.com`,
      });

      const { activities } = await listCustomerActivities(
        ownerA,
        customer.id,
        coerceCustomerListQuery({}),
      );

      expect(activities).toHaveLength(1);
      expect(activities[0]?.type).toBe('CREATED');
      expect(activities[0]?.description).toContain('Ada');
      expect(activities[0]?.user?.name).toBe('Ada');
    });
  });

  describe('tenant isolation', () => {
    it('returns 404, not 403, for another organization customer', async () => {
      const secret = await createCustomer(ownerB, {
        firstName: 'Secret',
        lastName: 'Record',
        email: `secret-${randomUUID()}@example.com`,
      });

      await expect(getCustomer(ownerA, secret.id)).rejects.toThrow(NotFoundError);
    });

    it('does not leak another organization customer through the list', async () => {
      const secret = await createCustomer(ownerB, {
        firstName: 'Hidden',
        lastName: 'Person',
        email: `hidden-${randomUUID()}@example.com`,
      });

      const { customers } = await list(ownerA, { search: 'Hidden' });

      expect(customers.map((customer) => customer.id)).not.toContain(secret.id);
      expect(JSON.stringify(customers)).not.toContain(secret.email);
    });

    it('cannot update, archive, assign or annotate another organization customer', async () => {
      const secret = await createCustomer(ownerB, {
        firstName: 'Off',
        lastName: 'Limits',
        email: `offlimits-${randomUUID()}@example.com`,
      });

      await expect(updateCustomer(ownerA, secret.id, { firstName: 'Hacked' })).rejects.toThrow(
        NotFoundError,
      );
      await expect(archiveCustomer(ownerA, secret.id)).rejects.toThrow(NotFoundError);
      await expect(assignCustomer(ownerA, secret.id, ownerA.userId)).rejects.toThrow(NotFoundError);
      await expect(addCustomerNote(ownerA, secret.id, 'not mine')).rejects.toThrow(NotFoundError);
    });

    it('cannot read another organization activity log', async () => {
      const secret = await createCustomer(ownerB, {
        firstName: 'Quiet',
        lastName: 'Log',
        email: `quiet-${randomUUID()}@example.com`,
      });

      await expect(
        listCustomerActivities(ownerA, secret.id, coerceCustomerListQuery({})),
      ).rejects.toThrow(NotFoundError);
    });

    it('keeps dashboard counts separate per organization', async () => {
      const statsA = await getCustomerStats(ownerA);
      const statsB = await getCustomerStats(ownerB);

      expect(statsA.total).toBeGreaterThan(0);
      expect(statsB.total).toBeGreaterThan(0);
      // Both suites created rows in both orgs, so equality here proves nothing;
      // the meaningful assertion is that each count reflects only its own tenant.
      expect(statsA.total).toBe(await db.customer.count({ where: { organizationId: OWNER } }));
      expect(statsB.total).toBe(await db.customer.count({ where: { organizationId: OTHER } }));
    });
  });

  describe('permissions', () => {
    it('lets a read+create member create and read', async () => {
      const customer = await createCustomer(memberA, {
        firstName: 'Limited',
        lastName: 'Member',
        email: `limited-${randomUUID()}@example.com`,
      });

      await expect(getCustomer(memberA, customer.id)).resolves.toMatchObject({ id: customer.id });
    });

    it.each([
      ['update', (id: string) => updateCustomer(memberA, id, { firstName: 'Nope' })],
      ['archive', (id: string) => archiveCustomer(memberA, id)],
      ['assign', (id: string) => assignCustomer(memberA, id, memberA.userId)],
    ])('refuses %s without the matching permission', async (_label, act) => {
      const customer = await createCustomer(ownerA, {
        firstName: 'Guarded',
        lastName: 'Record',
        email: `guarded-${randomUUID()}@example.com`,
      });

      await expect(act(customer.id)).rejects.toThrow(AuthorizationError);
    });

    it('refuses every operation for a member with no customer permissions', async () => {
      const none = asMember(OWNER, []);
      const customer = await createCustomer(ownerA, {
        firstName: 'No',
        lastName: 'Access',
        email: `noaccess-${randomUUID()}@example.com`,
      });

      await expect(list(none)).rejects.toThrow(AuthorizationError);
      await expect(getCustomer(none, customer.id)).rejects.toThrow(AuthorizationError);
      await expect(
        createCustomer(none, { firstName: 'X', lastName: 'Y', email: `x-${randomUUID()}@e.com` }),
      ).rejects.toThrow(AuthorizationError);
    });
  });

  describe('assignment', () => {
    it('assigns and unassigns an active member', async () => {
      const assigneeId = await addMember(
        OWNER,
        randomUUID(),
        `assignee-${randomUUID()}@example.com`,
        'Assignee',
        'EMPLOYEE',
      );
      const customer = await createCustomer(ownerA, {
        firstName: 'Assigned',
        lastName: 'Customer',
        email: `assigned-${randomUUID()}@example.com`,
      });

      const assigned = await assignCustomer(ownerA, customer.id, assigneeId);
      expect(assigned.assignedUserId).toBe(assigneeId);

      const { activities } = await listCustomerActivities(
        ownerA,
        customer.id,
        coerceCustomerListQuery({}),
      );
      expect(activities.at(0)?.type).toBe('ASSIGNED');

      const unassigned = await assignCustomer(ownerA, customer.id, null);
      expect(unassigned.assignedUserId).toBeNull();
    });

    it('rejects a user who is not a member of this organization', async () => {
      const strangerId = await seedOrganization(
        randomUUID(),
        'Stranger Ltd',
        randomUUID(),
        `stranger-${randomUUID()}@example.com`,
      );
      const customer = await createCustomer(ownerA, {
        firstName: 'Exposed',
        lastName: 'Work',
        email: `exposed-${randomUUID()}@example.com`,
      });

      const error = await assignCustomer(ownerA, customer.id, strangerId).catch(
        (cause: unknown) => cause,
      );

      expect(error).toBeInstanceOf(ValidationError);
      expect(fieldIssues(error)[0]?.path).toBe('assignedUserId');
      expect(fieldIssues(error)[0]?.message).toMatch(/not an active member/i);
    });

    it('lists only active members of this organization as assignable', async () => {
      const members = await listAssignableMembers(ownerB);

      expect(members.length).toBeGreaterThan(0);
      expect(members.every((member) => member.roleKey)).toBe(true);
      // The org A member seeded above is not visible to org B.
      const orgAMembers = await listAssignableMembers(ownerA);
      const orgAIds = new Set(orgAMembers.map((member) => member.userId));
      expect(members.some((member) => orgAIds.has(member.userId))).toBe(false);
    });

    it('filters the list by "me" and "unassigned"', async () => {
      const mine = await createCustomer(ownerA, {
        firstName: 'Mine',
        lastName: 'Only',
        email: `mine-${randomUUID()}@example.com`,
        assignedUserId: ownerA.userId,
      });

      const assignedToMe = await list(ownerA, { assignedTo: 'me' });
      expect(assignedToMe.customers.map((c) => c.id)).toContain(mine.id);

      const unassigned = await list(ownerA, { assignedTo: 'unassigned' });
      expect(unassigned.customers.every((c) => c.assignedUserId === null)).toBe(true);
    });
  });

  describe('update, notes and archive', () => {
    it('applies a partial update without clobbering other fields', async () => {
      const customer = await createCustomer(ownerA, {
        firstName: 'Partial',
        lastName: 'Update',
        email: `partial-${randomUUID()}@example.com`,
        companyName: 'Analytical Engines',
      });

      const updated = await updateCustomer(ownerA, customer.id, { firstName: 'Updated' });

      expect(updated.firstName).toBe('Updated');
      expect(updated.lastName).toBe('Update');
      expect(updated.companyName).toBe('Analytical Engines');
    });

    it('clears an optional field when sent as an empty string', async () => {
      const customer = await createCustomer(ownerA, {
        firstName: 'Clearing',
        lastName: 'Fields',
        email: `clearing-${randomUUID()}@example.com`,
        companyName: 'To Be Removed',
      });

      // Go through the schema, as the API route does, so the '' -> null
      // normalisation is part of what is under test.
      const patch = updateCustomerSchema.parse({ companyName: '' });
      const updated = await updateCustomer(ownerA, customer.id, patch);

      expect(updated.companyName).toBeNull();
    });

    it('appends notes and records an activity for each one', async () => {
      const customer = await createCustomer(ownerA, {
        firstName: 'Noted',
        lastName: 'Customer',
        email: `noted-${randomUUID()}@example.com`,
      });

      await addCustomerNote(ownerA, customer.id, 'First note.');
      const after = await addCustomerNote(ownerA, customer.id, 'Second note.');

      expect(after.notes).toBe('First note.\n\nSecond note.');

      const { activities } = await listCustomerActivities(
        ownerA,
        customer.id,
        coerceCustomerListQuery({ limit: 50 }),
      );
      const noteCount = activities.filter((activity) => activity.type === 'NOTE_ADDED').length;
      expect(noteCount).toBe(2);
    });

    it('archives instead of deleting, hiding the record from the default list', async () => {
      const customer = await createCustomer(ownerA, {
        firstName: 'Archived',
        lastName: 'Customer',
        email: `archived-${randomUUID()}@example.com`,
      });

      const archived = await archiveCustomer(ownerA, customer.id);
      expect(archived.status).toBe('ARCHIVED');
      expect(archived.archivedAt).not.toBeNull();

      const visible = await list(ownerA, { search: customer.email });
      expect(visible.customers.map((c) => c.id)).not.toContain(customer.id);

      const withArchived = await list(ownerA, {
        search: customer.email,
        includeArchived: true,
      });
      expect(withArchived.customers.map((c) => c.id)).toContain(customer.id);

      // The row still exists: archiving retains history.
      await expect(getCustomer(ownerA, customer.id)).resolves.toMatchObject({ id: customer.id });
    });

    it('refuses to archive twice', async () => {
      const customer = await createCustomer(ownerA, {
        firstName: 'Double',
        lastName: 'Archive',
        email: `double-${randomUUID()}@example.com`,
      });

      await archiveCustomer(ownerA, customer.id);

      await expect(archiveCustomer(ownerA, customer.id)).rejects.toThrow(/already archived/i);
    });

    it('treats an archived customer as read-only', async () => {
      const customer = await createCustomer(ownerA, {
        firstName: 'Read',
        lastName: 'Only',
        email: `readonly-${randomUUID()}@example.com`,
      });
      await archiveCustomer(ownerA, customer.id);

      await expect(updateCustomer(ownerA, customer.id, { firstName: 'Nope' })).rejects.toThrow(
        /cannot be edited/i,
      );
      await expect(addCustomerNote(ownerA, customer.id, 'nope')).rejects.toThrow(
        /cannot be edited/i,
      );
      await expect(assignCustomer(ownerA, customer.id, ownerA.userId)).rejects.toThrow(
        /cannot be reassigned/i,
      );
    });
  });

  describe('search, filters and pagination in the database', () => {
    it('searches name, email and company case-insensitively', async () => {
      const email = `Unique${randomUUID().slice(0, 8)}@Example.com`;
      const customer = await createCustomer(ownerA, {
        firstName: 'Zebediah',
        lastName: 'Quixote',
        email,
        companyName: 'Windmills Ltd',
      });

      const byFirstName = await list(ownerA, { search: 'zebediah' });
      expect(byFirstName.customers.map((c) => c.id)).toContain(customer.id);

      const byCompany = await list(ownerA, { search: 'windmills' });
      expect(byCompany.customers.map((c) => c.id)).toContain(customer.id);

      const byEmail = await list(ownerA, { search: email.toUpperCase() });
      expect(byEmail.customers.map((c) => c.id)).toContain(customer.id);
    });

    it('filters by multiple statuses at once', async () => {
      const active = await createCustomer(ownerA, {
        firstName: 'Status',
        lastName: 'Active',
        email: `st-active-${randomUUID()}@example.com`,
        status: 'ACTIVE',
      });
      const lead = await createCustomer(ownerA, {
        firstName: 'Status',
        lastName: 'Lead',
        email: `st-lead-${randomUUID()}@example.com`,
        status: 'LEAD',
      });

      const { customers } = await list(ownerA, { status: 'ACTIVE,LEAD' });
      const ids = customers.map((c) => c.id);

      expect(ids).toContain(active.id);
      expect(ids).toContain(lead.id);
    });

    it('paginates without duplicating or skipping rows', async () => {
      const marker = `Page${randomUUID().slice(0, 8)}`;
      const ids: string[] = [];

      for (let index = 0; index < 5; index += 1) {
        const customer = await createCustomer(ownerA, {
          firstName: 'Paged',
          lastName: `${marker}${index}`,
          email: `${marker}-${index}@example.com`,
        });
        ids.push(customer.id);
      }

      const first = await list(ownerA, { search: marker, limit: 2, page: 1, sort: 'name' });
      const second = await list(ownerA, { search: marker, limit: 2, page: 2, sort: 'name' });
      const third = await list(ownerA, { search: marker, limit: 2, page: 3, sort: 'name' });

      expect(first.pagination.total).toBe(5);
      expect(first.pagination.totalPages).toBe(3);
      expect(first.pagination.hasNextPage).toBe(true);
      expect(first.pagination.hasPreviousPage).toBe(false);
      expect(third.pagination.hasNextPage).toBe(false);

      const seen = [...first.customers, ...second.customers, ...third.customers].map((c) => c.id);
      expect(new Set(seen).size).toBe(5);
      expect(new Set(seen)).toEqual(new Set(ids));
    });

    it('sorts by name ascending', async () => {
      const marker = `Sort${randomUUID().slice(0, 8)}`;
      await createCustomer(ownerA, {
        firstName: 'Alpha',
        lastName: marker,
        email: `${marker}-a@example.com`,
      });
      await createCustomer(ownerA, {
        firstName: 'Zulu',
        lastName: marker,
        email: `${marker}-z@example.com`,
      });

      const { customers } = await list(ownerA, { search: marker, sort: 'name', order: 'asc' });
      const names = customers.map((c) => c.fullName);

      expect(names[0]).toContain('Alpha');
      expect(names.at(-1)).toContain('Zulu');
    });

    it('returns an empty page rather than an error past the last page', async () => {
      const result = await list(ownerA, { page: 999 });

      expect(result.customers).toEqual([]);
      expect(result.pagination.hasNextPage).toBe(false);
    });
  });
});
