import { formatDate, getMessages, t } from '@quill/shared';
import { adminApi } from '@/lib/admin-api';
import { getLocale } from '@/lib/locale';
import { PageHeader } from '@/components/ui/page-header';
import { CreateForm } from './create-form';
import { FormsExplorer } from './forms-explorer';
import { NewFolderButton } from './new-folder-button';

export const dynamic = 'force-dynamic';

/**
 * The forms list: one table, grouped by folder (Unfiled first), searchable by
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
  // Formatted once on the server, in the workspace's zone (UTC until it is
  // set), so every teammate reads the same day. The bare date: the column it
  // sits in is headed "Updated".
  const updatedByForm = Object.fromEntries(
    forms.map((f) => [f.id, formatDate(f.updatedAt, { locale, timeZone: me.timezone ?? 'UTC' })]),
  );

  // Responses and completion per form, from the same per-form analytics the
  // dashboard totals (no new endpoint), so the two screens cannot disagree. A
  // form whose analytics cannot be read gets no entry and its cells fall back
  // to plain links.
  const analytics = await Promise.all(forms.map((f) => adminApi.getAnalytics(f.id).catch(() => null)));
  const statsByForm = Object.fromEntries(
    forms.flatMap((f, i) => {
      const a = analytics[i];
      return a ? [[f.id, { submissions: a.submissions, completionRate: a.completionRate }] as const] : [];
    }),
  );

  const headerActions = (
    <>
      <NewFolderButton label={m.newFolder} labels={dialogLabels} />
      <CreateForm labels={createLabels} folders={folders} locale={locale} />
    </>
  );

  return (
    <div className="mx-auto max-w-[1520px] px-6 py-10 sm:px-8">
      {forms.length === 0 && folders.length === 0 ? (
        <>
          <PageHeader title={m.title} subtitle={m.subtitle} />
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
        </>
      ) : (
        <FormsExplorer
          forms={forms}
          folders={folders}
          accountCode={me.accountCode}
          locale={locale}
          updatedByForm={updatedByForm}
          statsByForm={statsByForm}
          heading={
            <div className="min-w-0">
              <h1 className="text-3xl font-bold tracking-tight">{m.title}</h1>
              <p className="mt-1 text-muted-foreground">
                {forms.length === 1 ? m.folderCountOne : t(m.folderCount, { count: forms.length })}
              </p>
            </div>
          }
          actions={headerActions}
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
            colForm: m.colForm,
            colStatus: m.colStatus,
            colSubmissions: m.colSubmissions,
            colCompletion: m.colCompletion,
            colUpdated: m.colUpdated,
          }}
          rowLabels={{
            edit: m.edit,
            submissions: messages.nav.submissions,
            analytics: messages.nav.analytics,
            connect: m.connect,
            copy: m.copy,
            copied: m.copied,
            openForm: m.openForm,
            dragHandle: m.dragHandle,
            statusLive: m.statusLive,
            statusLiveHint: m.statusLiveHint,
            statusUnpublished: m.statusUnpublished,
            statusUnpublishedHint: m.statusUnpublishedHint,
            completionValue: messages.picker.completionValue,
            noCompletion: m.noCompletion,
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
