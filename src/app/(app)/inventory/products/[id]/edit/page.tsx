import { notFound } from 'next/navigation';

import { ProductForm } from '@/components/inventory/product-form';
import { Card, CardBody } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { getAuthorizationContext } from '@/lib/auth/session';
import { parseProductId } from '@/lib/inventory/validation';
import { assertPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { getProduct, listProductCategories } from '@/lib/services/inventory.service';

export const metadata = { title: 'Edit product' };

/**
 * `GET /inventory/products/:id/edit`
 *
 * The product is loaded through the service, which scopes the lookup to the
 * caller's organization: another tenant's id lands on the same 404 as for one
 * that does not exist.
 */
export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.INVENTORY_PRODUCT_UPDATE);

  let product;
  try {
    product = await getProduct(context!, parseProductId((await params).id));
  } catch {
    notFound();
  }

  if (product.archivedAt) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">Edit product</h1>
        </header>
        <Alert tone="warning" title="This product is archived">
          Archived products are read-only. Restore it first to change its catalogue details.
        </Alert>
      </div>
    );
  }

  const categories = (await listProductCategories(context!)).map((category) => ({
    id: category.id,
    name: category.name,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">Edit product</h1>
        <p className="text-fg-muted mt-1 text-sm">{product.name}</p>
      </header>

      <Card>
        <CardBody className="p-6">
          <ProductForm
            mode="edit"
            productId={product.id}
            categories={categories}
            initialValues={{
              sku: product.sku,
              name: product.name,
              description: product.description ?? '',
              categoryId: product.categoryId ?? '',
              unitPrice: product.unitPrice,
              costPrice: product.costPrice ?? '',
              reorderThreshold: String(product.reorderThreshold),
              unit: product.unit,
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
