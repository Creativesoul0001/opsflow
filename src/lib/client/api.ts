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

export async function postJson<T>(
  url: string,
  body: unknown,
): Promise<{ data: T; status: number }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
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
