"use client";

import type { MouseEvent } from "react";
import { X } from "lucide-react";
import type { RouteStop } from "@/hooks/useRoutes";
import type { StopVisitState } from "@/lib/stopProgress";

export type PickerField = "boarding" | "destination";

export interface PickerStop {
  stop: RouteStop;
  index: number;
  /** Map letter, matching the markers. */
  letter: string;
  visit?: StopVisitState;
  /** Live ETA label from the map: "4 min", "Bus is here", "Passed"… */
  detail: string;
  /** Choosable in this list. */
  selectable: boolean;
}

interface Props {
  field: PickerField;
  listId: string;
  optionId: (index: number) => string;
  stops: PickerStop[];
  activeIndex?: number;
  /** Outline the active option: the keyboard is moving it. */
  showActive?: boolean;
  value: string;
  boardingStop?: RouteStop;
  boardingIndex: number;
  showPassed: boolean;
  onShowPassed: () => void;
  onChoose: (stopId: string) => void;
  onClose: () => void;
}

// Clicks inside the sheet keep focus on the combobox that owns it.
const keepFocus = (event: MouseEvent) => event.preventDefault();

function EtaLabel({ id, detail }: { id?: string; detail: string }) {
  const minutes = /^(\d+) min$/.exec(detail);
  if (minutes) {
    return <span id={id} className="pp-picker-eta"><span className="pp-eta">{minutes[1]}</span><span className="pp-eta-unit"> min</span></span>;
  }
  return <span id={id} className="pp-picker-eta"><span className="pp-picker-eta-text">{detail}</span></span>;
}

/**
 * The route timeline as a stop picker: the same rail, stops and live ETAs,
 * opened from the From → To bar. It is the listbox popup of the bar's two
 * comboboxes, so focus stays on the combobox and the keyboard moves the
 * active option (aria-activedescendant).
 */
export default function StopPickerSheet({
  field, listId, optionId, stops, activeIndex, showActive = false, value, boardingStop, boardingIndex, showPassed, onShowPassed, onChoose, onClose,
}: Props) {
  const passed = stops.filter(entry => entry.visit === "passed" || entry.visit === "unobserved");
  const collapsed = !showPassed && passed.length > 0;
  const visible = collapsed ? stops.filter(entry => !passed.includes(entry)) : stops;
  const title = field === "boarding" ? "Where are you boarding?" : "Where are you going?";
  const subtitle = field === "destination" && boardingStop ? `Stops after ${boardingStop.name}` : "Upcoming stops · live ETAs";
  const label = field === "boarding" ? "Boarding stop" : "Destination station";
  const lastIndex = stops.length > 0 ? stops[stops.length - 1].index : -1;

  return (
    <>
      <div className="pp-sheet-backdrop pp-picker-backdrop" aria-hidden="true" onMouseDown={keepFocus} onClick={onClose} />
      <div className="pp-sheet pp-picker" data-field={field} onMouseDown={keepFocus}>
        <div className="pp-grabber pp-picker-grabber" aria-hidden="true" />
        <div className="pp-picker-header">
          <div className="min-w-0">
            <p className="pp-picker-title" id={`${listId}-title`}>{title}</p>
            <p className="pp-picker-subtitle">{subtitle}</p>
          </div>
          <button type="button" className="pp-close" aria-label={`Close ${label.toLowerCase()} list`} onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="pp-picker-scroll">
          {collapsed && (
            <button type="button" className="pp-picker-row pp-picker-passed" aria-expanded={false} onClick={onShowPassed}>
              <span className="pp-picker-dot" data-state="passed" aria-hidden="true" />
              <span className="pp-picker-name">{passed.length} passed {passed.length === 1 ? "stop" : "stops"}</span>
            </button>
          )}
          <ul id={listId} role="listbox" aria-label={label} aria-describedby={`${listId}-title`} className="pp-picker-list">
            {visible.map(entry => {
              const { stop, index, visit, detail, selectable } = entry;
              const isBoarding = index === boardingIndex;
              const chosen = stop.id === value;
              const kicker = field === "destination" && isBoarding ? "Your stop"
                : visit === "at" ? "Bus is here"
                : visit === "next" ? "Next stop"
                : chosen ? field === "boarding" ? "Your stop" : "Destination"
                : index === lastIndex ? "Terminus" : undefined;
              const state = visit === "passed" || visit === "unobserved" ? "passed" : visit === "at" || visit === "next" ? "live" : "upcoming";
              const rowProps = {
                "data-state": state,
                "data-chosen": chosen || (field === "destination" && isBoarding) || undefined,
                "data-active": showActive && selectable && index === activeIndex ? true : undefined,
              };
              const body = <>
                <span className="pp-picker-dot" data-state={state} aria-hidden="true" />
                <span className="pp-picker-text">
                  {kicker && <span className="pp-picker-kicker" data-tone={kicker === "Your stop" || kicker === "Destination" ? "accent" : visit === "at" || visit === "next" ? "live" : undefined}>{kicker}</span>}
                  <span className="pp-picker-name">{stop.name}</span>
                </span>
                {!(field === "destination" && isBoarding) && <EtaLabel id={`${optionId(index)}-detail`} detail={detail} />}
              </>;
              // Every stop is listed, so the whole route reads the same as the
              // timeline; ones that cannot be chosen here are disabled options.
              return (
                <li
                  key={stop.id}
                  id={optionId(index)}
                  role="option"
                  aria-label={stop.name}
                  aria-describedby={field === "destination" && isBoarding ? undefined : `${optionId(index)}-detail`}
                  aria-selected={chosen}
                  aria-disabled={!selectable || undefined}
                  className="pp-picker-row"
                  data-disabled={(!selectable && !(field === "destination" && isBoarding)) || undefined}
                  data-context={!selectable || undefined}
                  onClick={selectable ? () => onChoose(stop.id) : undefined}
                  {...rowProps}
                >
                  {body}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}
