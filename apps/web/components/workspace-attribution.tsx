'use client';

import { createContext, useContext, type ReactNode } from 'react';

/**
 * Whether this WORKSPACE's public surfaces carry the "Made with dForms"
 * attribution, for client components deep in the dashboard that draw a copy
 * of one (the email preview's growth button). The value is the API's answer
 * (`/v1/me` `attribution.showing`), provided once by the admin layout, so no
 * client re-derives it. Outside the provider it reads true: exactly as before
 * the setting existed.
 */
const WorkspaceAttributionContext = createContext<boolean>(true);

export function WorkspaceAttributionProvider({ showing, children }: { showing: boolean; children: ReactNode }) {
  return <WorkspaceAttributionContext.Provider value={showing}>{children}</WorkspaceAttributionContext.Provider>;
}

/** True when the workspace's surfaces carry the attribution (true outside the provider). */
export function useWorkspaceAttribution(): boolean {
  return useContext(WorkspaceAttributionContext);
}
