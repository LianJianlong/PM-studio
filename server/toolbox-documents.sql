CREATE TABLE IF NOT EXISTS toolbox_document_folders(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),parent_id uuid REFERENCES toolbox_document_folders(id),name text NOT NULL,version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS toolbox_document_folders_project ON toolbox_document_folders(project_id);
CREATE TABLE IF NOT EXISTS toolbox_documents(id uuid PRIMARY KEY,project_id uuid NOT NULL REFERENCES projects(id),folder_id uuid REFERENCES toolbox_document_folders(id),name text NOT NULL,content text NOT NULL DEFAULT '<p></p>',page jsonb NOT NULL DEFAULT '{}',version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS toolbox_documents_project_folder ON toolbox_documents(project_id,folder_id);

ALTER TABLE toolbox_documents ADD COLUMN IF NOT EXISTS univer jsonb;
