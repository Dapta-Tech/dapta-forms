'use client';

import { createContext, useContext } from 'react';
import type { ReferralSurface } from './use-referral-copy';

/**
 * Opens the referral dialog that the admin shell owns, from anywhere under it
 * (the locked badge switch in Brand kit and the Design panel). Null outside
 * the shell, or while the program is off: callers then offer no button.
 */
export const ReferralDialogContext = createContext<((surface: ReferralSurface) => void) | null>(null);

export function useOpenReferralDialog(): ((surface: ReferralSurface) => void) | null {
  return useContext(ReferralDialogContext);
}
