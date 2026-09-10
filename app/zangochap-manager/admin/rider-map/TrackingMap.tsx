"use client";
import { useEffect, useRef } from "react";
import L from "leaflet";
import { trackSegments } from "@/modules/rider-tracking/segments";
import { placeLabel } from "./place-label";
import { riderColor } from "@/modules/rider-tracking/colors";
import "leaflet/dist/leaflet.css";
import type { ViewerPosition, SelectedPosition } from "@/modules/rider-tracking/viewer-position";
import type { RiderTrackPoint } from "@/modules/rider-tracking/types";
export type MapMarker = { id: string; name: string; phone: string | null; latitude: number; longitude: number; accuracy: number; time: string; status: string };
export default function TrackingMap({ markers, points, cursor, viewKey, followId, onStopFollowing, riderNames, viewerPosition, destination }: { markers: MapMarker[]; points: RiderTrackPoint[]; cursor: number; viewKey: string; followId: string; onStopFollowing: () => void; riderNames: Record<string, string>; viewerPosition: ViewerPosition | null; destination: SelectedPosition | null }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const cursorLayer = useRef<L.LayerGroup | null>(null);
  const viewerLayer = useRef<L.LayerGroup | null>(null);
  const viewerBounds = useRef<L.LatLngBounds | null>(null);
  const bounds = useRef<L.LatLngBounds | null>(null);
  const fitted = useRef("");
  const stopFollowing = useRef(onStopFollowing);
  useEffect(() => { stopFollowing.current = onStopFollowing; }, [onStopFollowing]);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current).setView([5.36, -4.008], 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(instance);
    map.current = instance;
    layers.current = L.layerGroup().addTo(instance);
    cursorLayer.current = L.layerGroup().addTo(instance);
    viewerLayer.current = L.layerGroup().addTo(instance);
    const manual = () => stopFollowing.current();
    instance.on("dragstart", manual);
    instance.on("zoomstart", manual);
    const surface = container.current;
    surface.addEventListener("wheel", manual, { passive: true });
    const key = (event: KeyboardEvent) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(event.key)) manual(); };
    surface.addEventListener("keydown", key);
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); surface.removeEventListener("wheel", manual); surface.removeEventListener("keydown", key); instance.remove(); map.current = null; };
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
      name.style.color = riderColor(marker.id);
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
      const place = placeLabel(marker.latitude, marker.longitude);
      label.append(place.element);
      const badge = document.createElement("div");
      badge.style.cssText = "display:flex;align-items:center;gap:6px;width:max-content;max-width:180px;padding:6px 9px;background:white;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 2px 5px #0002;font:600 12px system-ui;color:#0f172a";
      const dot = document.createElement("span");
      dot.style.cssText = "width:10px;height:10px;border-radius:50%;flex-shrink:0;background:" + riderColor(marker.id);
      const title = document.createElement("span"); title.textContent = marker.name;
      title.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      badge.style.borderColor = riderColor(marker.id);
      if (marker.status !== "Suivi actif") {
        badge.style.borderStyle = "dashed";
        const state = document.createElement("span");
        state.textContent = marker.status === "Arrêté" ? " · arrêté" : " · ancien";
        state.style.cssText = "font-size:10px;color:#64748b";
        title.append(state);
      }
      badge.append(dot, title);
      const pin = L.marker(position, {
        icon: L.divIcon({ html: badge, className: "rider-name-marker", iconSize: [180, 30], iconAnchor: [14, 15], popupAnchor: [0, -14] }),
        title: marker.name + " — voir les informations", alt: marker.name, keyboard: true,
        ...{ riderId: marker.id },
      }).bindPopup(label).addTo(group);
      pin.on("click", () => { void place.load(); });
      if (openId === marker.id) pin.openPopup();
      if (markers.length === 1) L.circle(position, { interactive: false, radius: marker.accuracy, color: riderColor(marker.id), weight: 1, fillOpacity: 0.06 }).addTo(group);
    }
    for (const segment of trackSegments(points)) {
      const positions: L.LatLngExpression[] = segment.map(point => [point.latitude, point.longitude]);
      coords.push(...positions);
      const label = document.createElement("span");
      label.textContent = riderNames[segment[0].riderId] || "Livreur";
      if (positions.length > 1) L.polyline(positions, { color: riderColor(segment[0].riderId), weight: 4 }).bindTooltip(label).addTo(group);
      else L.circleMarker(positions[0], { radius: 4, color: riderColor(segment[0].riderId) }).bindTooltip(label).addTo(group);
    }
    bounds.current = coords.length ? L.latLngBounds(coords) : null;
    if (bounds.current && fitted.current !== viewKey) {
      map.current.fitBounds(bounds.current, { padding: [35, 35], maxZoom: 16 });
      fitted.current = viewKey;
    }
  }, [markers, points, viewKey, riderNames]);
  useEffect(() => {
    const target = markers.find(marker => marker.id === followId);
    if (target && map.current) map.current.panTo([target.latitude, target.longitude], { animate: false });
  }, [markers, followId]);
  useEffect(() => {
    const group = cursorLayer.current;
    if (!group) return;
    group.clearLayers();
    const point = points[cursor];
    if (!point) return;
    const label = document.createElement("div");
    label.textContent = (riderNames[point.riderId] || "Livreur") + " · " + new Date(point.capturedAt).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" }) + " · précision ±" + Math.round(point.accuracy) + " m";
    const place = placeLabel(point.latitude, point.longitude);
    label.append(place.element);
    L.circleMarker([point.latitude, point.longitude], { radius: 8, color: "#fff", weight: 2, fillColor: riderColor(point.riderId), fillOpacity: 1 }).bindPopup(label).on("click", () => { void place.load(); }).addTo(group);
  }, [points, cursor, riderNames]);
  useEffect(() => {
    const group = viewerLayer.current;
    if (!group || !map.current) return;
    group.clearLayers(); viewerBounds.current = null;
    if (!viewerPosition) return;
    const start: L.LatLngExpression = [viewerPosition.latitude, viewerPosition.longitude];
    const label = document.createElement("strong"); label.textContent = "Ma position";
    L.circleMarker(start, { radius: 9, color: "#fff", weight: 2, fillColor: "#0284c7", fillOpacity: 1 }).bindTooltip(label, { permanent: true, direction: "top" }).addTo(group);
    L.circle(start, { radius: viewerPosition.accuracy, color: "#0284c7", weight: 1, fillOpacity: 0.06, interactive: false }).addTo(group);
    const positions: L.LatLngExpression[] = [start];
    if (destination) {
      const end: L.LatLngExpression = [destination.latitude, destination.longitude];
      positions.push(end);
      const label = document.createElement("span"); label.textContent = "Liaison à vol d’oiseau vers " + destination.name;
      L.polyline([start, end], { color: "#0284c7", weight: 3, dashArray: "7 7" }).bindTooltip(label).addTo(group);
    }
    viewerBounds.current = L.latLngBounds(positions);
  }, [viewerPosition, destination]);
  return <div className="relative overflow-hidden rounded-lg border border-slate-200">
    <div ref={container} className="h-[55vh] min-h-[320px] w-full lg:h-[65vh]" style={{ zIndex: 0 }} aria-label="Carte des positions des livreurs" />
    {viewerPosition && <button type="button" className="absolute bottom-8 right-3 z-10 rounded-md bg-white px-3 py-2 text-xs font-semibold shadow" onClick={() => { onStopFollowing(); if (map.current && viewerBounds.current) map.current.fitBounds(viewerBounds.current, { padding: [40, 40], maxZoom: 16 }); }}>{destination ? "Voir les deux positions" : "Centrer sur moi"}</button>}
    <button type="button" className="absolute right-3 top-3 z-10 rounded-md bg-white px-3 py-2 text-xs font-semibold shadow" onClick={() => { onStopFollowing(); if (map.current && bounds.current) map.current.fitBounds(bounds.current, { padding: [35, 35], maxZoom: 16 }); }}>Recentrer</button>
  </div>;
}
