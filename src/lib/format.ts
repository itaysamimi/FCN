const GB = 1024 ** 3;
const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toLocaleString("he-IL", { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${UNITS[unit]}`;
}

export function bytesToGb(bytes: number) {
  return bytes / GB;
}

export function gbToBytes(gb: number) {
  return Math.round(gb * GB);
}

export function formatNumber(value: number) {
  return value.toLocaleString("he-IL");
}

export function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
