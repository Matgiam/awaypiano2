/** Formatting helpers shared across the UI. */

/**
 * Render a byte count as a compact human-readable size.
 *
 * Uses binary units (MiB) but the conventional "MB" label, matching what
 * operating systems and browser dev tools display for downloads.
 */
export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (bytes < 1024) return `${bytes} B`;

  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}
