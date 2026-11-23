CREATE TABLE IF NOT EXISTS user_view_preferences(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,key text NOT NULL,value jsonb NOT NULL,version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,key));
GRANT SELECT,INSERT,UPDATE,DELETE ON user_view_preferences TO studio_app;
