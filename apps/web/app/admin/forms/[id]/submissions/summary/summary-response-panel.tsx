'use client';

/**
 * The response panel, opened from the Summary: a click on an answer in a text
 * card shows that whole response right there, without leaving for the table.
 *
 * The same pieces as the Responses view (`Drawer`, `PanelHeader`,
 * `ResponseDetailView`), composed here rather than through `ResponsesViewer`,
 * which is built around a page of table rows it already holds. The Summary
 * holds only ids, so each response is fetched on demand through an
 * account-scoped read, and kept once read. The arrows walk the answers listed
 * in the card the panel was opened from, and the panel lands on that card's
 * question, outlined.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t } from '@quill/shared';
import { Drawer } from '@/components/drawer';
import { inNestedDialog } from '@/components/modal';
import { callAction, isTransportError } from '@/lib/call-action';
import type { ResponseDetail } from '../response-detail';
import { PanelHeader, ResponseDetailView, type PanelLabels } from '../response-panel';
import type { FileButtonLabels } from '../submission-file-button';
import { summaryResponseAction } from './actions';

const LABEL_ID = 'response-panel-title';

/**
 * Open the response at `index` of `ids` (the answers a card lists), landing on
 * the question `stepKey`. Resolves false when it could not be read (deleted
 * since the page loaded, or the connection dropped), so the card can say so.
 */
type OpenResponse = (ids: string[], index: number, stepKey: string) => Promise<boolean>;

const OpenContext = createContext<OpenResponse>(async () => false);

export function useOpenResponse(): OpenResponse {
  return useContext(OpenContext);
}

interface Walk {
  ids: string[];
  index: number;
  stepKey: string;
  /** The response at `index`, once read. */
  detail: ResponseDetail;
}

export function SummaryResponsePanel({
  formId,
  labels,
  fileLabels,
  children,
}: {
  formId: string;
  labels: PanelLabels;
  fileLabels: FileButtonLabels;
  children: ReactNode;
}) {
  const [walk, setWalk] = useState<Walk | null>(null);
  const [open, setOpen] = useState(false);
  /** Every response read so far: walking back and forth fetches each one once. */
  const cache = useRef(new Map<string, ResponseDetail>());

  /** The response, from the cache or the API; null when it cannot be read. */
  const load = useCallback(
    async (id: string): Promise<ResponseDetail | null> => {
      const hit = cache.current.get(id);
      if (hit) return hit;
      const res = await callAction(() => summaryResponseAction(formId, id));
      if (isTransportError(res) || !res.ok) return null;
      cache.current.set(id, res.detail);
      return res.detail;
    },
    [formId],
  );

  /**
   * Every open and every step is numbered, and only the latest may show its
   * response: a slow read that lands late must not cover the one asked for
   * after it (a second answer clicked, or the arrows pressed again).
   */
  const seq = useRef(0);
  /**
   * Where the panel is headed: moved at once by each step, so two quick
   * presses go two responses on even while the first is still being read.
   */
  const target = useRef<Omit<Walk, 'detail'> | null>(null);
  /** Where the panel actually is: what `target` falls back to when a read fails. */
  const shownRef = useRef<Omit<Walk, 'detail'> | null>(null);

  const openAt = useCallback<OpenResponse>(
    async (ids, index, stepKey) => {
      const mine = ++seq.current;
      target.current = { ids, index, stepKey };
      const id = ids[index];
      const detail = id ? await load(id) : null;
      // Overtaken by a later open: not a failure, just no longer wanted.
      if (mine !== seq.current) return true;
      if (!detail) {
        target.current = shownRef.current;
        return false;
      }
      shownRef.current = { ids, index, stepKey };
      setWalk({ ids, index, stepKey, detail });
      setOpen(true);
      return true;
    },
    [load],
  );

  const go = useCallback(
    async (delta: number) => {
      const from = target.current;
      if (!from) return;
      const index = from.index + delta;
      const id = from.ids[index];
      if (!id) return;
      const mine = ++seq.current;
      target.current = { ...from, index };
      const detail = await load(id);
      if (mine !== seq.current) return;
      // A response deleted since the card loaded leaves the panel where it was.
      if (!detail) {
        target.current = shownRef.current;
        return;
      }
      shownRef.current = { ...from, index };
      setWalk({ ...from, index, detail });
    },
    [load],
  );

  // Closing keeps `walk`, so the drawer keeps drawing this response while it slides out.
  const shown = walk?.detail ?? null;
  const shownId = shown?.id;

  // Up / Down walk the card's answers, like the arrows in the header and like
  // the Responses view. Not while a dialog opened from the panel has the keys
  // (a file preview), and not inside the scrolling body, where they scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const panel =
        document.getElementById(LABEL_ID)?.closest<HTMLElement>('[role="dialog"]') ?? null;
      if (inNestedDialog(e.target, panel)) return;
      if (
        e.target instanceof Element &&
        e.target.closest('[data-drawer-body], input, textarea, select')
      )
        return;
      e.preventDefault();
      void go(e.key === 'ArrowUp' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  // Land on the card's question, never at the scroll depth of the response before.
  useEffect(() => {
    if (!open || !shownId) return;
    const body = document.querySelector<HTMLElement>('[data-drawer-body]');
    const scroller = body?.parentElement;
    if (!body || !scroller) return;
    const target = walk
      ? body.querySelector<HTMLElement>(`[data-answer-key="${CSS.escape(walk.stepKey)}"]`)
      : null;
    if (!target) {
      scroller.scrollTo({ top: 0 });
      return;
    }
    // Measured, not `scrollIntoView`: that would also scroll the drawer's clipped ancestors.
    const top =
      target.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 16) });
  }, [open, shownId, walk]);

  return (
    <OpenContext.Provider value={openAt}>
      {children}
      <Drawer
        open={open && shown != null}
        onClose={() => setOpen(false)}
        labelId={LABEL_ID}
        header={
          shown && walk ? (
            <PanelHeader
              detail={shown}
              position={t(labels.responsePosition, { n: walk.index + 1, total: walk.ids.length })}
              hasPrev={walk.index > 0}
              hasNext={walk.index < walk.ids.length - 1}
              onPrev={() => void go(-1)}
              onNext={() => void go(1)}
              onClose={() => setOpen(false)}
              labels={labels}
            />
          ) : null
        }
      >
        {shown ? (
          <ResponseDetailView
            detail={shown}
            formId={formId}
            labels={labels}
            fileLabels={fileLabels}
            focusKey={walk?.stepKey ?? null}
          />
        ) : null}
      </Drawer>
    </OpenContext.Provider>
  );
}
