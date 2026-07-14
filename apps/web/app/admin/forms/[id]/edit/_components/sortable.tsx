'use client';

import { useId, type HTMLAttributes, type ReactNode } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * A thin, reusable dnd-kit vertical sortable. Keyboard-accessible (grip is a
 * focusable handle; arrows move a picked-up item), pointer needs a 4px intent
 * so clicks on inner controls don't start a drag. Used for the step list and
 * the option list so reorder behaves identically everywhere.
 */
export function SortableList({
  ids,
  onReorder,
  children,
  className,
}: {
  ids: string[];
  onReorder: (from: number, to: number) => void;
  children: (id: string, index: number) => ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // dnd-kit derives its aria description / live-region element ids from the
  // DndContext `id`. Left unset it falls back to a module-global counter that
  // increments in a different order on the server than on the client, so the
  // generated `DndDescribedBy-<n>` ids mismatch and React logs a hydration
  // error. A stable, per-instance `useId()` makes those ids deterministic
  // across SSR and client and removes the mismatch without touching drag.
  const dndId = useId();

  function handleEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onReorder(from, to);
  }

  return (
    <DndContext id={dndId} sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className={className}>{ids.map((id, index) => children(id, index))}</div>
      </SortableContext>
    </DndContext>
  );
}

/** One sortable row. `children` receives the props to spread on the drag grip. */
export function SortableRow({
  id,
  children,
}: {
  id: string;
  children: (args: { handleProps: HTMLAttributes<HTMLElement>; isDragging: boolean }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 20 : undefined,
    position: 'relative',
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ handleProps: { ...attributes, ...listeners }, isDragging })}
    </div>
  );
}
