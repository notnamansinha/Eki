import React, { useRef, useEffect, useState } from 'react';
import { RouteData } from '@/hooks/useRoutes';
import { Navigation, Clock, Activity, MapPin } from 'lucide-react';

interface RouteCarouselProps {
  routes: RouteData[];
  selectedRouteId: string;
  onSwipe: (id: string) => void;
  onClick: (id: string) => void;
  getActiveBusesCount: (routeId: string) => number;
}

export default function RouteCarousel({ routes, selectedRouteId, onSwipe, onClick, getActiveBusesCount }: RouteCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const scrollTimeout = useRef<NodeJS.Timeout>();
  const [activeIndex, setActiveIndex] = useState(
    Math.max(0, routes.findIndex(r => r.id === selectedRouteId))
  );

  // Update active index based on scroll position
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    let timeoutId: NodeJS.Timeout;

    const handleScroll = () => {
      if (isProgrammaticScroll.current) return;

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        // Find the card closest to the center
        let closestIdx = 0;
        let minDiff = Infinity;
        const center = container.scrollLeft + container.clientWidth / 2;

        Array.from(container.children).forEach((child, i) => {
          const childCenter = (child as HTMLElement).offsetLeft + (child as HTMLElement).offsetWidth / 2;
          const diff = Math.abs(childCenter - center);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = i;
          }
        });

        if (closestIdx !== activeIndex) {
          setActiveIndex(closestIdx);
          onSwipe(routes[closestIdx].id);
        }
      }, 50);
    };

    container.addEventListener('scroll', handleScroll);
    // Call once to initialize without debounce
    handleScroll();

    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(timeoutId);
    };
  }, [activeIndex, routes, onSwipe]);

  // Initial scroll to selected if changed externally
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const index = routes.findIndex(r => r.id === selectedRouteId);
    if (index !== -1 && index !== activeIndex) {
      isProgrammaticScroll.current = true;
      setActiveIndex(index);
      const child = container.children[index] as HTMLElement;
      if (child) {
        container.scrollTo({
          left: child.offsetLeft - (container.clientWidth - child.offsetWidth) / 2,
          behavior: 'smooth'
        });
      }
      
      // Reset programmatic scroll flag after animation is likely done
      clearTimeout(scrollTimeout.current);
      scrollTimeout.current = setTimeout(() => {
        isProgrammaticScroll.current = false;
      }, 500);
    }
  }, [selectedRouteId, routes, activeIndex]);

  const handleCardClick = (index: number, id: string) => {
    if (index !== activeIndex) {
      onSwipe(id);
    } else {
      onClick(id);
    }
  };

  if (routes.length === 0) return null;

  return (
    <div className="w-full flex flex-col items-center">
      <div
        ref={scrollRef}
        className="w-full flex overflow-x-auto snap-x snap-mandatory hide-scrollbar pb-2 -mx-6"
        style={{
          scrollBehavior: 'smooth',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          paddingInline: routes.length === 1 ? '24px' : '8%',
          gap: '12px'
        }}
      >
        {routes.map((route, i) => {
          const isSelected = i === activeIndex;
          const activeBuses = getActiveBusesCount(route.id);
          const routeColor = route.color || "var(--accent)";
          const stops = route.stops ?? [];
          const durationMins = route.duration ? Math.round(parseInt(route.duration) / 60) : (stops.length * 2); // Fallback estimation
          const scheduleTime = new Date(Date.now() + durationMins * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          return (
            <div
              key={route.id}
              className="snap-center shrink-0 flex items-stretch transition-all duration-300 ease-out"
              style={{
                width: routes.length === 1 ? '100%' : '84%',
                opacity: isSelected ? 1 : 0.75,
                transform: isSelected ? 'scale(1)' : 'scale(0.95)',
              }}
              onClick={() => handleCardClick(i, route.id)}
            >
              <div
                className={`w-full text-left transition-all duration-300 rounded-[20px] p-5 border relative overflow-hidden flex flex-col min-h-[170px]`}
                style={{
                  background: isSelected ? "var(--surface-3)" : "var(--surface-2)",
                  borderColor: isSelected ? "var(--border-hover)" : "var(--border-subtle)",
                  boxShadow: isSelected ? "0 8px 32px rgba(0, 0, 0, 0.2)" : "0 4px 12px rgba(0, 0, 0, 0.05)",
                }}
              >
                {/* Premium Transit Edge Accent */}
                <div
                  className="absolute left-0 top-0 bottom-0 w-[4px]"
                  style={{
                    background: "linear-gradient(180deg, #5B3E8A 0%, #7A5C9B 100%)",
                    opacity: isSelected ? 1 : 0.2,
                    borderTopLeftRadius: "20px",
                    borderBottomLeftRadius: "20px"
                  }}
                />

                <div className="pl-2 flex flex-col h-full">

                  {/* Top Section: Title & Destination */}
                  <div className="mb-4">
                    <h3
                      className="text-route-name line-clamp-2"
                      style={{ color: "var(--text-primary)", textWrap: "balance" as any }}
                    >
                      {route.name}
                    </h3>
                  </div>

                  <div className="flex-grow" />

                  {/* Divider */}
                  <div className="w-full h-px opacity-50 mb-3" style={{ background: "var(--border-subtle)" }} />

                  {/* Journey Information Row */}
                  <div className="flex items-center justify-start w-full gap-3 mb-3 text-metadata whitespace-nowrap" style={{ color: "var(--text-tertiary)" }}>
                    <span>Scheduled: {scheduleTime}</span>
                    <span className="text-[10px] opacity-40">•</span>
                    <span>{stops.length} Stops</span>
                  </div>

                  {/* Divider */}
                  <div className="w-full h-px opacity-50 mb-3" style={{ background: "var(--border-subtle)" }} />

                  {/* Transit Metadata Chips */}
                  <div className="flex flex-wrap items-center justify-start gap-2">
                    <span className="px-2.5 py-1 rounded-lg text-chip uppercase tracking-widest whitespace-nowrap" style={{ background: "var(--surface-1)", color: "var(--text-secondary)" }}>
                      BUS
                    </span>
                    {activeBuses > 0 && (
                      <span className="px-2.5 py-1 rounded-lg text-chip uppercase tracking-widest flex items-center gap-1.5 whitespace-nowrap" style={{ background: "rgba(34, 197, 94, 0.1)", color: "var(--status-live)" }}>
                        <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--status-live)" }} />
                        Live
                      </span>
                    )}
                    {route.type === 'circular' && (
                      <span className="px-2.5 py-1 rounded-lg text-chip uppercase tracking-widest whitespace-nowrap" style={{ background: "var(--surface-1)", color: "var(--text-secondary)" }}>
                        Circular
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pagination Indicators */}
      {routes.length > 1 && (
        <div className="flex justify-center items-center gap-1.5 mt-5">
          {routes.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-300"
              style={{
                width: i === activeIndex ? '6px' : '4px',
                height: i === activeIndex ? '6px' : '4px',
                background: i === activeIndex ? "var(--text-primary)" : "var(--text-ghost)",
                opacity: i === activeIndex ? 1 : 0.3
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
