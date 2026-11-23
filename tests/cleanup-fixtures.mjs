// Maintenance cleanup restricted to test manifests created by integration.mjs.
// Pass --keep-browser while continuing browser QA. Does not delete user projects.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const keepBrowser = process.argv.includes("--keep-browser");
const selectedManifest = process.argv.find((arg) => arg.startsWith("--manifest="))?.slice("--manifest=".length);
if (selectedManifest) assert.match(selectedManifest, /^fixtures(?:-[a-z0-9]+)?\.json$/);
const files = selectedManifest ? [selectedManifest] : (await fs.readdir("work/qa")).filter((f) =>
  /^fixtures(?:-[a-z0-9]+)?\.json$/.test(f),
);
for (const filename of files) {
  const manifest = JSON.parse(
    await fs.readFile(path.join("work/qa", filename), "utf8"),
  );
  assert.match(manifest.tag, /^[a-z0-9]+$/);
  for (const id of [
    manifest.workspace,
    ...manifest.users,
    ...(manifest.browser ? [manifest.browser.id] : []),
  ])
    assert.match(id, /^[a-f0-9-]{36}$/);
  const fixtureUsers = [
    ...manifest.users,
    ...(!keepBrowser && manifest.browser ? [manifest.browser.id] : []),
  ];
  const userArray = `ARRAY[${fixtureUsers.map((id) => `'${id}'::uuid`).join(",")}]::uuid[]`;
  const workspace = manifest.workspace;
  const sql = `BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM workspaces WHERE id='${workspace}' AND name<>'QA集成验证 ${manifest.tag}') THEN RAISE EXCEPTION 'Not a QA workspace'; END IF;
 IF EXISTS(SELECT 1 FROM users WHERE id=ANY(${userArray}) AND username NOT LIKE 'qa_%${manifest.tag}%') THEN RAISE EXCEPTION 'Not a QA user'; END IF;
END $$;
CREATE TEMP TABLE qa_projects AS SELECT id FROM projects WHERE workspace_id='${workspace}';
CREATE TEMP TABLE qa_tables AS SELECT id FROM data_tables WHERE project_id IN(SELECT id FROM qa_projects);
CREATE TEMP TABLE qa_records AS SELECT id FROM records WHERE table_id IN(SELECT id FROM qa_tables) OR created_by=ANY(${userArray});
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM record_references WHERE target_id IN(SELECT id FROM qa_records) AND source_id NOT IN(SELECT id FROM qa_records)) THEN RAISE EXCEPTION 'Non-fixture record references QA target; refusing cleanup'; END IF;
END $$;
DELETE FROM record_references WHERE source_id IN(SELECT id FROM qa_records);
DELETE FROM record_file_links WHERE record_id IN(SELECT id FROM qa_records);
DELETE FROM record_activity_links WHERE record_id IN(SELECT id FROM qa_records);
DELETE FROM owner_item_events WHERE item_id IN(SELECT id FROM owner_items WHERE project_id IN(SELECT id FROM qa_projects));
DELETE FROM owner_items WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM project_files WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM notifications WHERE project_id IN(SELECT id FROM qa_projects) OR user_id=ANY(${userArray});
DELETE FROM approval_events WHERE approval_id IN(SELECT id FROM approvals WHERE project_id IN(SELECT id FROM qa_projects) OR record_id IN(SELECT id FROM qa_records) OR requester_id=ANY(${userArray}) OR approver_id=ANY(${userArray})) OR actor_id=ANY(${userArray});
DELETE FROM approvals WHERE project_id IN(SELECT id FROM qa_projects) OR record_id IN(SELECT id FROM qa_records) OR requester_id=ANY(${userArray}) OR approver_id=ANY(${userArray});
DELETE FROM import_batches WHERE table_id IN(SELECT id FROM qa_tables) OR user_id=ANY(${userArray});
DELETE FROM plan_activity_records WHERE record_id IN(SELECT id FROM qa_records);
DELETE FROM planning_tables WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM plan_data_tables WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM records WHERE id IN(SELECT id FROM qa_records);
DELETE FROM saved_views WHERE table_id IN(SELECT id FROM qa_tables) OR user_id=ANY(${userArray});
DELETE FROM data_tables WHERE id IN(SELECT id FROM qa_tables);
DELETE FROM reports WHERE project_id IN(SELECT id FROM qa_projects) OR created_by=ANY(${userArray});
DELETE FROM report_documents WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM visual_reports WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM baselines WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM todos WHERE project_id IN(SELECT id FROM qa_projects) OR owner_id=ANY(${userArray});
DELETE FROM project_resources WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM activities WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM memberships WHERE project_id IN(SELECT id FROM qa_projects) OR user_id=ANY(${userArray});
DELETE FROM departments WHERE project_id IN(SELECT id FROM qa_projects);
DELETE FROM workflow_definitions WHERE project_id IN(SELECT id FROM qa_projects) OR created_by=ANY(${userArray});
DELETE FROM projects WHERE id IN(SELECT id FROM qa_projects);
DELETE FROM connections WHERE workspace_id='${workspace}';
DELETE FROM audit_log WHERE workspace_id='${workspace}' OR actor_id=ANY(${userArray});
DELETE FROM workspace_members WHERE workspace_id='${workspace}' OR user_id=ANY(${userArray});
DELETE FROM workspaces WHERE id='${workspace}';
DELETE FROM sessions WHERE user_id=ANY(${userArray});
DELETE FROM users WHERE id=ANY(${userArray});
COMMIT;`;
  const result = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "studio",
      "-d",
      "project_studio",
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    { input: sql, encoding: "utf8" },
  );
  if (result.status !== 0)
    throw Error("Fixture cleanup rolled back: " + result.stderr);
  console.log(
    `CLEANED ${filename}${keepBrowser ? " (browser fixture retained)" : ""}`,
  );
  if (!keepBrowser)
    await fs.rename(
      path.join("work/qa", filename),
      path.join("work/qa", filename + ".cleaned"),
    );
}
