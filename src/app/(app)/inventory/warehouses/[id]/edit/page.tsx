import { notFound } from 'next/navigation';

import { WarehouseForm } from '@/components/inventory/warehouse-form';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { parseWarehouseId } from '@/lib/inventory/validation';
import { assertPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { getWarehouse } from '@/lib/services/inventory.service';

export const metadata = { title: 'Edit warehouse' };

/**
 * `GET /inventory/warehouses/:id/edit`
 *
 * Tenant-scoped through the service: another organization's warehouse id lands on
 * the same 404 as one that does not exist.
 */
export default async function EditWarehousePage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);

  let warehouse;
  try {
    warehouse = await getWarehouse(context!, parseWarehouseId((await params).id));
  } catch {
    notFound();
  }

  if (warehouse.archivedAt) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">Edit warehouse</h1>
        </header>
        <Alert tone="warning" title="This warehouse is archived">
          Archived warehouses are read-only. Restore it first to change its details.
        </Alert>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">Edit warehouse</h1>
        <p className="text-fg-muted mt-1 text-sm">{warehouse.name}</p>
      </header>

      <Card>
        <CardBody className="p-6">
          <WarehouseForm
            mode="edit"
            warehouseId={warehouse.id}
            initialValues={{
              code: warehouse.code,
              name: warehouse.name,
              addressLine1: warehouse.addressLine1 ?? '',
              addressLine2: warehouse.addressLine2 ?? '',
              city: warehouse.city ?? '',
              state: warehouse.state ?? '',
              postalCode: warehouse.postalCode ?? '',
              country: warehouse.country ?? '',
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
