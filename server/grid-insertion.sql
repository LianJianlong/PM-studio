ALTER TABLE records ADD COLUMN IF NOT EXISTS row_position numeric;
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS row_position numeric;
ALTER TABLE project_resources ADD COLUMN IF NOT EXISTS custom_values jsonb NOT NULL DEFAULT '{}';
-- Preserve the existing timestamp/UUID order even when multiple rows share a timestamp.
CREATE OR REPLACE FUNCTION grid_base_position(created timestamptz, key uuid) RETURNS numeric
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
 SELECT (extract(epoch from created AT TIME ZONE 'UTC')*1000000)*340282366920938463463374607431768211456::numeric
 + (('x'||substr(hex,1,8))::bit(32)::bigint)::numeric*79228162514264337593543950336::numeric
 + (('x'||substr(hex,9,8))::bit(32)::bigint)::numeric*18446744073709551616::numeric
 + (('x'||substr(hex,17,8))::bit(32)::bigint)::numeric*4294967296::numeric
 + (('x'||substr(hex,25,8))::bit(32)::bigint)::numeric
 FROM (SELECT replace(key::text,'-','') hex) AS parts
$$;
CREATE INDEX IF NOT EXISTS records_grid_position ON records(table_id,(coalesce(row_position,grid_base_position(created_at,id))),id) WHERE lifecycle<>'deleted';
CREATE INDEX IF NOT EXISTS resources_grid_position ON project_resources(project_id,(coalesce(row_position,grid_base_position(created_at,id))),id) WHERE active;
