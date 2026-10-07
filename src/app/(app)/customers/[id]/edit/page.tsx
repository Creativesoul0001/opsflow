import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { CustomerForm } from '@/components/customers/customer-form';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { parseCustomerId } from '@/lib/customers/validation';
import { hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { getCustomer } from '@/lib/services/customer.service';

export const metadata = { title: 'Edit customer' };

/**
 * `GET /customers/[id]/edit`
 *
 * Reuses the create form. Archived customers are sent back to their page instead
 * of showing a form, because the service refuses to edit them — the redirect
 * makes that rule visible before the member fills anything in.
 */
export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthorizationContext();
  if (!context) notFound();

  if (!hasPermission(context, PERMISSIONS.CUSTOMERS_UPDATE)) {
    redirect('/customers');
  }

  let customer;
  try {
    customer = await getCustomer(context, parseCustomerId((await params).id));
  } catch {
    notFound();
  }

  if (customer.archivedAt) {
    redirect(`/customers/${customer.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">Edit customer</h1>
        <p className="text-fg-muted mt-1 text-sm">Changes are recorded in the activity timeline.</p>
      </header>

      <Alert tone="info">
        Assignment is managed on the customer page so it keeps its own permission and audit entry.
      </Alert>

      <Card>
        <CardBody className="p-6">
          <CustomerForm
            mode="edit"
            customerId={customer.id}
            members={[]}
            initialValues={{
              firstName: customer.firstName,
              lastName: customer.lastName,
              email: customer.email,
              phone: customer.phone ?? '',
              companyName: customer.companyName ?? '',
              status: customer.status,
              customerType: customer.customerType,
              notes: customer.notes ?? '',
              assignedUserId: customer.assignedUserId ?? '',
            }}
          />
        </CardBody>
      </Card>

      <p className="text-fg-muted text-sm">
        <Link href={`/customers/${customer.id}`} className="hover:text-fg">
          Back to {customer.fullName}
        </Link>
      </p>
    </div>
  );
}
