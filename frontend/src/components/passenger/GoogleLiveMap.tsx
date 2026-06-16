"use client";

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import 'leaflet/dist/leaflet.css';

// Leaflet needs to be dynamically imported or we get window is not defined
const MapContainer = dynamic(() => import('react-leaflet').then((mod) => mod.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import('react-leaflet').then((mod) => mod.TileLayer), { ssr: false });
const Marker = dynamic(() => import('react-leaflet').then((mod) => mod.Marker), { ssr: false });
const Polyline = dynamic(() => import('react-leaflet').then((mod) => mod.Polyline), { ssr: false });

interface Props {
  driverLocation: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  onMapClick?: (lat: number, lng: number) => void;
}

// Separate component for map events since it must be inside MapContainer
function MapClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  const [useMapEvents, setUseMapEvents] = useState<any>(null);

  useEffect(() => {
    import('react-leaflet').then((mod) => {
      setUseMapEvents(() => mod.useMapEvents);
    });
  }, []);

  if (useMapEvents) {
    const MapEventsHook = () => {
      useMapEvents({
        click(e: any) {
          if (onMapClick) onMapClick(e.latlng.lat, e.latlng.lng);
        },
      });
      return null;
    };
    return <MapEventsHook />;
  }
  return null;
}

export default function GoogleLiveMap({ driverLocation, destination, onMapClick }: Props) {
  const [etaInfo, setEtaInfo] = useState<{ duration_in_traffic: string; distance: string } | null>(null);

  // Fix Leaflet default icon paths issue
  useEffect(() => {
    import('leaflet').then((L) => {
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
        iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
      });
    });
  }, []);

  useEffect(() => {
     if (driverLocation && destination) {
       // Mocking ETA since Google Directions is disabled
       setEtaInfo({
         duration_in_traffic: "ETA N/A",
         distance: "Distance N/A"
       });
     } else {
       setEtaInfo(null);
     }
  }, [driverLocation, destination]);

  const center = driverLocation || { lat: 23.0347, lng: 72.5483 };

  return (
    <div className="relative h-full w-full rounded-xl overflow-hidden shadow-lg border border-white/10" style={{ minHeight: '400px' }}>
      {typeof window !== 'undefined' && (
        <MapContainer
          center={[center.lat, center.lng]}
          zoom={14}
          style={{ height: '100%', width: '100%', position: 'absolute', inset: 0 }}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <MapClickHandler onMapClick={onMapClick} />

          {driverLocation && (
            <Marker position={[driverLocation.lat, driverLocation.lng]} />
          )}
          {destination && (
            <Marker position={[destination.lat, destination.lng]} />
          )}
          {driverLocation && destination && (
            <Polyline 
               positions={[
                 [driverLocation.lat, driverLocation.lng], 
                 [destination.lat, destination.lng]
               ]} 
               pathOptions={{ color: '#2563EB', weight: 6, opacity: 0.8 }} 
            />
          )}
        </MapContainer>
      )}
      
      {/* Floating ETA Details */}
      {etaInfo && (
        <div className="absolute bottom-6 left-6 bg-white/90 backdrop-blur-md p-4 rounded-xl shadow-xl border border-gray-100 flex flex-col pointer-events-none z-[1000]">
          <span className="text-xs font-bold tracking-wider text-gray-500 uppercase mb-1">Live Status</span>
          <div className="flex items-end gap-3">
             <span className="text-3xl font-extrabold text-blue-600">{etaInfo.duration_in_traffic || '--'}</span>
             <span className="text-sm text-gray-600 mb-1">{etaInfo.distance} remaining</span>
          </div>
        </div>
      )}
    </div>
  );
}
