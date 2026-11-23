ALTER TABLE project_dashboard_widgets DROP CONSTRAINT IF EXISTS project_dashboard_widgets_kind_check;
ALTER TABLE project_dashboard_widgets ADD CONSTRAINT project_dashboard_widgets_kind_check CHECK(kind IN ('progress','safety','quality','design','procurement','todo','earned','custom'));
