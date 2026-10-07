/**
 * Exact money arithmetic for the Orders module.
 *
 * PostgreSQL `int4` cannot represent money safely on its own — a float in
 * JavaScript cannot either, because `0.1 + 0.2 !== 0.3` and `Math.round(1.005 *
 * 100)` rounds the wrong way at real-world prices. So:
 *
 *  * the wire format is a **decimal string** in major units (`"1250.50"`),
 *  * storage is an **integer** count of minor units (`125050`), and
 *  * every conversion between the two is string-based, never `parseFloat`.
 *
 * Arithmetic itself happens on integers, which are exact in IEEE-754 doubles
 * up to 2^53, far beyond any amount this schema can store. The bounds below keep
 * the *stored* value inside PostgreSQL's `int4` range (max 2147483647) so a
 * constraint violation can never be reached by a legal request.
 */

/** Minor units per major unit. 100 paise in a rupee, 100 cents in a dollar. */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Largest amount that may be *stored*, in minor units.
 *
 * Deliberately below `2 ** 31 - 1`: intermediate values such as
 * `quantity * unitPrice` must also fit, and leaving ~7% of headroom keeps the
 * arithmetic comfortably inside int4 without a second, different ceiling.
 */
export const MAX_MONEY_MINOR = 2_000_000_000;

/** Largest amount that may be stored, in major units (`MAX_MONEY_MINOR / 100`). */
export const MAX_MONEY_MAJOR = MAX_MONEY_MINOR / MINOR_UNITS_PER_MAJOR;

/**
 * At most two decimal places, no sign, no separators, no exponent.
 *
 * Leading zeros are allowed so `"0.50"` and `"0001.20"` parse identically, but
 * the digit count is capped to reject `"-1"`, `"1e3"`, `"1,250"`, `"∞"` and
 * `"0x10"` before any of them can reach arithmetic.
 */
const MAJOR_PATTERN = /^\d{1,10}(?:\.\d{1,2})?$/;

/**
 * Parses a major-unit decimal string into integer minor units.
 *
 * Returns `null` when the input is not a well-formed non-negative amount. The
 * caller turns `null` into a field-level validation issue, so this stays a
 * total function with no throwing path.
 *
 * Uses only string slicing — `Number("1.005") * 100` would silently produce
 * `100.49999999999999`.
 */
export function parseMinorUnits(value: string): number | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!MAJOR_PATTERN.test(trimmed)) return null;

  const [whole, fraction = ''] = trimmed.split('.');
  const minor = Number(whole) * MINOR_UNITS_PER_MAJOR + Number(fraction.padEnd(2, '0'));

  // `Number(whole)` is exact for the digit counts MAJOR_PATTERN allows, but the
  // guard makes the contract explicit rather than depending on that reasoning.
  if (!Number.isSafeInteger(minor)) return null;
  if (minor > MAX_MONEY_MINOR) return null;

  return minor;
}

/**
 * Renders integer minor units as a major-unit decimal string with exactly two
 * places, so `125050 -> '1250.50'` and `5 -> '0.05'`.
 */
export function formatMinorUnits(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const absolute = Math.abs(Math.trunc(minor));
  const whole = Math.trunc(absolute / MINOR_UNITS_PER_MAJOR);
  const fraction = absolute % MINOR_UNITS_PER_MAJOR;

  return `${sign}${whole}.${String(fraction).padStart(2, '0')}`;
}

/** Range check applied to every value handed to Prisma. */
export function isStorableMoney(minor: number): boolean {
  return Number.isSafeInteger(minor) && minor >= 0 && minor <= MAX_MONEY_MINOR;
}
