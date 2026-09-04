/**
 * The explorer's static shape: Unfiled first, folders alphabetically as
 * collapsible sections with counts, every row testid the flat list had, and
 * the search box. Rendered through static markup in plain node (dnd-kit and
 * the dialogs render their inert shells fine without a DOM).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("@/components/toast", () => ({
  useToast: () => ({ success: () => {}, error: () => {}, info: () => {} }),
}));

import { FormsExplorer, type FormsExplorerProps } from "./forms-explorer";

const labels: FormsExplorerProps["labels"] = {
  searchPlaceholder: "Search forms",
  searchLabel: "Search forms by name or link",
  searchClear: "Clear",
  searchEmpty: "No forms match",
  searchResults: "{count} forms match",
  searchShortcut: "Ctrl K",
  unfiled: "Unfiled",
  folderCount: "{count} forms",
  folderCountOne: "1 form",
  renameFolder: "Rename",
  deleteFolder: "Delete folder",
  deleteFolderConfirm: "Delete {name}? {count}",
  folderMenu: "Folder actions",
  collapse: "Collapse",
  expand: "Expand",
  createIn: "New form",
  moveFailed: "Could not move",
  dropHere: "Drop here",
};

function render(overrides: Partial<FormsExplorerProps> = {}) {
  const props: FormsExplorerProps = {
    forms: [
      {
        id: "a",
        name: "Lead Qualifier",
        slug: "lead-qualifier",
        brandAppliedAt: null,
        folderId: "sales",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "b",
        name: "Survey",
        slug: "survey",
        brandAppliedAt: null,
        folderId: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    folders: [{ id: "sales", name: "Sales", createdAt: 1, updatedAt: 1 }],
    accountCode: "acme",
    handle: "alex",
    locale: "en",
    updatedByForm: { a: "Updated today", b: "Updated today" },
    labels,
    rowLabels: {
      edit: "Edit",
      submissions: "Submissions",
      analytics: "Analytics",
      connect: "Connect",
      copy: "Copy link",
      copied: "Copied",
      openForm: "Open form",
      dragHandle: "Drag",
    },
    actionLabels: {
      menu: "Actions",
      duplicate: "Duplicate",
      delete: "Delete",
      deleteConfirm: "Sure?",
      moveTo: "Move to folder",
      moveBack: "No folder",
    },
    dialogLabels: {
      newFolderTitle: "Create a folder",
      renameFolderTitle: "Rename folder",
      folderCreate: "Create",
      folderSave: "Save",
      folderNameLabel: "Folder name",
      folderNamePlaceholder: "e.g. Sales",
      folderNameRequired: "Required",
      folderNameTaken: "Taken",
      actionFailed: "Failed",
      cancel: "Cancel",
    },
    createLabels: {
      create: "Create form",
      createTitle: "Create a new form",
      nameLabel: "Name",
      namePlaceholder: "e.g.",
      nameRequired: "Required",
      cancel: "Cancel",
      layoutLabel: "Layout",
      layoutSlides: "Slides",
      layoutSlidesDesc: "",
      layoutVertical: "One page",
      layoutVerticalDesc: "",
      folderLabel: "Folder",
      folderNone: "No folder",
    },
    ...overrides,
  };
  return renderToStaticMarkup(<FormsExplorer {...props} />);
}

describe("FormsExplorer", () => {
  it("renders Unfiled first, then folders, each as a collapsible section with a count", () => {
    const html = render();
    const unfiledAt = html.indexOf('data-testid="unfiled-section"');
    const salesAt = html.indexOf('data-testid="folder-section"');
    expect(unfiledAt).toBeGreaterThan(-1);
    expect(salesAt).toBeGreaterThan(unfiledAt);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("1 form");
    expect(html).toContain('data-folder-id="sales"');
  });

  it("keeps every row testid the flat list had, plus a grip and the search box", () => {
    const html = render();
    for (const id of [
      "form-row",
      "form-row-edit",
      "form-row-submissions",
      "form-row-analytics",
      "form-row-connect",
      "form-row-copy",
      "form-row-open",
      "form-row-menu",
      "form-row-grip",
    ])
      expect(html).toContain(`data-testid="${id}"`);
    expect(html).toContain('data-testid="forms-search"');
    expect(html).toContain('href="/acme/alex/lead-qualifier"');
  });

  it("without folders it is the flat list: one section, no folder chrome", () => {
    const html = render({
      folders: [],
      forms: [
        {
          id: "b",
          name: "Survey",
          slug: "survey",
          brandAppliedAt: null,
          folderId: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(html).not.toContain('data-testid="folder-section"');
    expect(html).not.toContain('data-testid="folder-menu"');

    expect(html).not.toContain('data-testid="unfiled-section"');

    expect(html).not.toContain('data-testid="form-row-grip"');
    expect((html.match(/data-testid="form-row"/g) ?? []).length).toBe(1);
  });
});
