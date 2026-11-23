ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress_method text NOT NULL DEFAULT 'duration' CHECK (progress_method IN ('duration','equal'));
