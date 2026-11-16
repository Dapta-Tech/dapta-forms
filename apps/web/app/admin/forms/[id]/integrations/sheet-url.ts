/**
 * The address of a spreadsheet, for the link back to it from the editor.
 *
 * There is deliberately no parser beside it. A spreadsheet reaches a form by
 * being created from the card or chosen in Google's Picker, never from a pasted
 * link: the app holds the `drive.file` scope, under which Google refuses a
 * spreadsheet it was never handed exactly as it refuses one that was deleted.
 */
export function sheetUrlFor(spreadsheetId: string, gid?: number | null): string {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`;
  return gid == null ? base : `${base}#gid=${gid}`;
}
