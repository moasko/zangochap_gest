/** Calendar-day bounds for the expedition duplicate check, independent of server TZ. */
export function getExpeditionDayRange(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Abidjan", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  // Abidjan is UTC+00:00, without daylight-saving changes.
  const gte = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

export function isInExpeditionDay(createdAt: Date, range: ReturnType<typeof getExpeditionDayRange>) {
  return createdAt.getTime() >= range.gte.getTime() && createdAt.getTime() < range.lt.getTime();
}
