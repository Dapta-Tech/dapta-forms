import { useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Select, type SelectOption } from '../../apps/web/components/ui/select';

/**
 * Browser entry for qa/component: turns placeholders in the page into real
 * components. Bundled by `mount.ts`; never imported by the app.
 *
 *   <div data-select='{"options":[...],"value":"a","searchable":true}'></div>
 *
 * The placeholder is `display: contents`, so the component's own root is what
 * takes part in the surrounding layout (a flex row sizes the Select, not a
 * wrapper around it), exactly as it would in the app.
 */

interface SelectSpec {
  options: SelectOption[];
  value?: string;
  searchable?: boolean;
  ariaLabel?: string;
  className?: string;
}

function Controlled({ spec }: { spec: SelectSpec }) {
  const [value, setValue] = useState(spec.value ?? '');
  return (
    <Select
      value={value}
      onChange={setValue}
      options={spec.options}
      searchable={spec.searchable}
      ariaLabel={spec.ariaLabel}
      className={spec.className}
    />
  );
}

for (const host of document.querySelectorAll<HTMLElement>('[data-select]')) {
  host.style.display = 'contents';
  const spec = JSON.parse(host.dataset.select ?? '{}') as SelectSpec;
  flushSync(() => createRoot(host).render(<Controlled spec={spec} />));
}
document.documentElement.dataset.mounted = 'true';
