// @ts-nocheck
import type {
  ServerNotificationSettings,
  ServerSetNotificationSettingsInput,
} from "@t3tools/contracts";
import { Context } from "effect";
import type { Effect } from "effect";

import type { PersistenceSqlError } from "../../persistence/Errors.ts";

export interface NotificationSettingsShape {
  readonly getSettings: Effect.Effect<ServerNotificationSettings, PersistenceSqlError>;
  readonly setSettings: (
    input: ServerSetNotificationSettingsInput,
  ) => Effect.Effect<ServerNotificationSettings, PersistenceSqlError>;
}

export class NotificationSettingsService extends Context.Service<
  NotificationSettingsService,
  NotificationSettingsShape
>()("t3/notifications/Services/NotificationSettings/NotificationSettingsService") {}
