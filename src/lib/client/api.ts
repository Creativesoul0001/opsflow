/**
 * Client helper for calling OpsFlow JSON endpoints.
 *
 * Surfaces field-level validation issues returned by the API so forms can show
 * them inline, and throws a plain `Error` with a safe message otherwise.
 */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

interface Issue {
  path: string;
  message: string;
}

/**
 * Reads a form field as a string.
 *
 * `FormData.get` is typed `FormDataEntryValue | null`, so a blind `String()`
 * would silently produce `"[object File]"` for a file input. Narrowing on
 * `typeof value === 'string'` keeps that from reaching the server as a
 * plausible-looking but wrong value.
 */
export function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Performs a JSON request and unwraps the `{ data }` envelope.
 *
 * Field-level validation issues from a 422 are mapped onto `fieldErrors` so
 * forms can render them inline; any other failure throws an `ApiRequestError`
 * carrying only the safe server message.
 */
async function requestJson<T>(
  url: string,
  init: RequestInit,
): Promise<{ data: T; status: number }> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiRequestError(
      'The server returned an unexpected response.',
      response.status,
      'BAD_RESPONSE',
    );
  }

  if (response.ok) {
    return { data: (payload as { data: T }).data, status: response.status };
  }

  const error = (payload as { error?: { message?: string; code?: string; details?: unknown } })
    .error;

  const details = error?.details as { issues?: Issue[] } | undefined;
  const fieldErrors: Record<string, string> = {};
  for (const issue of details?.issues ?? []) {
    if (!(issue.path in fieldErrors)) fieldErrors[issue.path] = issue.message;
  }

  throw new ApiRequestError(
    error?.message ?? 'The request failed. Please try again.',
    response.status,
    error?.code ?? 'UNKNOWN',
    fieldErrors,
  );
}

export function getJson<T>(url: string): Promise<{ data: T; status: number }> {
  return requestJson<T>(url, { method: 'GET' });
}

export function postJson<T>(url: string, body: unknown): Promise<{ data: T; status: number }> {
  return requestJson<T>(url, { method: 'POST', body: JSON.stringify(body) });
}

export function patchJson<T>(url: string, body: unknown): Promise<{ data: T; status: number }> {
  return requestJson<T>(url, { method: 'PATCH', body: JSON.stringify(body) });
}

/**
 * `DELETE`, optionally with a JSON body.
 *
 * Some endpoints (order cancellation) use `DELETE` for a "retire this record"
 * action that also takes a reason; a body is only sent when one is given, so a
 * plain delete still travels without a `content-type`.
 */
export function deleteJson<T>(url: string, body?: unknown): Promise<{ data: T; status: number }> {
  return requestJson<T>(url, {
    method: 'DELETE',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
