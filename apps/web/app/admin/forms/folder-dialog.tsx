"use client";

import { useId, useState, useTransition } from "react";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { callAction } from "@/lib/call-action";
import {
  createFolderAction,
  renameFolderAction,
  type FolderWriteState,
} from "./folder-actions";

export interface FolderDialogLabels {
  newFolderTitle: string;
  renameFolderTitle: string;
  folderCreate: string;
  folderSave: string;
  folderNameLabel: string;
  folderNamePlaceholder: string;
  folderNameRequired: string;
  folderNameTaken: string;
  actionFailed: string;
  cancel: string;
}

/**
 * Create or rename a folder. One dialog for both: the only differences are the
 * title, the submit label and which action runs. A duplicate name comes back
 * as an inline error on the field (409 NAME_TAKEN), never as a toast the
 * person has to hunt for while the dialog is still open.
 */
export function FolderDialog({
  open,
  onClose,
  onDone,
  mode,
  initialName = "",
  folderId,
  labels,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: (state: Extract<FolderWriteState, { ok: true }>) => void;
  mode: "create" | "rename";
  initialName?: string;
  /** Required for `rename`. */
  folderId?: string;
  labels: FolderDialogLabels;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<"required" | "taken" | "failed" | null>(
    null,
  );
  const [name, setName] = useState(initialName);
  const errorId = useId();
  const labelId = useId();

  const close = () => {
    setError(null);
    onClose();
  };

  const submit = () => {
    const value = name.trim();
    if (!value) {
      setError("required");
      return;
    }
    start(async () => {
      const res = await callAction(() =>
        mode === "create"
          ? createFolderAction(value)
          : renameFolderAction(folderId ?? "", value),
      );
      if (res && "ok" in res && res.ok) {
        setError(null);
        onDone?.(res);
        onClose();
        return;
      }
      setError(
        res && "code" in res && res.code === "NAME_TAKEN" ? "taken" : "failed",
      );
    });
  };

  const message =
    error === "required"
      ? labels.folderNameRequired
      : error === "taken"
        ? labels.folderNameTaken
        : error === "failed"
          ? labels.actionFailed
          : null;

  return (
    <Modal
      open={open}
      onClose={close}
      title={
        mode === "create" ? labels.newFolderTitle : labels.renameFolderTitle
      }
      labelId={labelId}
    >
      <form
        data-testid="folder-dialog"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{labels.folderNameLabel}</span>
          <input
            name="name"
            value={name}
            autoFocus
            autoComplete="off"
            maxLength={80}
            placeholder={labels.folderNamePlaceholder}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? errorId : undefined}
            data-testid="folder-name-input"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {message ? (
            <span
              id={errorId}
              role="alert"
              className="text-xs text-destructive"
              data-testid="folder-name-error"
            >
              {message}
            </span>
          ) : null}
        </label>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={close}
            disabled={pending}
          >
            {labels.cancel}
          </Button>
          <Button
            type="submit"
            disabled={pending}
            data-testid="folder-dialog-submit"
            className="min-w-[120px]"
          >
            {mode === "create" ? labels.folderCreate : labels.folderSave}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
