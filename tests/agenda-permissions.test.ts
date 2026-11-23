import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rowAllowed,
  rowScopeAllowed,
  recordVisibilitySql,
  canConfirmRecord,
  canRecordAction,
  tableAllowed,
} from "../server/auth.ts";
const table = {
  id: "agenda",
  is_agenda: true,
  department_id: "manager-dept",
  lifecycle: "active",
  columns: [],
};
const editor = {
  role: "editor",
  row_scope: "all",
  department_id: "engineering",
  table_ids: ["other"],
  crud_permissions: { $data: { read: false, update: false } },
  hidden_columns: [],
  confirmation_table_ids: ["agenda"],
};
test("personal agenda ownership overrides authorship, approved state and department confirmation grants", () => {
  const row = {
    table_id: "agenda",
    agenda_owner_id: "owner",
    created_by: "creator",
    updated_by: "editor",
    status: "approved",
  };
  for (const user of ["creator", "editor", "other"]) {
    assert(!rowAllowed(editor, row, user));
    assert(!rowScopeAllowed(editor, row, user));
  }
  assert(rowAllowed({ ...editor, row_scope: "own" }, row, "owner"));
  assert(rowScopeAllowed({ ...editor, row_scope: "own" }, row, "owner"));
  for (const role of ["owner", "manager"])
    assert(rowAllowed({ ...editor, role }, row, "other"));
  assert(!canConfirmRecord({ ...editor, role: "reviewer" }, table));
  assert(canConfirmRecord({ ...editor, role: "manager" }, table));
});
test("agenda is accessible across department table allowlists while readonly members cannot write", () => {
  assert(tableAllowed(editor, table));
  assert(canRecordAction(editor, table, "create"));
  for (const action of ["create", "update", "delete"] as const)
    assert(!canRecordAction({ ...editor, role: "viewer" }, table, action));
  assert(canRecordAction({ ...editor, role: "viewer" }, table, "read"));
  assert(!tableAllowed(editor, { ...table, lifecycle: "deleted" }));
});
test("SQL visibility guards all normal sharing predicates behind a non-agenda condition", () => {
  const sql = recordVisibilitySql(editor, "$3");
  assert(sql.includes("r.agenda_owner_id=$3::uuid"));
  assert(sql.includes("r.agenda_owner_id IS NULL AND (r.status='approved'"));
  const normal = {
    agenda_owner_id: null,
    table_id: "other",
    created_by: "creator",
    updated_by: "editor",
    status: "approved",
  };
  assert(rowAllowed(editor, normal, "other"));
  assert(!rowAllowed(editor, { ...normal, status: "draft" }, "other"));
});
