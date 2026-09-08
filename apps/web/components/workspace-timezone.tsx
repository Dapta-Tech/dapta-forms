"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * The workspace's timezone for CLIENT components that print a date. Server
 * components read it from `/v1/me` directly; this carries the same value down
 * to the client tree so both sides format the same instant the same way
 * (null → UTC, deterministic, so hydration never disagrees).
 */
const WorkspaceTimeZoneContext = createContext<string>("UTC");

export function WorkspaceTimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string | null | undefined;
  children: ReactNode;
}) {
  return (
    <WorkspaceTimeZoneContext.Provider value={timeZone || "UTC"}>
      {children}
    </WorkspaceTimeZoneContext.Provider>
  );
}

/** The workspace zone, `'UTC'` when unset or outside the provider. */
export function useWorkspaceTimeZone(): string {
  return useContext(WorkspaceTimeZoneContext);
}
