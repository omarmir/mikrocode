import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const NOTIFICATION_SETTINGS_ENABLED_COLUMN = "notifications_enabled";

function createServerNotificationSettingsTable(sql: SqlClient.SqlClient) {
  return sql`
    CREATE TABLE IF NOT EXISTS server_notification_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      pushover_app_token TEXT,
      pushover_user_key TEXT,
      updated_at TEXT NOT NULL
    )
  `;
}

function ensureServerNotificationSettingsColumns(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    const columns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(server_notification_settings)
    `;
    if (
      columns.some(
        (column) => column.name.trim().toLowerCase() === NOTIFICATION_SETTINGS_ENABLED_COLUMN,
      )
    ) {
      return;
    }

    yield* sql`
      ALTER TABLE server_notification_settings
      ADD COLUMN notifications_enabled INTEGER NOT NULL DEFAULT 1
    `;
  });
}

export function ensureServerNotificationSettingsTable(sql: SqlClient.SqlClient) {
  return Effect.gen(function* () {
    yield* createServerNotificationSettingsTable(sql);
    yield* ensureServerNotificationSettingsColumns(sql);
  });
}
