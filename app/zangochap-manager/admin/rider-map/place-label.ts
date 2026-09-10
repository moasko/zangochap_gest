// In-memory only: no coordinates are persisted in browser storage.
const cache = new Map<string, { label: string | null; expires: number }>();
const pending = new Map<string, Promise<string | null>>();
function keyFor(latitude: number, longitude: number) { return latitude.toFixed(4) + "," + longitude.toFixed(4); }
async function lookup(latitude: number, longitude: number) {
  const key = keyFor(latitude, longitude);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.label;
  const running = pending.get(key);
  if (running) return running;
  const request = (async () => {
    const response = await fetch("/api/admin/rider-tracking/place?" + new URLSearchParams({ lat: latitude.toFixed(4), lon: longitude.toFixed(4) }), { cache: "no-store", signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Lieu indisponible.");
    const label = typeof data.label === "string" ? data.label : null;
    if (cache.size >= 500) cache.delete(cache.keys().next().value!);
    cache.set(key, { label, expires: Date.now() + (label ? 3600000 : 300000) });
    return label;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
export function placeLabel(latitude: number, longitude: number) {
  const element = document.createElement("div");
  element.style.cssText = "margin-top:9px;padding-top:8px;border-top:1px solid #e2e8f0;font-size:12px";
  const text = document.createElement("div");
  const cached = cache.get(keyFor(latitude, longitude));
  text.textContent = cached && cached.expires > Date.now() ? (cached.label ? "Lieu proche : " + cached.label : "Lieu non renseigné sur la carte.") : "Lieu : cliquez pour rechercher l’adresse.";
  const button = document.createElement("button"); button.type = "button";
  button.textContent = "Rechercher le lieu"; button.style.cssText = "padding:8px 0;color:#4338ca;font-weight:600";
  const attribution = document.createElement("a");
  attribution.href = "https://www.geoapify.com/"; attribution.target = "_blank"; attribution.rel = "noopener noreferrer";
  attribution.textContent = "Adresses © Geoapify · données OpenStreetMap";
  attribution.style.cssText = "display:block;font-size:10px;margin-top:4px";
  element.append(text, button, attribution);
  const load = async () => {
    if (button.disabled) return;
    button.disabled = true; text.textContent = "Recherche du lieu…";
    try { const label = await lookup(latitude, longitude); text.textContent = label ? "Lieu proche : " + label : "Lieu non renseigné sur la carte."; }
    catch (error) { text.textContent = error instanceof Error ? error.message : "Lieu indisponible."; }
    finally { button.disabled = false; }
  };
  button.addEventListener("click", () => { void load(); });
  return { element, load };
}
