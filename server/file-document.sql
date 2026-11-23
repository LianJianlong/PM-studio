ALTER TABLE project_files ADD COLUMN IF NOT EXISTS summary text NOT NULL DEFAULT '';
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS document_revision text NOT NULL DEFAULT '';
ALTER TABLE project_files ADD COLUMN IF NOT EXISTS document_status text NOT NULL DEFAULT 'draft' CHECK(document_status IN ('draft','issued','invalid','abolished'));
ALTER TABLE project_files DROP CONSTRAINT IF EXISTS project_files_document_metadata_check;
ALTER TABLE project_files ADD CONSTRAINT project_files_document_metadata_check CHECK(length(summary)<=2000 AND length(document_revision)<=40);
