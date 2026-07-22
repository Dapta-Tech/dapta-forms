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
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {required ? (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        ) : null}
      </label>
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
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
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
