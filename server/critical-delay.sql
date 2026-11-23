-- Add mandatory-date choices to the same native activity field; never rewrite records.
UPDATE data_tables t SET columns=(
 SELECT jsonb_agg(CASE WHEN f->>'id'='constraint_type' AND f->>'type'='single_select'
 THEN jsonb_set(f,'{options}',COALESCE(f->'options','[]'::jsonb)||
   (SELECT COALESCE(jsonb_agg(to_jsonb(v)),'[]'::jsonb) FROM (VALUES('强制开始'),('强制完成')) names(v) WHERE NOT COALESCE(f->'options','[]'::jsonb)?v))
 ELSE f END ORDER BY ordinal)
 FROM jsonb_array_elements(t.columns) WITH ORDINALITY fields(f,ordinal)
) WHERE EXISTS(SELECT 1 FROM plan_data_tables p WHERE p.table_id=t.id)
AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.columns) f WHERE f->>'id'='constraint_type' AND f->>'type'='single_select' AND (NOT COALESCE(f->'options','[]'::jsonb)?'强制开始' OR NOT COALESCE(f->'options','[]'::jsonb)?'强制完成'));
