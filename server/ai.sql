CREATE TABLE IF NOT EXISTS ai_configs (
 workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
 provider text NOT NULL,
 config_cipher text NOT NULL,
 version integer NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,provider)
);
