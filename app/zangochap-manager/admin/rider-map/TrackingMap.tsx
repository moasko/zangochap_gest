"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RiderTrackPoint } from "@/modules/rider-tracking/types";
export type MapMarker = { id: string; name: string; phone: string | null; latitude: number; longitude: number; accuracy: number; time: string; status: string };
export default function TrackingMap({ markers, points, cursor, viewKey }: { markers: MapMarker[]; points: RiderTrackPoint[]; cursor: number; viewKey: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const cursorLayer = useRef<L.LayerGroup | null>(null);
  const bounds = useRef<L.LatLngBounds | null>(null);
  const fitted = useRef("");
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current).setView([5.36, -4.008], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance);
    map.current = instance;
    layers.current = L.layerGroup().addTo(instance);
    cursorLayer.current = L.layerGroup().addTo(instance);
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); instance.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    if (!map.current || !layers.current) return;
    const group = layers.current;
    let openId: string | null = null;
    group.eachLayer(layer => {
      if (layer instanceof L.Marker && layer.isPopupOpen()) openId = (layer.options as L.MarkerOptions & { riderId?: string }).riderId || null;
    });
    group.clearLayers();
    const coords: L.LatLngExpression[] = [];
    for (const marker of markers) {
      const position: L.LatLngExpression = [marker.latitude, marker.longitude];
      coords.push(position);
      const label = document.createElement("div");
      label.style.minWidth = "190px";
      const name = document.createElement("strong");
      name.textContent = marker.name;
      name.style.fontSize = "15px";
      label.append(name);
      for (const text of [marker.status, "Dernière position : " + new Date(marker.time).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }), "Précision : ±" + Math.round(marker.accuracy) + " m"]) {
        const line = document.createElement("div"); line.textContent = text; line.style.marginTop = "7px"; label.append(line);
      }
      if (marker.phone) {
        const phone = document.createElement("a");
        phone.textContent = "Appeler : " + marker.phone;
        phone.href = "tel:" + marker.phone.replace(/[^+0-9]/g, "");
        phone.style.display = "block"; phone.style.marginTop = "10px";
        label.append(phone);
      }
      const badge = document.createElement("div");
      badge.style.cssText = "display:flex;align-items:center;gap:6px;width:max-content;max-width:180px;padding:6px 9px;background:white;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 2px 5px #0002;font:600 12px system-ui;color:#0f172a";
      const dot = document.createElement("span");
      dot.style.cssText = "width:10px;height:10px;border-radius:50%;flex-shrink:0;background:" + (marker.status === "Suivi actif" ? "#059669" : "#64748b");
      const title = document.createElement("span"); title.textContent = marker.name;
      title.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      badge.append(dot, title);
      const pin = L.marker(position, {
        icon: L.divIcon({ html: badge, className: "rider-name-marker", iconSize: [180, 30], iconAnchor: [14, 15], popupAnchor: [0, -14] }),
        title: marker.name + " — voir les informations", alt: marker.name, keyboard: true,
        ...{ riderId: marker.id },
      }).bindPopup(label).addTo(group);
      if (openId === marker.id) pin.openPopup();
      if (markers.length === 1) L.circle(position, { interactive: false, radius: marker.accuracy, color: "#64748b", weight: 1, fillOpacity: 0.06 }).addTo(group);
    }
    let segment: L.LatLngExpression[] = [];
    const draw = () => { if (segment.length > 1) L.polyline(segment, { color: "#4f46e5", weight: 4 }).addTo(group); };
    points.forEach((point, i) => {
      const previous = points[i - 1];
      if (previous && (previous.sessionId !== point.sessionId || Date.parse(point.capturedAt) - Date.parse(previous.capturedAt) > 300000)) { draw(); segment = []; }
      const position: L.LatLngExpression = [point.latitude, point.longitude];
      coords.push(position); segment.push(position);
    });
    draw();
    bounds.current = coords.length ? L.latLngBounds(coords) : null;
    if (bounds.current && fitted.current !== viewKey) {
      map.current.fitBounds(bounds.current, { padding: [35, 35], maxZoom: 16 });
      fitted.current = viewKey;
    }
  }, [markers, points, viewKey]);
  useEffect(() => {
    const group = cursorLayer.current;
    if (!group) return;
    group.clearLayers();
    const point = points[cursor];
    if (!point) return;
    const label = document.createElement("div");
    label.textContent = new Date(point.capturedAt).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }) + " · précision ±" + Math.round(point.accuracy) + " m";
    L.circleMarker([point.latitude, point.longitude], { radius: 8, color: "#fff", weight: 2, fillColor: "#e11d48", fillOpacity: 1 }).bindPopup(label).addTo(group);
  }, [points, cursor]);
  return <div className="relative overflow-hidden rounded-lg border border-slate-200">
    <div ref={container} className="h-[55vh] min-h-[320px] w-full lg:h-[65vh]" style={{ zIndex: 0 }} aria-label="Carte des positions des livreurs" />
    <button type="button" className="absolute right-3 top-3 z-10 rounded-md bg-white px-3 py-2 text-xs font-semibold shadow" onClick={() => { if (map.current && bounds.current) map.current.fitBounds(bounds.current, { padding: [35, 35], maxZoom: 16 }); }}>Recentrer</button>
  </div>;
}
