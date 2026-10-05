export function money(n: number | null | undefined, currency: string | null): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "–";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: n >= 1000 ? 0 : 2,
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}

export function int(n: number | null | undefined): string {
  if (n === null || n === undefined) return "–";
  return new Intl.NumberFormat("en-US").format(n);
}

export function pct(part: number | null, whole: number): string {
  if (part === null || !whole) return "";
  return `${Math.round((part / whole) * 100)}%`;
}

export function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

export function dateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(new Date(iso));
}
