-- Repair only recognizable legacy templates; preserve user-defined calendars and exceptions.
UPDATE projects SET calendar_config = calendar_config || jsonb_build_object('hours_per_month',730), calendar_version=calendar_version+1
WHERE calendar_config->>'hours_per_day'='24' AND calendar_config->>'hours_per_week'='168'
 AND calendar_config->>'hours_per_month'='720' AND calendar_config->>'hours_per_year'='8760'
 AND calendar_config->'week'='[[["00:00","24:00"]],[["00:00","24:00"]],[["00:00","24:00"]],[["00:00","24:00"]],[["00:00","24:00"]],[["00:00","24:00"]],[["00:00","24:00"]]]'::jsonb;
UPDATE projects SET calendar_config = calendar_config || jsonb_build_object('hours_per_month',2080.0/12), calendar_version=calendar_version+1
WHERE calendar_config->>'hours_per_day'='8' AND calendar_config->>'hours_per_week'='40'
 AND calendar_config->>'hours_per_month'='172' AND calendar_config->>'hours_per_year'='2080'
 AND calendar_config->'week'='[[],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]],[]]'::jsonb;
UPDATE projects SET calendar_config = calendar_config || jsonb_build_object('hours_per_month',208,'hours_per_year',2496), calendar_version=calendar_version+1
WHERE calendar_config->>'hours_per_day'='8' AND calendar_config->>'hours_per_week'='48'
 AND calendar_config->>'hours_per_month'='172' AND calendar_config->>'hours_per_year'='2080'
 AND calendar_config->'week'='[[],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]],[["08:00","12:00"],["13:00","17:00"]]]'::jsonb;
