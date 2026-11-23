ALTER TABLE project_files ADD COLUMN IF NOT EXISTS external_url text;
ALTER TABLE project_files DROP CONSTRAINT IF EXISTS project_files_kind_check;
ALTER TABLE project_files ADD CONSTRAINT project_files_kind_check CHECK(kind IN ('folder','file','link'));
ALTER TABLE project_files DROP CONSTRAINT IF EXISTS project_files_check;
ALTER TABLE project_files ADD CONSTRAINT project_files_check CHECK(
 (kind='folder' AND mime_type IS NULL AND current_version=0 AND external_url IS NULL)
 OR (kind='file' AND mime_type IS NOT NULL AND current_version>0 AND external_url IS NULL)
 OR (kind='link' AND external_url IS NOT NULL AND mime_type IS NULL AND current_version=0 AND length(external_url) BETWEEN 1 AND 2000 AND external_url ~ '^(https?|smb)://')
);
ALTER TABLE project_file_versions DROP CONSTRAINT IF EXISTS project_file_versions_size_bytes_check;
ALTER TABLE project_file_versions ADD CONSTRAINT project_file_versions_size_bytes_check CHECK(size_bytes>=0 AND size_bytes<5242880);
