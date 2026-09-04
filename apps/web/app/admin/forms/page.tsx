import { getMessages, t } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { CreateForm } from './create-form';
import { FormsExplorer } from './forms-explorer';
import { NewFolderButton } from './new-folder-button';

export const dynamic = 'force-dynamic';

/**
 * The forms list: one list, grouped by folder (Unfiled first), searchable by
 * keyboard. Stays a server component: it fetches, formats the dates once on
 * the server clock, and hands the explorer plain data; every interaction
 * (search, collapse, drag, move, folder dialogs) lives in the client tree.
 */
export default async function FormsList() {
  const locale = await getLocale();
  const messages = getMessages(locale).admin;
  const m = messages.forms;
  const [me, forms, folders] = await Promise.all([adminApi.me(), adminApi.listForms(), adminApi.listFolders()]);

  const createLabels = {
    create: m.create,
    createTitle: m.createTitle,
    nameLabel: m.nameLabel,
    namePlaceholder: m.namePlaceholder,
    nameRequired: m.nameRequired,
    cancel: m.cancel,
    layoutLabel: m.layoutLabel,
    layoutSlides: m.layoutSlides,
    layoutSlidesDesc: m.layoutSlidesDesc,
    layoutVertical: m.layoutVertical,
    layoutVerticalDesc: m.layoutVerticalDesc,
    folderLabel: m.folderLabel,
    folderNone: m.folderNone,
  };
  const dialogLabels = {
    newFolderTitle: m.newFolderTitle,
    renameFolderTitle: m.renameFolderTitle,
    folderCreate: m.folderCreate,
    folderSave: m.folderSave,
    folderNameLabel: m.folderNameLabel,
    folderNamePlaceholder: m.folderNamePlaceholder,
    folderNameRequired: m.folderNameRequired,
    folderNameTaken: m.folderNameTaken,
    actionFailed: m.actionFailed,
    cancel: m.cancel,
  };
  // Formatted once on the server clock, the same way the flat list did; the
  // workspace-timezone change switches this to the shared formatter.
  const updatedByForm = Object.fromEntries(
    forms.map((f) => [f.id, t(m.updated, { when: new Date(f.updatedAt).toLocaleDateString(locale) })]),
  );

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      <PageHeader
        title={m.title}
        subtitle={m.subtitle}
        action={
          forms.length > 0 || folders.length > 0 ? (
            <div className="flex items-center gap-2">
              <NewFolderButton label={m.newFolder} labels={dialogLabels} />
              <CreateForm labels={createLabels} folders={folders} locale={locale} />
            </div>
          ) : undefined
        }
      />

      {forms.length === 0 && folders.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <i aria-hidden className="pi pi-file-edit" style={{ fontSize: 20 }} />
          </div>
          <div>
            <p className="font-medium text-foreground">{m.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{m.emptyBody}</p>
          </div>
          <CreateForm labels={createLabels} />
        </div>
      ) : (
        <FormsExplorer
          forms={forms}
          folders={folders}
          accountCode={me.accountCode}
          handle={me.handle ?? 'me'}
          locale={locale}
          updatedByForm={updatedByForm}
          labels={{
            searchPlaceholder: m.searchPlaceholder,
            searchLabel: m.searchLabel,
            searchClear: m.searchClear,
            searchEmpty: m.searchEmpty,
            searchResults: m.searchResults,
            searchShortcut: m.searchShortcut,
            unfiled: m.unfiled,
            folderCount: m.folderCount,
            folderCountOne: m.folderCountOne,
            renameFolder: m.renameFolder,
            deleteFolder: m.deleteFolder,
            deleteFolderConfirm: m.deleteFolderConfirm,
            folderMenu: m.folderMenu,
            collapse: m.collapse,
            expand: m.expand,
            createIn: m.createIn,
            moveFailed: m.moveFailed,
            dropHere: m.dropHere,
            updated: m.updated,
          }}
          rowLabels={{
            updated: m.updated,
            edit: m.edit,
            submissions: messages.nav.submissions,
            analytics: messages.nav.analytics,
            connect: m.connect,
            copy: m.copy,
            copied: m.copied,
            openForm: m.openForm,
            dragHandle: m.dragHandle,
          }}
          actionLabels={{
            menu: m.actions,
            duplicate: m.duplicate,
            delete: m.delete,
            deleteConfirm: m.deleteConfirm,
            moveTo: m.moveTo,
            moveBack: m.moveBack,
          }}
          dialogLabels={dialogLabels}
          createLabels={createLabels}
        />
      )}
    </div>
  );
}
