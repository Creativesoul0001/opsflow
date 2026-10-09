import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  movementTypeLabel,
  movementTypeTone,
  formatDateTime,
  formatQuantityChange,
} from '@/lib/inventory/presentation';
import type { StockMovementDto } from '@/lib/services/stock.service';

/**
 * One row of the stock ledger.
 *
 * The line carries everything needed to audit the change: what moved, how much,
 * what the balance was either side of it, where, and who did it. Linking to the
 * order or the transfer is what makes "why did my stock drop?" answerable
 * without leaving the page.
 */
export function MovementRow({ movement }: { movement: StockMovementDto }) {
  const signed = formatQuantityChange(movement.quantity);

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={movementTypeTone(movement.type)}>{movementTypeLabel(movement.type)}</Badge>
          <span className="text-fg text-sm font-medium">{movement.product.name}</span>
          <span
            className={
              movement.quantity < 0
                ? 'text-danger text-sm font-medium'
                : 'text-success text-sm font-medium'
            }
          >
            {signed} {movement.product.unit}
          </span>
        </div>

        <p className="text-fg-muted mt-0.5 text-sm">
          <Link href={`/inventory/warehouses/${movement.warehouse.id}`} className="hover:text-fg">
            {movement.warehouse.name}
          </Link>
          <span className="text-fg-muted/70 font-mono text-xs"> · {movement.warehouse.code}</span>
          <span className="text-fg-muted/70">
            {' '}
            · {movement.quantityBefore} → {movement.quantityAfter}
          </span>
        </p>

        {movement.reason ? <p className="text-fg-muted text-sm">{movement.reason}</p> : null}

        <p className="text-fg-muted/80 mt-0.5 text-xs">
          {formatDateTime(movement.createdAt)} ·{' '}
          {movement.orderId && movement.orderId === movement.orderId ? (
            <Link href={`/orders/${movement.orderId}`} className="hover:text-fg">
              view order
            </Link>
          ) : null}
          {movement.transferId ? <span className="font-mono">{movement.transferId}</span> : null}
          {movement.user ? ` · ${movement.user.name}` : ' · removed member'}
        </p>
      </div>
    </li>
  );
}
