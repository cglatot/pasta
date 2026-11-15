export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS instance_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS monitored_servers (
    machine_identifier TEXT PRIMARY KEY,
    server_name TEXT NOT NULL,
    server_url TEXT NOT NULL,
    custom_url_override TEXT,
    owner_plex_user_id INTEGER NOT NULL,
    encrypted_owner_token TEXT NOT NULL,
    auth_status TEXT NOT NULL DEFAULT 'OK',
    last_event_timestamp INTEGER NOT NULL DEFAULT 0,
    is_monitoring_enabled INTEGER NOT NULL DEFAULT 1,
    debounce_seconds INTEGER NOT NULL DEFAULT 30,
    update_level TEXT NOT NULL DEFAULT 'show',
    update_strategy TEXT NOT NULL DEFAULT 'next',
    auto_forced_subtitles INTEGER NOT NULL DEFAULT 1,
    trigger_on_play INTEGER NOT NULL DEFAULT 1,
    trigger_on_scan INTEGER NOT NULL DEFAULT 1,
    trigger_on_activity INTEGER NOT NULL DEFAULT 1,
    retention_days INTEGER NOT NULL DEFAULT 90,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS server_users (
    machine_identifier TEXT NOT NULL,
    plex_user_id INTEGER NOT NULL,
    uuid TEXT NOT NULL DEFAULT '',
    username TEXT NOT NULL,
    title TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    thumb TEXT NOT NULL DEFAULT '',
    is_home_user INTEGER NOT NULL DEFAULT 0,
    is_protected INTEGER NOT NULL DEFAULT 0,
    is_server_owner INTEGER NOT NULL DEFAULT 0,
    is_pasta_admin INTEGER NOT NULL DEFAULT 0,
    encrypted_access_token TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (machine_identifier, plex_user_id)
);

CREATE TABLE IF NOT EXISTS automation_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_identifier TEXT NOT NULL,
    scope_type TEXT NOT NULL,
    target_key TEXT NOT NULL,
    target_title TEXT NOT NULL DEFAULT '',
    parent_key TEXT,
    policy TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (machine_identifier, scope_type, target_key)
);

CREATE TABLE IF NOT EXISTS episode_parts (
    machine_identifier TEXT NOT NULL,
    episode_rating_key TEXT NOT NULL,
    part_id INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (machine_identifier, episode_rating_key)
);

CREATE TABLE IF NOT EXISTS episode_baselines (
    machine_identifier TEXT NOT NULL,
    plex_user_id INTEGER NOT NULL,
    episode_rating_key TEXT NOT NULL,
    audio_stream_id INTEGER NOT NULL DEFAULT 0,
    subtitle_stream_id INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (machine_identifier, plex_user_id, episode_rating_key)
);

CREATE TABLE IF NOT EXISTS auto_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_identifier TEXT NOT NULL,
    plex_user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    show_rating_key TEXT NOT NULL,
    show_title TEXT NOT NULL,
    reference_episode_key TEXT NOT NULL,
    reference_episode_label TEXT NOT NULL,
    audio_summary TEXT,
    subtitle_summary TEXT,
    updated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auto_operation_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation_id INTEGER NOT NULL REFERENCES auto_operations(id) ON DELETE CASCADE,
    episode_rating_key TEXT NOT NULL,
    episode_label TEXT NOT NULL,
    target_username TEXT,
    change_applied TEXT NOT NULL,
    match_reason TEXT NOT NULL,
    was_updated INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS manual_batch_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_identifier TEXT NOT NULL,
    initiated_by_user_id INTEGER NOT NULL,
    initiated_by_username TEXT NOT NULL,
    target_users_mode TEXT NOT NULL,
    target_users_summary TEXT NOT NULL,
    target_user_ids_json TEXT NOT NULL,
    scope TEXT NOT NULL,
    target_title TEXT NOT NULL,
    stream_type TEXT NOT NULL,
    selected_stream_name TEXT NOT NULL,
    updated_count INTEGER NOT NULL DEFAULT 0,
    skipped_count INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auto_ops_machine_created
    ON auto_operations (machine_identifier, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auto_op_eps_operation
    ON auto_operation_episodes (operation_id);

CREATE INDEX IF NOT EXISTS idx_manual_logs_machine_created
    ON manual_batch_logs (machine_identifier, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_manual_logs_initiator
    ON manual_batch_logs (machine_identifier, initiated_by_user_id, created_at DESC);
`;
