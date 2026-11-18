'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { AnnouncementBannerLogo, AnnouncementCopy } from '@quill/shared';
import { INTEGRATION_NAMES, IntegrationMark } from '@/components/integration-logos';
import { buttonVariants } from '@/components/ui/button';
import { captureAnnouncementSeen, markAnnouncementSurface } from '@/components/announcement/announcement-client';
import { BannerChip, HomeBannerFrame } from './home-banner';

/**
 * An announcement's banner in the Home's top row, beside the agents banner:
 * the announcement's title and line, the marks of what it announces sliding
 * like the agent chips (the same marquee, still under reduced motion), and
 * its button. No close button: like the agents banner, it stays for as long
 * as the announcement runs, after the pop-up was closed too.
 *
 * Neutral where the agents banner is green: the green is the one invitation
 * colour of the dashboard (the rail follows the same rule), and two green
 * blocks side by side would read as one thing said twice.
 */
export function IntegrationsBanner({
  id,
  copy,
  cta,
  logos,
}: {
  id: string;
  copy: AnnouncementCopy;
  cta: string;
  logos: readonly AnnouncementBannerLogo[];
}) {
  useEffect(() => {
    captureAnnouncementSeen(id, 'banner');
  }, [id]);
  return (
    <HomeBannerFrame
      testId="home-announcement-banner"
      labelId="announcement-banner-title"
      title={copy.title}
      body={copy.body}
      marqueeTestId="home-announcement-marquee"
      chipsLabel={logos.map((l) => INTEGRATION_NAMES[l]).join(', ')}
      chips={logos.map((logo) => (
        <BannerChip key={logo}>
          <IntegrationMark logo={logo} size={18} />
          {INTEGRATION_NAMES[logo]}
        </BannerChip>
      ))}
      cta={
        <Link
          href={cta}
          data-testid="home-announcement-banner-cta"
          onClick={() => markAnnouncementSurface('banner')}
          className={`${buttonVariants({ variant: 'default' })} shrink-0`}
        >
          {copy.cta}
          <i aria-hidden className="pi pi-arrow-right" style={{ fontSize: 12 }} />
        </Link>
      }
      tone="neutral"
    />
  );
}
