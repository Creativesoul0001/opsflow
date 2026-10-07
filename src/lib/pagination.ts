/**
 * Pagination metadata for the `{ data, meta }` envelope.
 *
 * Extracted from the customer module so Orders (and every later module) shares
 * one definition of "the current page" instead of re-deriving it and drifting.
 */

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Pagination metadata for a page of results. */
export function buildPagination(page: number, limit: number, total: number): Pagination {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && total > 0,
  };
}
