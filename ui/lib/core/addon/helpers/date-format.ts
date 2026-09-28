/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { helper } from '@ember/component/helper';
import { format, parseISO } from 'date-fns';

function checkType(value: unknown): string {
  if (typeof value === 'string') {
    // if it's a number when multiplied by 1, it's just a number in quotes
    return isNaN(Number(value)) ? 'string' : 'number';
  }
  if (typeof value === 'object' && value !== null) {
    // Dates are technically an object
    try {
      (value as Date).toUTCString();
      return 'date';
    } catch {
      return 'object';
    }
  }
  return typeof value;
}

function dateFromNumber(number: string | number): Date {
  if (number.toString().length === 10) {
    // is seconds, convert to millis
    return new Date(Number(number) * 1000);
  }
  // Multiply by 1 in case it's a number in quotes
  return new Date(Number(number) * 1);
}

function dateFromString(str: string): Date | null {
  // Check ISO format first
  let val: Date = parseISO(str);
  if (val.toString() !== 'Invalid Date') return val;

  val = new Date(str);
  if (val.toString() !== 'Invalid Date') return val;

  return null;
}

export function dateFormat(
  [value, style = 'MMM d yyyy, h:mm:ss aa']: [unknown, string?],
  { withTimeZone = false }: { withTimeZone?: boolean }
): string {
  // see format breaking in upgrade to date-fns 2.x https://github.com/date-fns/date-fns/blob/master/CHANGELOG.md#changed-5
  let date: Date | null = null;
  switch (checkType(value)) {
    case 'string':
      date = dateFromString(value as string);
      break;
    case 'number':
      date = dateFromNumber(value as string);
      break;
    case 'date':
      date = value as Date;
      break;
    default:
      // date is not a recognized format
      break;
  }

  // at this point, date is either falsey or a Date object
  if (!date) {
    return (value as string) || '';
  }

  const zone = withTimeZone ? formatTimeZone(date) : '';
  return format(date, style) + zone;
}

// separate function for testing
export function formatTimeZone(date: Date): string {
  let zone: string; // local timezone ex: 'PST'
  try {
    // passing undefined means default to the browser's locale
    zone = date.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ')[2] ?? '';
  } catch {
    zone = '';
  }

  return zone ? ` ${zone}` : '';
}

export default helper(dateFormat);
