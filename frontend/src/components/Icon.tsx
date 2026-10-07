import { JSX } from "solid-js";
import { LOCK_PATH } from "../iconPaths";

// The app's icon set: hand-picked inline SVGs on a 16 px grid, stroked with
// currentColor so they follow the theme and the surrounding text color. No icon
// font, no icon package — add a shape here when a new one is needed.
const SHAPES = {
  chevron: () => <path d="M6 4l4 4-4 4" />,
  folder: () => <path d="M1.75 4.25c0-.55.45-1 1-1h3.4l1.5 1.5h5.6c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H2.75c-.55 0-1-.45-1-1z" />,
  "folder-open": () => (
    <>
      <path d="M1.75 12.5V4.25c0-.55.45-1 1-1h3.4l1.5 1.5h4.6c.55 0 1 .45 1 1V7" />
      <path d="M1.75 12.75L3.6 7.6c.1-.3.4-.5.7-.5h9.45c.35 0 .6.35.48.68l-1.7 4.55c-.1.3-.4.42-.7.42z" />
    </>
  ),
  plus: () => <path d="M8 3v10M3 8h10" />,
  dots: () => (
    <g fill="currentColor" stroke="none">
      <circle cx="3.5" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.5" cy="8" r="1.25" />
    </g>
  ),
  pencil: () => <path d="M10.75 2.75l2.5 2.5-7.5 7.5-3.25.75.75-3.25zM9.25 4.25l2.5 2.5" />,
  trash: () => <path d="M2.5 4.5h11M6.25 4.5V3h3.5v1.5M4 4.5l.65 8.55c.04.53.48.95 1.02.95h4.66c.54 0 .98-.42 1.02-.95L12 4.5M6.75 7v4.5M9.25 7v4.5" />,
  duplicate: () => (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.75c0-.69-.56-1.25-1.25-1.25h-5.5c-.69 0-1.25.56-1.25 1.25v5.5c0 .69.56 1.25 1.25 1.25H5.5" />
    </>
  ),
  close: () => <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />,
  search: () => (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.25 10.25L13.5 13.5" />
    </>
  ),
  // Collapse all / expand all: chevrons pointing in / out.
  collapse: () => <path d="M5 2.75L8 5.75l3-3M5 13.25L8 10.25l3 3" />,
  expand: () => <path d="M5 5.75L8 2.75l3 3M5 10.25L8 13.25l3-3" />,
  lock: () => <path d={LOCK_PATH} />,
  // Show / hide a password.
  eye: () => (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  "eye-off": () => (
    <>
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
      <path d="M2.5 13.5l11-11" />
    </>
  ),
  // History: a clock face.
  history: () => (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 4.75V8l2.25 1.5" />
    </>
  ),
  download: () => <path d="M8 2.5v7.5M4.75 6.75L8 10l3.25-3.25M3 12.75h10" />,
  // The 24-unit gear outline, scaled onto the 16 grid (stroke 2 → 1.33 px).
  settings: () => (
    <g transform="scale(0.6667)" stroke-width="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </g>
  ),
} satisfies Record<string, () => JSX.Element>;

export type IconName = keyof typeof SHAPES;

interface Props {
  name: IconName;
  class?: string;
  size?: number;
}

export default function Icon(props: Props) {
  return (
    <svg class={`icon ${props.class ?? ""}`} width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true">
      {SHAPES[props.name]()}
    </svg>
  );
}
