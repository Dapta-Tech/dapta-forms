"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FolderDialog, type FolderDialogLabels } from "./folder-dialog";

/** The header's "New folder" trigger and its dialog. */
export function NewFolderButton({
  label,
  labels,
}: {
  label: string;
  labels: FolderDialogLabels;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        data-testid="new-folder"
      >
        <i aria-hidden className="pi pi-folder-plus" style={{ fontSize: 12 }} />{" "}
        {label}
      </Button>
      <FolderDialog
        key={open ? "open" : "closed"}
        open={open}
        onClose={() => setOpen(false)}
        onDone={() => router.refresh()}
        mode="create"
        labels={labels}
      />
    </>
  );
}
