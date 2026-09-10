// Derived from the immutable ID: filtering or reordering never changes a color.
export function riderColor(riderId: string): string {
  let hash = 2166136261;
  for (const char of riderId) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return "hsl(" + ((hash >>> 0) % 3600) / 10 + ", 72%, 38%)";
}
