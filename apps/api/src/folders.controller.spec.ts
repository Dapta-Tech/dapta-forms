/**
 * The folder routes on the host-authed controller: create (201 / 409
 * NAME_TAKEN), rename, delete (idempotent 204), move a form (404 for a
 * stranger's folder), create a form straight into a folder, and the role
 * rule: any active member may organise forms, exactly like creating them.
 * In-memory SQLite through the real controller and the local auth provider.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { createDb, migrate, seed, sql, type Db } from "@quill/db";
import { AdminCrudController } from "./admin-crud.controller";
import { AdminService } from "./admin.service";
import { AuthService } from "./auth.service";
import { LocalAuthProvider } from "./auth.provider";
import type { ReqLike } from "./auth.provider";

let db: Db;
let controller: AdminCrudController;
let accountId: string;
let formId: string;

const asOwner = (): ReqLike => ({ headers: {} });
const asMember = (): ReqLike => ({
  headers: { "x-quill-email": "member@example.com" },
});

async function conflictCode(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    if (e instanceof ConflictException)
      return (e.getResponse() as { error?: string }).error ?? "";
    throw e;
  }
  throw new Error("expected a ConflictException");
}

beforeEach(async () => {
  db = await createDb("file::memory:");
  await migrate(db);
  await seed(db); // account "acme" + demo form "lead-qualifier" + owner alex@example.com
  const provider = new LocalAuthProvider(db, {
    NODE_ENV: "test",
    DEV_LOGIN_EMAIL: undefined,
    AUTH_LOCAL_STRICT: undefined,
    SEED_DEMO_FORM: false,
    ONBOARDING_WIZARD: false,
  });
  const auth = new AuthService(db, provider);
  const admin = new AdminService(db);
  controller = new AdminCrudController(
    db,
    auth,
    admin,
    {} as never,
    {} as never,
  );
  const account = await db.get<{ id: string }>(
    sql`SELECT id FROM account WHERE code = 'acme' LIMIT 1`,
  );
  accountId = account!.id;
  const form = await db.get<{ id: string }>(
    sql`SELECT id FROM form WHERE slug = 'lead-qualifier' LIMIT 1`,
  );
  formId = form!.id;
  // A plain member of acme (the local provider signs anyone in by email).
  await db.run(
    sql`INSERT INTO member (id, account_id, email, role, status, created_at)
        VALUES (${randomUUID()}, ${accountId}, ${"member@example.com"}, ${"member"}, ${"active"}, ${Date.now()})`,
  );
});

afterEach(async () => {
  await db.close();
});

describe("folders", () => {
  it("creates, lists alphabetically and refuses a duplicate name (case-insensitively) with 409 NAME_TAKEN", async () => {
    const sales = await controller.createFolder(asOwner(), { name: "Sales" });
    expect(sales.name).toBe("Sales");
    await controller.createFolder(asOwner(), { name: "archive" });
    expect(
      (await controller.listFolders(asOwner())).map((f) => f.name),
    ).toEqual(["archive", "Sales"]);
    expect(
      await conflictCode(controller.createFolder(asOwner(), { name: "SALES" })),
    ).toBe("NAME_TAKEN");
  });

  it("renames a folder, and deleting twice is idempotent", async () => {
    const f = await controller.createFolder(asOwner(), { name: "Sales" });
    expect(
      (await controller.renameFolder(asOwner(), f.id, { name: "Ventas" })).name,
    ).toBe("Ventas");
    await controller.deleteFolder(asOwner(), f.id);
    await controller.deleteFolder(asOwner(), f.id); // gone already: still 204
    expect(await controller.listFolders(asOwner())).toEqual([]);
    await expect(
      controller.renameFolder(asOwner(), f.id, { name: "x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("moves a form into a folder and back out; a stranger folder is 404", async () => {
    const f = await controller.createFolder(asOwner(), { name: "Sales" });
    expect(
      await controller.setFormFolder(asOwner(), formId, { folderId: f.id }),
    ).toEqual({ id: formId, folderId: f.id });
    expect(
      (await controller.listForms(asOwner())).find((x) => x.id === formId)
        ?.folderId,
    ).toBe(f.id);
    expect(
      await controller.setFormFolder(asOwner(), formId, { folderId: null }),
    ).toEqual({ id: formId, folderId: null });
    await expect(
      controller.setFormFolder(asOwner(), formId, { folderId: "nope" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a form is created straight into a folder, and a duplicate inherits it", async () => {
    const f = await controller.createFolder(asOwner(), { name: "Sales" });
    const created = await controller.createForm(asOwner(), {
      name: "Quiz",
      folderId: f.id,
    });
    expect(created.folderId).toBe(f.id);
    const copy = await controller.duplicateForm(asOwner(), created.id);
    expect(copy.folderId).toBe(f.id);
    await expect(
      controller.createForm(asOwner(), { name: "Quiz 2", folderId: "nope" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("deleting a folder unfiles its forms and keeps them", async () => {
    const f = await controller.createFolder(asOwner(), { name: "Sales" });
    await controller.setFormFolder(asOwner(), formId, { folderId: f.id });
    await controller.deleteFolder(asOwner(), f.id);
    const row = (await controller.listForms(asOwner())).find(
      (x) => x.id === formId,
    );
    expect(row).toBeDefined();
    expect(row!.folderId).toBeNull();
  });

  it("a plain member may create folders and move forms (the same rule as creating forms)", async () => {
    const f = await controller.createFolder(asMember(), { name: "Mine" });
    expect(
      await controller.setFormFolder(asMember(), formId, { folderId: f.id }),
    ).toEqual({ id: formId, folderId: f.id });
  });
});
