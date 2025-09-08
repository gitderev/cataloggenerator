/**
 * Pricing utilities for catalog generation
 */

// One-time log to confirm integer-cents implementation
if (typeof (globalThis as any).eanEndingInitLogged === 'undefined') {
  console.warn('ean:ending:function=int-cents');
  (globalThis as any).eanEndingInitLogged = true;
}

/**
 * Round to nearest cent using integer arithmetic (a prova di float)
 */
export function roundToCents(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  return Math.floor(n * 100 + 0.5) / 100;
}

/**
 * Apply ending ,99 using integer arithmetic in cents to avoid floating point errors
 * Returns NaN for invalid inputs (<=0 or non-finite)
 */
export function toComma99Cents(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return NaN;

  const cents = Math.floor(v * 100 + 0.5); // neutralizza micro-errori binari
  const euros = Math.floor(cents / 100);
  let resultCents = euros * 100 + 99;

  if (cents > resultCents) {
    resultCents = (euros + 1) * 100 + 99;
  }

  if (typeof (globalThis as any).eanEndingSampleCount === 'undefined') {
    (globalThis as any).eanEndingSampleCount = 0;
  }
  if ((globalThis as any).eanEndingSampleCount < 3) {
    console.warn('ean:ending:sample', {
      preFee: roundToCents(v),
      finalEan: resultCents / 100
    });
    (globalThis as any).eanEndingSampleCount++;
  }

  return resultCents / 100;
}

/**
 * Validate that a value ends with .99 using integer cents arithmetic
 */
export function validateEnding99(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const cents = Math.floor(value * 100 + 0.5);
  return (cents % 100) === 99;
}

/**
 * Compute final EAN price with cent-level rounding at each step, ending ,99 at the end
 */
export function computeFinalEan(
  basePrice: number,
  shipCost: number,
  ivaMultiplier: number,
  feeDR: number,
  feeMkt: number
): number {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return NaN;
  const base = roundToCents(basePrice);
  const withShip = roundToCents(base + shipCost);
  const withVat = roundToCents(withShip * ivaMultiplier);
  const withFeeDR = roundToCents(withVat * feeDR);
  const withFeeMkt = roundToCents(withFeeDR * feeMkt);
  return toComma99Cents(withFeeMkt);
}
