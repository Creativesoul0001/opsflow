import { describe, expect, it } from 'vitest';

import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  allowedTransitions,
  canCancel,
  canTransition,
  isOrderStatus,
  isTerminalOrderStatus,
  transitionRejection,
} from '@/lib/orders/status';

/**
 * The order workflow is policy held in code rather than a database constraint,
 * so these tests are the specification: they say exactly which moves exist, and
 * the API, the UI and the migration's CHECK constraints all have to agree with
 * them.
 */

describe('status vocabulary', () => {
  it('has a label and a badge tone for every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABELS[status], status).toBeTruthy();
      expect(ORDER_STATUS_TONES[status], status).toBeTruthy();
    }
  });

  it('recognises exactly the declared statuses', () => {
    for (const status of ORDER_STATUSES) expect(isOrderStatus(status)).toBe(true);

    for (const other of ['DRAFT', 'SHIPPING', '', 'pending']) {
      expect(isOrderStatus(other), other).toBe(false);
    }
  });

  it('names DELIVERED and CANCELLED as the statuses you cannot leave', () => {
    expect(ORDER_STATUSES.filter(isTerminalOrderStatus)).toEqual(['DELIVERED', 'CANCELLED']);
  });
});

describe('transitions', () => {
  it('walks the happy path one step at a time', () => {
    expect(canTransition('PENDING', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'PROCESSING')).toBe(true);
    expect(canTransition('PROCESSING', 'SHIPPED')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED')).toBe(true);
  });

  it('refuses to skip a stage', () => {
    expect(canTransition('PENDING', 'SHIPPED')).toBe(false);
    expect(canTransition('CONFIRMED', 'DELIVERED')).toBe(false);
    expect(canTransition('PENDING', 'DELIVERED')).toBe(false);
  });

  it('never runs backwards', () => {
    expect(canTransition('CONFIRMED', 'PENDING')).toBe(false);
    expect(canTransition('DELIVERED', 'SHIPPED')).toBe(false);
    expect(canTransition('CANCELLED', 'PENDING')).toBe(false);
  });

  it('offers cancellation while the goods have not left', () => {
    expect(allowedTransitions('PENDING')).toContain('CANCELLED');
    expect(allowedTransitions('CONFIRMED')).toContain('CANCELLED');
    expect(allowedTransitions('PROCESSING')).toContain('CANCELLED');
    expect(allowedTransitions('SHIPPED')).toEqual(['DELIVERED']);
  });

  it('leaves nothing for a terminal status', () => {
    expect(allowedTransitions('DELIVERED')).toEqual([]);
    expect(allowedTransitions('CANCELLED')).toEqual([]);
  });

  it('allows cancellation from every stage before delivery, and never after', () => {
    expect(canCancel('PENDING')).toBe(true);
    expect(canCancel('CONFIRMED')).toBe(true);
    expect(canCancel('PROCESSING')).toBe(true);
    expect(canCancel('SHIPPED')).toBe(true);
    expect(canCancel('DELIVERED')).toBe(false);
    expect(canCancel('CANCELLED')).toBe(false);
  });
});

describe('transitionRejection', () => {
  it('returns null when the move is allowed', () => {
    expect(transitionRejection('PENDING', 'CONFIRMED')).toBeNull();
    expect(transitionRejection('PROCESSING', 'CANCELLED')).toBeNull();
  });

  it('explains a repeated status rather than sounding like a bug', () => {
    expect(transitionRejection('SHIPPED', 'SHIPPED')).toBe('This order is already shipped.');
  });

  it('says a terminal status cannot be changed', () => {
    expect(transitionRejection('DELIVERED', 'CANCELLED')).toBe(
      'An order that is delivered cannot be changed.',
    );
    expect(transitionRejection('CANCELLED', 'CONFIRMED')).toBe(
      'An order that is cancelled cannot be changed.',
    );
  });

  it('lists the moves that remain, so the message is actionable', () => {
    expect(transitionRejection('PENDING', 'SHIPPED')).toBe(
      'An order that is pending can only become confirmed or cancelled.',
    );
    expect(transitionRejection('SHIPPED', 'PROCESSING')).toBe(
      'An order that is shipped can only become delivered.',
    );
  });

  it('never returns both a reason and success', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        const reason = transitionRejection(from, to);
        expect(reason === null).toBe(canTransition(from, to));
      }
    }
  });
});
