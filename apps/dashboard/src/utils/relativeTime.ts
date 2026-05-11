/**
 * Single source of truth for "3h ago", "yesterday", "in 2 days" formatting
 * across the dashboard. Wraps Intl.RelativeTimeFormat with a unit-picker so
 * callers don't have to think about minutes vs hours vs days.
 */

const RTF = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function relativeTime(input: Date | string | number): string {
  const ts =
    input instanceof Date ? input.getTime() : new Date(input).getTime();
  if (!Number.isFinite(ts)) return '';

  const diffSec = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 45) return RTF.format(diffSec, 'second');
  if (abs < 60 * 45) return RTF.format(Math.round(diffSec / 60), 'minute');
  if (abs < 60 * 60 * 22) return RTF.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 60 * 60 * 24 * 6)
    return RTF.format(Math.round(diffSec / 86400), 'day');
  if (abs < 60 * 60 * 24 * 27)
    return RTF.format(Math.round(diffSec / 604800), 'week');
  if (abs < 60 * 60 * 24 * 320)
    return RTF.format(Math.round(diffSec / 2629800), 'month');
  return RTF.format(Math.round(diffSec / 31557600), 'year');
}
