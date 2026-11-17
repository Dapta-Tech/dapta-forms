import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Modal } from '../../apps/web/components/modal';
import { Select, type SelectOption } from '../../apps/web/components/ui/select';

/**
 * Browser entry for qa/component: turns placeholders in the page into real
 * components. Bundled by `mount.ts`; never imported by the app.
 *
 *   <div data-select='{"options":[...],"value":"a","searchable":true}'></div>
 *   <div data-modal-select='{"options":[...]}'></div>
 *
 * A `data-select` placeholder is `display: contents`, so the component's own
 * root is what takes part in the surrounding layout (a flex row sizes the
 * Select, not a wrapper around it), exactly as it would in the app.
 * `data-modal-select` puts the same Select inside the app's real `Modal`.
 *
 * A spec can replace a mounted Select's options, the way a list that finishes
 * loading would, by dispatching `qa:options` on its placeholder:
 *
 *   host.dispatchEvent(new CustomEvent('qa:options', { detail: [...] }))
 */

interface SelectSpec {
  options: SelectOption[];
  value?: string;
  searchable?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  className?: string;
  labelClassName?: string;
}

function Controlled({ spec, host }: { spec: SelectSpec; host: HTMLElement }) {
  const [value, setValue] = useState(spec.value ?? '');
  const [options, setOptions] = useState(spec.options);
  useEffect(() => {
    const onOptions = (e: Event) => setOptions((e as CustomEvent<SelectOption[]>).detail);
    host.addEventListener('qa:options', onOptions);
    return () => host.removeEventListener('qa:options', onOptions);
  }, [host]);
  return (
    <Select
      value={value}
      onChange={setValue}
      options={options}
      searchable={spec.searchable}
      ariaLabel={spec.ariaLabel}
      placeholder={spec.placeholder}
      className={spec.className}
      labelClassName={spec.labelClassName}
    />
  );
}

function InModal({ spec, host }: { spec: SelectSpec; host: HTMLElement }) {
  const [open, setOpen] = useState(true);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Invite a teammate" labelId="qa-modal-title">
      <Controlled spec={spec} host={host} />
    </Modal>
  );
}

for (const host of document.querySelectorAll<HTMLElement>('[data-select]')) {
  host.style.display = 'contents';
  const spec = JSON.parse(host.dataset.select ?? '{}') as SelectSpec;
  flushSync(() => createRoot(host).render(<Controlled spec={spec} host={host} />));
}
for (const host of document.querySelectorAll<HTMLElement>('[data-modal-select]')) {
  const spec = JSON.parse(host.dataset.modalSelect ?? '{}') as SelectSpec;
  flushSync(() => createRoot(host).render(<InModal spec={spec} host={host} />));
}
document.documentElement.dataset.mounted = 'true';
