import Link from 'next/link';

import { WarehouseForm } from '@/components/inventory/warehouse-form';
import { Card, CardBody } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { assertPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';

export const metadata = { title: 'New warehouse' };

/**
 * `GET /inventory/warehouses/new`
 *
 * A warehouse is where stock lives, so an organization can hold several. The
 * first one created becomes the primary automatically, because order deductions
 * need a default source.
 */
export default async function NewWarehousePage() {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">New warehouse</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Created in {context!.organizationName}. Your first warehouse becomes the primary.
        </p>
      </header>

      <Card>
        <CardBody className="p-6">
          <WarehouseForm mode="create" />
        </CardBody>
      </Card>

      <p className="text-fg-muted text-sm">
        <Link href="/inventory/warehouses" className="hover:text-fg">
          Back to warehouses
        </Link>
      </p>
    </div>
  );
}
