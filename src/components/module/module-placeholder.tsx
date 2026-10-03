import { Alert } from '@/components/ui/alert';
import { EmptyState } from '@/components/ui/empty-state';
import { getAuthorizationContext } from '@/lib/auth/session';
import { getModule } from '@/lib/modules';
import { assertPermission } from '@/lib/rbac/guard';

/**
 * Placeholder screen for modules that are registered but not yet built.
 *
 * It states plainly that the module is unavailable instead of rendering mock
 * data or a disabled-looking UI, so nobody mistakes a planned feature for a
 * working one. Permission is still enforced server-side: a member without the
 * module's `read` permission gets 403 rather than this page.
 */
export async function ModulePlaceholder({ slug }: { slug: string }) {
  const definition = getModule(`/${slug}`);
  if (!definition) throw new Error(`Unknown module "${slug}" is not registered.`);

  const context = await getAuthorizationContext();
  assertPermission(context!, definition.permission);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">{definition.label}</h1>
        <p className="text-fg-muted mt-1 text-sm">{definition.summary}</p>
      </header>

      <Alert tone="info" title="Coming in a future phase">
        {definition.label} is not built yet. It is scheduled for Phase {definition.phase} and this
        page will be replaced when it ships.
      </Alert>

      <div className="bg-surface ring-border-subtle rounded-xl ring-1">
        <EmptyState
          title="No data here yet"
          description="Once this module is implemented it will list records scoped to your organization."
        />
      </div>
    </div>
  );
}
