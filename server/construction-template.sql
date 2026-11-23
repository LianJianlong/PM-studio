ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_profile text NOT NULL DEFAULT 'generic' CHECK(template_profile IN ('generic','hospital','stadium'));
ALTER TABLE project_business_templates DROP CONSTRAINT IF EXISTS project_business_templates_kind_check;
ALTER TABLE project_business_templates ADD CONSTRAINT project_business_templates_kind_check CHECK(kind IN ('table','view','report','workflow','dictionary'));
