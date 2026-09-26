'use client';

import { useId } from 'react';
import { MAX_SCREEN_SIZE } from '@quill/engine';
import { Switch } from '@/components/ui/switch';
import { InlineField } from './fields';
import { tb, type BuilderMessages } from './builder-messages';
import type { ScreenBlock, ScreenBoundary } from './screen-util';

/** Why a question cannot join the screen above it, in the builder's words. */
export function screenBlockReason(blocked: ScreenBlock, m: BuilderMessages): string {
  switch (blocked) {
    case 'first':
      return m.screens.first;
    case 'solo':
      return m.screens.soloType;
    case 'hidden':
      return m.screens.hidden;
    default:
      return tb(m.screens.max, { max: MAX_SCREEN_SIZE });
  }
}

/**
 * The question settings' "Show on the same screen as the question above"
 * (#200): the spine's boundary toggle as a switch, the only way to group below
 * lg, where the spine is hidden. A boundary that cannot be joined keeps the
 * switch in the Tab order, announced as unavailable and described by the
 * reason shown under it, and a click does nothing; splitting is always
 * possible.
 */
export function ScreenJoinField({
  boundary,
  onJoin,
  m,
}: {
  boundary: ScreenBoundary;
  onJoin: (joined: boolean) => void;
  m: BuilderMessages;
}) {
  const hintId = useId();
  const blocked = boundary.joined ? null : boundary.blocked;
  return (
    <InlineField label={m.screens.join} hint={blocked ? screenBlockReason(blocked, m) : undefined} hintId={hintId}>
      <Switch
        checked={boundary.joined}
        onCheckedChange={onJoin}
        aria-disabled={blocked ? true : undefined}
        aria-describedby={blocked ? hintId : undefined}
        data-testid="behavior-screen-join"
        aria-label={m.screens.join}
      />
    </InlineField>
  );
}
