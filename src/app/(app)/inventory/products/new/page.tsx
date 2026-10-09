import Link from 'next/link';

import { ProductForm } from '@/components/inventory/product-form';
import { Card, CardBody } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { assertPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { listProductCategories } from '@/lib/services/inventory.service';

export const metadata = { title: 'New product' };

/**
 * `GET /inventory/products/new`
 *
 * The category list is built on the server, so it can never be wider than this
 * organization and never offers a grouping the member has already archived.
 */
export default async function NewProductPage() {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.INVENTORY_PRODUCT_CREATE);

  const categories = (await listProductCategories(context!)).map((category) => ({
    id: category.id,
    name: category.name,
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">New product</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Created in {context!.organizationName}. Stock is recorded separately, so a product exists
          before any of it arrives.
        </p>
      </header>

      <Card>
        <CardBody className="p-6">
          <ProductForm mode="create" categories={categories} />
        </CardBody>
      </Card>

      <p className="text-fg-muted text-sm">
        <Link href="/inventory/products" className="hover:text-fg">
          Back to products
        </Link>
      </p>
    </div>
  );
}
