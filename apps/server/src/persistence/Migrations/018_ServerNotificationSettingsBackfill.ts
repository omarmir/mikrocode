import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ensureServerNotificationSettingsTable } from "../../notifications/persistence.ts";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Some existing local databases already recorded a different migration as id 17.
  // Re-running the table creation under a new id lets those databases converge safely.
  yield* ensureServerNotificationSettingsTable(sql);
});
