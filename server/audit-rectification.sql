ALTER TABLE activity_resource_allocations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_policy_version integer NOT NULL DEFAULT 0;
ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_kind_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_check CHECK(kind IN ('record','access','stage','baseline','resource'));
ALTER TABLE workflow_definitions DROP CONSTRAINT IF EXISTS workflow_definitions_kind_check;
ALTER TABLE workflow_definitions ADD CONSTRAINT workflow_definitions_kind_check CHECK(kind IN ('record','access','stage','baseline','resource'));
