CREATE TABLE IF NOT EXISTS saved_queries (
 id uuid PRIMARY KEY,
 connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 sql_cipher text NOT NULL,
 version integer NOT NULL DEFAULT 1,
 archived boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_queries_lookup ON saved_queries(connection_id,user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS query_history (
 id uuid PRIMARY KEY,
 connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 sql_cipher text NOT NULL,
 succeeded boolean NOT NULL,
 duration_ms integer NOT NULL,
 row_count integer,
 truncated boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS query_history_lookup ON query_history(connection_id,user_id,created_at DESC,id DESC);
