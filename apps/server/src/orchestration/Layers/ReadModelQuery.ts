import { Effect, Layer } from "effect";

import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ReadModelQuery, type ReadModelQueryShape } from "../Services/ReadModelQuery.ts";

const makeReadModelQuery = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;

  return {
    getSnapshot: () => orchestrationEngine.getReadModel(),
  } satisfies ReadModelQueryShape;
});

export const OrchestrationReadModelQueryLive = Layer.effect(ReadModelQuery, makeReadModelQuery);
