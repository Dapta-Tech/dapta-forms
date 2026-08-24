'use client';

import { useEffect, useState } from 'react';
import type { FormOption, FormOptionLayout } from '@quill/engine';
import { isDerivedOptionValue } from '@quill/engine';
import { Button } from '@/components/ui/button';
import { HelpTip } from '@/components/ui/help-tip';
import { TextField, NumberField } from './fields';
import { IconPicker } from './icon-picker';
import { OptionsImportModal } from './options-import-modal';
import { SortableList, SortableRow } from './sortable';
import type { EditorMessages } from './messages';

/**
 * Editor for a choice/dropdown step's options: label, points and an optional
 * icon, drag-reorderable. No native scrollbars; the whole panel scrolls with
 * the page.
 *
 * The stored `value` is behind "Advanced" rather than beside the label. It is a
 * second text box that most authors have no reason to think about: it fills
 * itself from the label, and the ones who did notice it mostly read it as
 * something they were supposed to fill in. Hiding it makes the row say what the
 * row is for.
 *
 * It opens on its own when any value has stopped tracking its label, so a value
 * somebody chose deliberately - to match a CRM enum, say - is never hidden from
 * the person who chose it, and a form whose values are frozen because it is
 * published shows them rather than implying they still follow.
 */
export function OptionsEditor({
  options,
  onChange,
  onLabelChange,
  onValueChange,
  locked,
  showPoints = true,
  showIcon = false,
  layout = 'list',
  m,
}: {
  options: FormOption[];
  onChange: (next: FormOption[]) => void;
  /**
   * Write one option's label. Separate from `onChange` because the `value` may
   * follow the label, and the value is pointed at from outside this step
   * (conditions on other steps, outcome overrides), which an options-array
   * patch cannot reach. See `setOptionLabel` in the engine.
   */
  onLabelChange: (index: number, label: string) => void;
  /**
   * Rewrite one option's stored value by hand. Also separate from `onChange`:
   * a value is pointed at from outside this step, so moving it is a rename, not
   * a field edit. Committed on blur rather than per keystroke, because each
   * commit rewrites those pointers across the whole config.
   */
  onValueChange: (index: number, value: string) => void;
  /** Values this form may no longer move (published, or mapped to a CRM enum). */
  locked: ReadonlySet<string>;
  /**
   * Render the Points column (V5-B6). Hidden while this question is not scored,
   * so the row shows the two fields that always matter instead of a column that
   * does nothing — and each remaining field gets the width back.
   */
  showPoints?: boolean;
  /**
   * Render the Icon field. Choice questions draw an icon in BOTH layouts (a
   * list row shows an emoji or initials where the radio would be), so this
   * tracks the question type, not the layout.
   */
  showIcon?: boolean;
  /** Gates which icon kinds the picker offers — images are card-only. */
  layout?: FormOptionLayout;
  m: EditorMessages['options'];
}) {
  const ids = options.map((_, i) => `opt-${i}`);
  const [importOpen, setImportOpen] = useState(false);
  // Open from the start when a value has stopped tracking its label, and
  // stay open once opened. Not derived on every render: an author who opens
  // the section and then edits a label back into alignment should not have the
  // box they are typing in vanish under the cursor.
  const [advanced, setAdvanced] = useState(() => options.some((o) => !isDerivedOptionValue(o)));
  // Explains why the values below are not moving with the labels. Only shown
  // when a value on THIS question is actually held, so an unpublished form
  // never reads a warning about a rule that is not applying to it.
  const hasLocked = options.some((o) => locked.has(o.value));

  function update(index: number, patch: Partial<FormOption>) {
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }
  function remove(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }
  function add() {
    const n = options.length + 1;
    onChange([...options, { label: `Option ${n}`, value: `option_${n}`, points: 0 }]);
  }
  function reorder(from: number, to: number) {
    const next = [...options];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2">
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{m.empty}</p>
      ) : (
        <SortableList ids={ids} onReorder={reorder} className="flex flex-col gap-2">
          {(id, index) => {
            const o = options[index];
            if (!o) return null;
            return (
              <SortableRow key={id} id={id}>
                {({ handleProps }) => (
                  // Icon gets its OWN row rather than a fifth column: the panel
                  // is ~420px, and squeezing label/value/icon/points side by
                  // side clipped every header and cut the labels to 3 letters.
                  <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2">
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      aria-label={m.title}
                      className="mb-1.5 shrink-0 cursor-grab touch-none rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
                      {...handleProps}
                    >
                      <i aria-hidden className="pi pi-bars" style={{ fontSize: 13 }} />
                    </button>
                    <label className="flex min-w-0 flex-[2] flex-col gap-1">
                      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        {m.label}
                        <HelpTip text={m.labelHelp} label={m.label} />
                      </span>
                      <TextField
                        value={o.label}
                        onChange={(e) => onLabelChange(index, e.target.value)}
                      />
                    </label>
                    {showPoints ? (
                      <label className="flex w-20 shrink-0 flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">{m.points}</span>
                        <NumberField
                          aria-label={m.points}
                          data-testid={`option-points-${index}`}
                          value={o.points ?? 0}
                          onChange={(e) => update(index, { points: Number(e.target.value) || 0 })}
                        />
                      </label>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={m.remove}
                      onClick={() => remove(index)}
                      className="mb-0.5 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <i aria-hidden className="pi pi-trash" style={{ fontSize: 13 }} />
                    </Button>
                  </div>
                  {advanced ? (
                    // Its own row for the same reason the icon has one: the panel
                    // is ~420px and a third column in the label row clipped the
                    // value to eight characters, which is unreadable for the one
                    // field here whose exact characters are the point.
                    <div className="pl-7" data-testid={`option-value-${index}`}>
                      <OptionValueField
                        value={o.value}
                        locked={locked.has(o.value)}
                        taken={options.filter((_, i) => i !== index).map((x) => x.value)}
                        onRename={(next) => onValueChange(index, next)}
                        m={m}
                      />
                    </div>
                  ) : null}
                  {showIcon ? (
                    <div className="flex min-w-0 flex-col gap-1 pl-7" data-testid={`option-icon-${index}`}>
                      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        {m.icon}
                        <HelpTip text={m.iconHelp} label={m.icon} />
                      </span>
                      <IconPicker
                        value={o.icon}
                        label={o.label}
                        layout={layout}
                        onChange={(icon) => update(index, { icon })}
                        m={m}
                      />
                    </div>
                  ) : null}
                  </div>
                )}
              </SortableRow>
            );
          }}
        </SortableList>
      )}
      {showPoints ? (
        <p className="text-xs leading-relaxed text-muted-foreground" data-testid="option-points-hint">
          {m.pointsHint}
        </p>
      ) : null}
      {options.length > 0 ? (
        <button
          type="button"
          data-testid="options-advanced-toggle"
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
          className="flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <i
            aria-hidden
            className={`pi ${advanced ? 'pi-chevron-down' : 'pi-chevron-right'}`}
            style={{ fontSize: 10 }}
          />
          {m.advanced}
        </button>
      ) : null}
      {advanced && hasLocked ? (
        <p className="text-xs leading-relaxed text-muted-foreground" data-testid="options-value-locked">
          {m.valueLocked}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={add}>
          <i aria-hidden className="pi pi-plus" style={{ fontSize: 11 }} /> {m.add}
        </Button>
        <Button
          variant="outline"
          size="sm"
          data-testid="options-import-open"
          onClick={() => setImportOpen(true)}
        >
          <i aria-hidden className="pi pi-file-import" style={{ fontSize: 11 }} /> {m.importer.open}
        </Button>
      </div>
      <OptionsImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        options={options}
        onApply={onChange}
        scoringEnabled={showPoints}
        m={m.importer}
      />
    </div>
  );
}

/**
 * One option's stored value, editable by hand.
 *
 * Local text state committing on blur or Enter, the same shape as the step's
 * field-key editor and for the same reason: a commit rewrites every pointer
 * aimed at this value across the config, so doing it per keystroke would churn
 * the form (and the autosave) on the way to a name. It also makes a collision
 * refusable: typing `yes` while another option already stores it would merge two
 * distinct answers into one token, so it is rejected with a message rather than
 * silently mangled into `yes_2`.
 *
 * A locked value renders read-only instead of vanishing. Hiding it would leave
 * the author wondering where their value went; showing it greyed says the value
 * is real, it is theirs, and this form has gone too far to move it.
 */
function OptionValueField({
  value,
  locked,
  taken,
  onRename,
  m,
}: {
  value: string;
  locked: boolean;
  taken: string[];
  onRename: (next: string) => void;
  m: EditorMessages['options'];
}) {
  const [text, setText] = useState(value);
  const [refused, setRefused] = useState(false);
  // Follow an external change: switching questions, an undo, or the value
  // moving because the label did.
  useEffect(() => {
    setText(value);
    setRefused(false);
  }, [value]);

  // Commas separate the values inside a dynamic-question variant key, so a value
  // containing one is indistinguishable from a two-option set - a variant
  // authored for this option would also fire for a completely different answer.
  const clean = text.replace(/,/g, '').trim();

  function commit() {
    if (clean === value) {
      setText(value);
      setRefused(false);
      return;
    }
    if (!clean || taken.includes(clean)) {
      setText(value);
      setRefused(!!clean);
      return;
    }
    setRefused(false);
    onRename(clean);
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {m.value}
        <HelpTip text={m.valueHelp} label={m.value} />
      </span>
      <TextField
        value={text}
        readOnly={locked}
        aria-readonly={locked || undefined}
        aria-invalid={refused || undefined}
        className={locked ? 'opacity-60' : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setRefused(false);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // Commit WITHOUT blurring, so a keyboard user keeps their place.
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setText(value);
            setRefused(false);
          }
        }}
      />
      {refused ? (
        <p role="alert" data-testid="option-value-taken" className="text-xs text-destructive">
          {m.valueTaken}
        </p>
      ) : null}
    </label>
  );
}
