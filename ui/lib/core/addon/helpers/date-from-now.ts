/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { helper } from '@ember/component/helper';
import { formatDistanceToNow } from 'date-fns';

type FormatDistanceToNowOptions = NonNullable<Parameters<typeof formatDistanceToNow>[1]>;

export function dateFromNow(
  [date]: [string | number | Date],
  options: FormatDistanceToNowOptions = {}
): string {
  // check first if string. If it is, it could be ISO format or UTC, either way create a new date object
  // otherwise it's a number or object and just return
  const newDate = typeof date === 'string' ? new Date(date) : date;
  return formatDistanceToNow(newDate, { ...options });
}

export default helper(dateFromNow);
