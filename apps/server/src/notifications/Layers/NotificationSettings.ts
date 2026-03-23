import type { ServerNotificationSettings } from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { ensureServerNotificationSettingsTable } from "../persistence.ts";
import { toPersistenceSqlError } from "../../persistence/Errors.ts";
import {
  NotificationSettingsService,
  type NotificationSettingsShape,
} from "../Services/NotificationSettings.ts";

const NotificationSettingsDbRow = Schema.Struct({
  appToken: Schema.NullOr(Schema.String),
  userKey: Schema.NullOr(Schema.String),
});

const EmptySettingsRequest = Schema.Struct({});

function toNotificationSettings(
  row: typeof NotificationSettingsDbRow.Type | null,
): ServerNotificationSettings {
  const appToken = row?.appToken ?? null;
  const userKey = row?.userKey ?? null;

  return {
    pushover: {
      appToken,
      userKey,
      configured: appToken !== null && userKey !== null,
    },
  };
}

const makeNotificationSettingsService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureServerNotificationSettingsTable(sql).pipe(
    Effect.mapError(toPersistenceSqlError("NotificationSettingsService.ensureTable:query")),
  );

  const getNotificationSettingsRow = SqlSchema.findOneOption({
    Request: EmptySettingsRequest,
    Result: NotificationSettingsDbRow,
    execute: () =>
      sql`
        SELECT
          pushover_app_token AS "appToken",
          pushover_user_key AS "userKey"
        FROM server_notification_settings
        WHERE id = 1
      `,
  });

  const upsertNotificationSettingsRow = SqlSchema.void({
    Request: Schema.Struct({
      appToken: Schema.NullOr(Schema.String),
      userKey: Schema.NullOr(Schema.String),
      updatedAt: Schema.String,
    }),
    execute: ({ appToken, userKey, updatedAt }) =>
      sql`
        INSERT INTO server_notification_settings (
          id,
          pushover_app_token,
          pushover_user_key,
          updated_at
        )
        VALUES (
          1,
          ${appToken},
          ${userKey},
          ${updatedAt}
        )
        ON CONFLICT (id)
        DO UPDATE SET
          pushover_app_token = excluded.pushover_app_token,
          pushover_user_key = excluded.pushover_user_key,
          updated_at = excluded.updated_at
      `,
  });

  const getSettings: NotificationSettingsShape["getSettings"] = getNotificationSettingsRow({}).pipe(
    Effect.mapError(toPersistenceSqlError("NotificationSettingsService.getSettings:query")),
    Effect.map((row) => toNotificationSettings(Option.getOrNull(row))),
  );

  const setSettings: NotificationSettingsShape["setSettings"] = (input) =>
    upsertNotificationSettingsRow({
      appToken: input.pushover.appToken,
      userKey: input.pushover.userKey,
      updatedAt: new Date().toISOString(),
    }).pipe(
      Effect.mapError(toPersistenceSqlError("NotificationSettingsService.setSettings:query")),
      Effect.flatMap(() => getSettings),
    );

  return {
    getSettings,
    setSettings,
  } satisfies NotificationSettingsShape;
});

export const NotificationSettingsLive = Layer.effect(
  NotificationSettingsService,
  makeNotificationSettingsService,
);
