import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ensureServerNotificationSettingsTable } from "../../notifications/persistence.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* ensureServerNotificationSettingsTable(sql);
});
