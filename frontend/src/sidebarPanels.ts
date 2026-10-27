// The sidebar's bottom area: a stack of collapsible sections docked under the
// tree, in a fixed order — Webhooks, then Proxies. Pure rules (unit-tested in
// sidebarPanels.test.ts); SidebarPanels.tsx renders them and persists the state
// per project (Go: GetSidebarPanels / SetSidebarPanels).
//
// Collapsed sections are one bar each. While ANY section is expanded the area has
// the stored height (a fraction of the sidebar, clamped by webhookModel.clampPanel:
// area ≥ 120 px, tree ≥ 160 px) and the expanded sections split what is left
// after the bars equally; with none expanded the area is just the bars.
import { panelHeight, PANEL_DEFAULT_FRACTION } from "./webhookModel";

export type Section = "webhooks" | "proxies";

export const SECTIONS: Section[] = ["webhooks", "proxies"];

export interface PanelState {
  webhooks: boolean;
  proxies: boolean;
  fraction: number;
}

export const DEFAULT_PANELS: PanelState = { webhooks: false, proxies: false, fraction: PANEL_DEFAULT_FRACTION };

export const anyExpanded = (s: PanelState) => s.webhooks || s.proxies;

// The area's height in px, or undefined for "just the bars" (none expanded).
export const areaHeight = (s: PanelState, total: number): number | undefined =>
  anyExpanded(s) ? panelHeight(s.fraction, total) : undefined;

export const toggleSection = (s: PanelState, section: Section): PanelState => ({ ...s, [section]: !s[section] });

export const expandSection = (s: PanelState, section: Section): PanelState => (s[section] ? s : { ...s, [section]: true });

// What Go returned, made safe (an invalid fraction → the default).
export function normalizePanels(raw: Partial<PanelState> | undefined): PanelState {
  const f = raw?.fraction;
  return {
    webhooks: !!raw?.webhooks,
    proxies: !!raw?.proxies,
    fraction: typeof f === "number" && f > 0 && f < 1 ? f : PANEL_DEFAULT_FRACTION,
  };
}
