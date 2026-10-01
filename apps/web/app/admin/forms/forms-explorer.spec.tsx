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
  colForm: "Form",
  colStatus: "Status",
  colSubmissions: "Submissions",
  colCompletion: "Completion",
  colUpdated: "Updated",
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
      statusLive: "Published",
      statusLiveHint: "Live",
      statusUnpublished: "Unpublished changes",
      statusUnpublishedHint: "Not live yet",
      completionValue: "{n}%",
      noCompletion: "No data",
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
    expect(html).toContain('href="/acme/f/lead-qualifier"');
  });

  it("shows and opens every form at its neutral link, filed or unfiled", () => {
    const html = render();
    for (const slug of ["lead-qualifier", "survey"]) {
      expect(html).toContain(`title="/acme/f/${slug}"`);
      expect(html).toContain(`href="/acme/f/${slug}"`);
    }
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
    expect(html).toContain('href="/acme/f/survey"');
  });

  it("shows the publish state the API reports, and none when it reports nothing", () => {
    const form = { name: "F", slug: "f", brandAppliedAt: null, folderId: null, createdAt: 1, updatedAt: 1 };
    const html = render({
      folders: [],
      forms: [
        { ...form, id: "live", hasDraft: false },
        { ...form, id: "pending", hasDraft: true },
        { ...form, id: "unknown" },
      ],
    });
    expect((html.match(/data-testid="form-row"/g) ?? []).length).toBe(3);
    expect((html.match(/data-status="live"/g) ?? []).length).toBe(1);
    expect((html.match(/data-status="unpublished"/g) ?? []).length).toBe(1);
  });

  it("turns the two figures into the links they stand for, and falls back to words without them", () => {
    const html = render({
      statsByForm: {
        a: { submissions: 482, completionRate: 68.4 },
        b: { submissions: 0, completionRate: null },
      },
    });
    expect(html).toContain('aria-label="Submissions: 482"');
    expect(html).toContain('aria-label="Analytics: 68%"');
    // Nobody started form b: there is no rate, and 0% would misstate that.
    expect(html).toContain("No data");
    expect(html).not.toContain("0%");

    // No figures at all: the cells name where they lead, never an empty link.
    const bare = render();
    expect(bare).toContain('aria-label="Submissions"');
    expect(bare).toContain('aria-label="Analytics"');
  });
});
