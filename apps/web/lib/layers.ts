/**
 * The admin's overlay tiers, lowest to highest, in one place.
 *
 *   page content (auto)  <  shell chrome (30)  <  drawer backdrop (40)
 *   <  overlays (50)  <  rail menus (55)  <  toasts (60)  <  confirm (70)
 *
 * A tier only means something in the ROOT stacking context. An overlay
 * rendered inside the rail is ranked against the rail's own children, never
 * against the page: the desktop rail is `md:sticky` and the mobile drawer is
 * `fixed z-50 translate-x-*`, and each of those opens a stacking context. So
 * anything opened FROM the rail (its menus, the "New workspace" dialog) is
 * portalled to `document.body` before its tier is applied. See
 * `components/ui/anchored-menu.tsx` and `components/modal.tsx`.
 *
 * Page content stays at `auto`: an animated card (the Home's "Connect your
 * agent" demo) is `isolate`d so its transforms stay inside its own box rather
 * than competing with these tiers.
 *
 * Most call sites write the tier as a Tailwind class (`z-30`, `z-50`,
 * `z-[60]`), which has to be a literal for Tailwind to see it; the comments
 * next to each value name them. Code that sets `zIndex` itself reads it here.
 */
export const LAYER = {
  /**
   * Sticky shell chrome: the mobile top bar, and the editor's rail that peeks
   * over the canvas (`z-30` in admin-shell.tsx).
   */
  chrome: 30,
  /** The mobile drawer's backdrop (`z-40`). */
  drawerBackdrop: 40,
  /**
   * Dialogs and popovers: `Modal`, `Drawer`, the mobile drawer itself, and
   * the pickers inside `<main>` (`z-50`). A portalled `Modal` ties with the
   * drawer and wins by coming later in `<body>`.
   */
  overlay: 50,
  /**
   * The rail's portalled menus (`AnchoredMenu`) and the submissions column
   * filter sheet (`z-[55]`): above every popover inside `<main>`.
   */
  railMenu: 55,
  /** The toast stack (`z-[60]`, components/toast.tsx). */
  toast: 60,
  /**
   * The confirm dialog (`z-[70]`, components/ui/confirm-dialog.tsx): a
   * destructive confirmation is never under anything.
   */
  confirm: 70,
} as const;
