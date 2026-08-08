'use client';

import { Children, isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Select, type SelectOption } from '@/components/ui/select';

/**
 * Small form-anatomy primitives shared by every editor panel so spacing,
 * labels, and the inline required marker stay identical across the builder
 * (Design Quality Bar §7/§8). Tokens only — no raw hex/px.
 */

export function Field({
  label,
  htmlFor,
  required,
  hint,
  labelAdornment,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  /** Rendered next to the label — a `HelpTip` where a full hint line won't fit. */
  labelAdornment?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex items-center gap-1.5">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
          {required ? (
            <span aria-hidden className="ml-0.5 text-destructive">
              *
            </span>
          ) : null}
        </label>
        {labelAdornment}
      </span>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const controlBase =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors ' +
  'placeholder:text-muted-foreground hover:border-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function TextField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props;
  return <input {...rest} className={cn(controlBase, className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, rows = 3, ...rest } = props;
  return <textarea {...rest} rows={rows} className={cn(controlBase, 'resize-y', className)} />;
}

/** The display string for a numeric prop; nullish/empty → empty (never a
 *  forced "0" that would pin a leading zero when the author starts typing). */
function numberToDisplay(value: React.InputHTMLAttributes<HTMLInputElement>['value']): string {
  if (value == null || value === '') return '';
  return String(value);
}

/** Drop a leading-zero run for display: "01"→"1", "-007"→"-7". Leaves "0",
 *  "0.5", "-", "" and any non-leading-zero string untouched. */
function stripLeadingZeros(s: string): string {
  const m = /^(-?)0+(\d.*)$/.exec(s);
  return m ? `${m[1]}${m[2]}` : s;
}

/**
 * A number input that owns its display string. `<input type="number">` won't
 * rewrite "01"→"1" on its own (both coerce to 1), so a field seeded at 0 keeps
 * a stale "0" in front of whatever the author types next. We mirror the
 * controlled numeric prop into local text, strip the leading-zero run as you
 * type, and — while focused — leave in-progress tokens ("", "-", "1.") alone so
 * typing (including a negative) is never yanked back to the prop's value.
 *
 * The onChange CONTRACT is unchanged: the raw change event is forwarded, so
 * every call site's `Number(e.target.value) || 0` still reads the same value.
 * Clearing shows empty (not "0"); the display settles to the committed value on
 * blur and re-syncs when the prop changes externally (e.g. switching questions).
 */
export function NumberField({
  className,
  value,
  onChange,
  onFocus,
  onBlur,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [display, setDisplay] = useState<string>(() => numberToDisplay(value));
  const focused = useRef(false);

  useEffect(() => {
    // Mirror the controlled prop when the user isn't actively editing — this is
    // how an external change (question switch, upstream reset/clamp) reaches the
    // field. While focused we never overwrite the in-progress string.
    if (focused.current) return;
    setDisplay(numberToDisplay(value));
  }, [value]);

  return (
    <input
      {...rest}
      type="number"
      value={display}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onChange={(e) => {
        setDisplay(stripLeadingZeros(e.target.value));
        onChange?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        setDisplay(numberToDisplay(value));
        onBlur?.(e);
      }}
      className={cn(controlBase, className)}
    />
  );
}

/** Flatten an `<option>`'s children (strings, numbers, `{expr}` fragments) into
 *  the plain text the branded Select shows as that option's label. */
function optionText(node: ReactNode): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(optionText).join('');
  if (isValidElement(node)) return optionText((node.props as { children?: ReactNode }).children);
  return '';
}

/** Read `<option>` children into the branded Select's options array, coercing
 *  values to strings so numeric option values match the native `<select>`. */
function optionsFromChildren(children: ReactNode): SelectOption[] {
  const out: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== 'option') return;
    const p = child.props as { value?: string | number; disabled?: boolean; children?: ReactNode };
    out.push({
      value: p.value == null ? '' : String(p.value),
      label: optionText(p.children).trim(),
      disabled: p.disabled,
    });
  });
  return out;
}

/**
 * The shared builder select. Keeps the native `<select>` call shape used across
 * the editor (`<option>` children + an `onChange(e)` reading `e.target.value`)
 * but renders the branded {@link Select} combobox underneath — so every builder
 * dropdown (question type, logic conditions/rules, reveal panel, variants) is
 * on-theme in both light and dark. Options come from the `<option>` children;
 * the change event is synthesized so existing call sites stay untouched.
 */
export function SelectField({
  className,
  children,
  value,
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel,
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Select
      id={id}
      ariaLabel={ariaLabel}
      className={cn('cursor-pointer', className)}
      disabled={disabled}
      value={value == null ? '' : String(value)}
      options={optionsFromChildren(children)}
      onChange={(v) =>
        onChange?.({
          target: { value: v },
          currentTarget: { value: v },
        } as unknown as React.ChangeEvent<HTMLSelectElement>)
      }
    />
  );
}

/**
 * A two-or-more-way segmented picker, for settings where a bare on/off switch
 * would hide what each state means (e.g. "banner on every screen" vs "cover
 * only").
 *
 * It declares `role="radiogroup"` over `role="radio"` buttons, and that ARIA
 * contract has to be paid for in behaviour: a radiogroup is ONE tab stop whose
 * members are reached with arrow keys. Native buttons are each focusable, so the
 * markup alone announced "radio, 1 of 3" while Tab walked past all three and the
 * arrows did nothing — the opposite of what it promised. The roving tabindex and
 * the key handler below are what make the role true.
 *
 * Arrow keys MOVE and SELECT together, per the APG radiogroup pattern: in a group
 * where every option is visible and switching is instant, a separate "commit"
 * step is a keystroke that buys nothing.
 */
export function SegmentedToggle<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  disabled = false,
  size = 'sm',
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  /** `icon` is a PrimeIcon class (`pi-sun`); omit it for a text-only chip. */
  options: { value: T; label: string; icon?: string }[];
  ariaLabel: string;
  /** Read-only mode: options render but cannot be chosen. */
  disabled?: boolean;
  /** `md` for a setting that stands on its own; `sm` for a row inside a panel. */
  size?: 'sm' | 'md';
  /** Container overrides — mainly the surface this sits ON, which decides whether
   *  the shell reads as `bg-card` or `bg-background`. */
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((o) => o.value === value);
  // Whether this group has ever held focus. Only that lets the effect below tell
  // "the user was operating me and something took focus away" from "the page just
  // loaded" — and stealing focus in the second case would be a worse bug than the
  // one it fixes.
  const hadFocus = useRef(false);

  // Put focus back when a re-render drops it. Some owners write through a server
  // action: the Appearance picker calls `setThemeAction`, which revalidates the
  // ROOT layout because `data-theme` lives on `<html>`. That re-render lands
  // focus on `document.body`, so the FIRST arrow key moved the selection and
  // every one after it went nowhere — the control answered once and then went
  // deaf, which is worse than never having had arrow keys.
  //
  // Guarded twice: only if this group held focus, and only if focus is now
  // nowhere. A user who clicked away keeps their click.
  useEffect(() => {
    if (!hadFocus.current || index < 0) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    refs.current[index]?.focus();
  }, [value, index]);

  function move(delta: number | 'first' | 'last') {
    if (disabled || options.length === 0) return;
    const from = index < 0 ? 0 : index;
    const next =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? options.length - 1
          : // Wraps, because a radiogroup is a ring: arrowing right off the end
            // of three visible options and stopping dead reads as a broken key.
            (from + delta + options.length) % options.length;
    const option = options[next];
    if (!option) return;
    refs.current[next]?.focus();
    // Home on the first option, or End on the last, is a no-op for the VALUE —
    // so it must not write. Firing `onChange` with the value already selected
    // still runs the owner's handler, and for a server-action owner that means a
    // pointless revalidation whose re-render drops the focus this line just set.
    if (option.value === value) return;
    onChange(option.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      onFocus={() => {
        hadFocus.current = true;
      }}
      onKeyDown={(e) => {
        const delta =
          e.key === 'ArrowLeft' || e.key === 'ArrowUp'
            ? -1
            : e.key === 'ArrowRight' || e.key === 'ArrowDown'
              ? 1
              : e.key === 'Home'
                ? ('first' as const)
                : e.key === 'End'
                  ? ('last' as const)
                  : null;
        if (delta === null) return;
        e.preventDefault();
        move(delta);
      }}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5',
        className,
      )}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          // The roving tabindex: the group is one stop, and it is the CHECKED
          // option that owns it — so tabbing in lands on the current answer
          // rather than on whichever option happens to be first. Nothing checked
          // (a value outside the option list) falls back to the first, because a
          // group where every member is -1 cannot be reached by keyboard at all.
          tabIndex={value === o.value || (index < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex items-center gap-2 whitespace-nowrap rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
            size === 'md' ? 'px-3 py-2 text-sm' : 'px-3 py-1 text-xs',
            value === o.value
              ? 'bg-muted text-foreground shadow-[inset_0_0_0_1px_var(--primary-edge)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.icon ? <i aria-hidden className={`pi ${o.icon}`} style={{ fontSize: 13 }} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A row that pairs a label with an inline control (e.g. a switch). */
export function InlineField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

/** A titled group of controls with a consistent header + divider. */
export function PanelSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
