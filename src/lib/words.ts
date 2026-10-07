/**
 * "Demos booked" → "demo booked", "Discovery calls booked" → "discovery call booked",
 * "Follow-ups" → "follow-up", "Closed deals" → "closed deal". Used for "Cost per …" labels.
 */
export function singular(label: string): string {
  return label
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w) => (w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w === "ups" ? "up" : w))
    .join("");
}
