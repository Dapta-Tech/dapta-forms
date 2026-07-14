/**
 * The builder's question-type model: the visual gallery groups + the mapping
 * from a gallery choice to a real `FormStep`. "Single choice" and "Multiple
 * choice" both compile to the engine's `multiple_choice` type, differing only by
 * the additive `selectionMode` flag (single = radios, multiple = checkboxes);
 * "Dropdown" stays its own type. Icons are PrimeIcons (verified present).
 */
import type { FormFieldType, FormStep } from '@quill/engine';
import { createEmptyStep } from '@quill/engine';
import type { GalleryItemId } from './builder-messages';

export interface GalleryItem {
  id: GalleryItemId;
  type: FormFieldType;
  selectionMode?: 'single' | 'multiple';
  icon: string;
}

export type GalleryGroup = 'contact' | 'choice' | 'text' | 'content';

/** The gallery, grouped by intent (order mirrors the mockup). */
export const GALLERY: Record<GalleryGroup, GalleryItem[]> = {
  contact: [
    { id: 'name', type: 'name', icon: 'pi-user' },
    { id: 'email', type: 'email', icon: 'pi-envelope' },
    { id: 'phone', type: 'phone', icon: 'pi-phone' },
  ],
  choice: [
    { id: 'single', type: 'multiple_choice', selectionMode: 'single', icon: 'pi-circle' },
    { id: 'multiple', type: 'multiple_choice', selectionMode: 'multiple', icon: 'pi-check-square' },
    { id: 'dropdown', type: 'dropdown', icon: 'pi-chevron-down' },
  ],
  text: [
    { id: 'short', type: 'text', icon: 'pi-minus' },
    { id: 'long', type: 'textarea', icon: 'pi-align-left' },
    { id: 'slider', type: 'slider', icon: 'pi-sliders-h' },
  ],
  content: [{ id: 'message', type: 'message', icon: 'pi-comment' }],
};

export const GALLERY_GROUPS: GalleryGroup[] = ['contact', 'choice', 'text', 'content'];

/** The PrimeIcons glyph that represents a step in the spine / map / settings. */
export function iconForStep(step: Pick<FormStep, 'type' | 'selectionMode'>): string {
  switch (step.type) {
    case 'name':
      return 'pi-user';
    case 'email':
      return 'pi-envelope';
    case 'phone':
      return 'pi-phone';
    case 'dropdown':
      return 'pi-chevron-down';
    case 'multiple_choice':
      return step.selectionMode === 'multiple' ? 'pi-check-square' : 'pi-circle';
    case 'slider':
      return 'pi-sliders-h';
    case 'textarea':
      return 'pi-align-left';
    case 'text':
      return 'pi-minus';
    case 'message':
      return 'pi-comment';
    default:
      return 'pi-stop';
  }
}

/** Contact-type steps auto-detected for the spine badge + "doesn't score" hint. */
export function isContactType(type: FormFieldType): boolean {
  return type === 'name' || type === 'email' || type === 'phone';
}

/** Choice-family steps that carry editable options + point chips. */
export function hasOptions(type: FormFieldType): boolean {
  return type === 'dropdown' || type === 'multiple_choice';
}

/**
 * Build a fresh step from a gallery pick — reuses the engine's `createEmptyStep`
 * (unique key + per-type defaults) then applies the gallery's `selectionMode`.
 */
export function stepFromGalleryItem(item: GalleryItem, taken: ReadonlySet<string>): FormStep {
  const step = createEmptyStep(item.type, taken);
  if (item.type === 'multiple_choice') {
    step.selectionMode = item.selectionMode ?? 'single';
  }
  return step;
}
