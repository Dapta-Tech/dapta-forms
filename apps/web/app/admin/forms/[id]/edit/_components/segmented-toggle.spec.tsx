// @vitest-environment happy-dom
/**
 * One option of a SegmentedToggle can be unchoosable while the rest work:
 * it stays visible with its hover reason (`title`), a click on it does
 * nothing, and the arrow keys step past it.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SegmentedToggle } from './fields';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});

function Harness({ onChange }: { onChange: (v: string) => void }) {
  const [value, setValue] = useState('a');
  return (
    <SegmentedToggle
      value={value}
      onChange={(v) => {
        onChange(v);
        setValue(v);
      }}
      options={[
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true, title: 'Why not B' },
        { value: 'c', label: 'C' },
      ]}
      ariaLabel="Pick"
    />
  );
}

async function mount() {
  const onChange = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness onChange={onChange} />));
  const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  return { onChange, radios, group: host.querySelector<HTMLElement>('[role="radiogroup"]')! };
}

const key = (el: HTMLElement, k: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });

describe('SegmentedToggle: one option disabled', () => {
  it('keeps it visible with its hover reason, and a click does nothing', async () => {
    const { onChange, radios } = await mount();
    expect(radios[1]!.getAttribute('aria-disabled')).toBe('true');
    expect(radios[1]!.title).toBe('Why not B');
    expect(radios[0]!.getAttribute('aria-disabled')).toBeNull();
    await act(async () => radios[1]!.click());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the arrow keys step past it, in both directions', async () => {
    const { onChange, group } = await mount();
    await key(group, 'ArrowRight');
    expect(onChange).toHaveBeenLastCalledWith('c');
    await key(group, 'ArrowLeft');
    expect(onChange).toHaveBeenLastCalledWith('a');
    expect(onChange).not.toHaveBeenCalledWith('b');
  });
});
