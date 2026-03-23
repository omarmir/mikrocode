import * as SqlClient from "effect/unstable/sql/SqlClient";

export function ensureServerNotificationSettingsTable(sql: SqlClient.SqlClient) {
  return sql`
    CREATE TABLE IF NOT EXISTS server_notification_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pushover_app_token TEXT,
      pushover_user_key TEXT,
      updated_at TEXT NOT NULL
    )
  `;
}
