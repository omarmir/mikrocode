/**
 * ReadModelQuery - In-memory orchestration read-model query service interface.
 *
 * Exposes the current orchestration read model directly from the live engine so
 * hot-path consumers do not need to rehydrate snapshots from projection tables.
 *
 * @module ReadModelQuery
 */
import type { OrchestrationReadModel } from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

/**
 * ReadModelQueryShape - Service API for in-memory read-model snapshots.
 */
export interface ReadModelQueryShape {
  /**
   * Read the latest in-memory orchestration snapshot.
   */
  readonly getSnapshot: () => Effect.Effect<OrchestrationReadModel, never, never>;
}

/**
 * ReadModelQuery - Service tag for in-memory read-model snapshots.
 */
export class ReadModelQuery extends ServiceMap.Service<ReadModelQuery, ReadModelQueryShape>()(
  "t3/orchestration/Services/ReadModelQuery",
) {}
