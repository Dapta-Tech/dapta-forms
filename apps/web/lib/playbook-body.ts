/**
 * The shape of a playbook's body past its markdown: where the closing "do it
 * with a dForms template" section starts. Shared by the reader and by the
 * script that makes the PDFs (`scripts/playbook-pdfs.mjs`), so both cut a
 * playbook in the same place.
 */
import { inlineText, type Block } from './markdown';
import { headingId } from './playbooks';

/** The anchor of the closing section, the one done with a dForms template. */
export const DO_IT_ID = 'hazlo-con-dforms';

/** That section's heading as each language writes it: "Hazlo con dForms", "Do it with dForms". */
const DO_IT_HEADINGS = new Set([DO_IT_ID, 'do-it-with-dforms']);

/**
 * Splits the body at its closing "Hazlo con dForms" heading ("Do it with
 * dForms" in English): what comes before is the text, what comes after goes
 * in the template panel at the end (`heading` is that title as written, or
 * null when there is no such section). A playbook without that heading keeps
 * its whole body as text, and the reader's panel shows the button alone.
 */
export function splitDoIt(blocks: Block[]): { body: Block[]; doIt: Block[]; heading: string | null } {
  const i = blocks.findIndex((b) => b.kind === 'heading' && b.level <= 2 && DO_IT_HEADINGS.has(headingId(inlineText(b.text))));
  if (i < 0) return { body: blocks, doIt: [], heading: null };
  // Up to the next level-2 heading, should one ever follow it.
  const end = blocks.findIndex((b, j) => j > i && b.kind === 'heading' && b.level <= 2);
  const stop = end < 0 ? blocks.length : end;
  return {
    body: [...blocks.slice(0, i), ...blocks.slice(stop)],
    doIt: blocks.slice(i + 1, stop),
    heading: (blocks[i] as { text: string }).text,
  };
}
