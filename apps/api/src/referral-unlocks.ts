import { Inject, Injectable } from '@nestjs/common';
import { isAccountReferralUnlocked, type Db } from '@quill/db';
import type { ReferralUnlocks } from './attribution.service';
import { DB } from './tokens';

/**
 * The badge rule's referral source, bound to `REFERRAL_UNLOCKS`: a workspace
 * is referral unlocked when any of its owners (an active owner row bound to
 * them) holds a referral unlock (`referrer.unlocked_at`). No expiry: unlike
 * the paid verdict, an unlock is never re-checked or aged out.
 *
 * Not gated on `REFERRAL_PROGRAM`: an unlock is earned for life, so switching
 * the program off stops new unlocks (no referral is credited) but keeps the
 * ones already earned. A deployment that never ran the program has none.
 */
@Injectable()
export class PersonReferralUnlocks implements ReferralUnlocks {
  constructor(@Inject(DB) private readonly db: Db) {}

  referralUnlocked(accountId: string): Promise<boolean> {
    return isAccountReferralUnlocked(this.db, accountId);
  }
}
