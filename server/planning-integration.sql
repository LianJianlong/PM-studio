ALTER TABLE network_plans ADD COLUMN IF NOT EXISTS diagram_layout jsonb NOT NULL DEFAULT '{}';
ALTER TABLE network_plans ADD COLUMN IF NOT EXISTS calendar_config jsonb;
ALTER TABLE network_plans ADD COLUMN IF NOT EXISTS import_snapshot jsonb;
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS sale_rate numeric(20,4) NOT NULL DEFAULT 0 CHECK(sale_rate>=0);
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS tax_rate numeric(8,4) NOT NULL DEFAULT 0 CHECK(tax_rate BETWEEN 0 AND 100);
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS stock_quantity numeric(20,4) NOT NULL DEFAULT 0 CHECK(stock_quantity>=0);
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS productivity_unit text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS provisioned_initial_password boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS aoa_layout jsonb NOT NULL DEFAULT '{}';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS aoa_layout_revision integer NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CNY';
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'CNY';

ALTER TABLE network_plans ADD COLUMN IF NOT EXISTS decisions jsonb NOT NULL DEFAULT '[]';
