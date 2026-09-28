/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * Method to check whether the secret value is a nested object (returns true)
 * All other values return false
 * @param value string or stringified JSON
 * @returns boolean
 */
export function isAdvancedSecret(value: string | Record<string, unknown>): boolean {
  try {
    const obj: Record<string, unknown> = typeof value === 'string' ? JSON.parse(value) : value;
    if (Array.isArray(obj)) return false;
    // `.any` is not a real Array method (this always threw and was silently
    // caught below, so this branch never actually returned true) — `.some`
    // matches this function's own name/tests ("returns true for any nested
    // object or number value").
    return Object.values(obj).some((value) => typeof value !== 'string');
  } catch {
    return false;
  }
}
