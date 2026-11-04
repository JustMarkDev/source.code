import { Data } from 'effect'

/**
 * Expected failures. Each one is a tagged error, so a caller can handle it by
 * name (`Effect.catchTag('NotFound', ...)`) and the compiler tracks which
 * failures are still unhandled.
 *
 * Add a new error here when a failure needs different handling from the ones
 * below. Do not use these for bugs: a bug is a defect, and should throw.
 */

/** The thing asked for does not exist. Becomes a 404. */
export class NotFound extends Data.TaggedError('NotFound')<{
  readonly what: string
}> {}

/** A dependency (Convex, the git store) did not answer in time or failed. */
export class BackendUnavailable extends Data.TaggedError('BackendUnavailable')<{
  readonly service: string
  readonly cause?: unknown
}> {}

/** Input from the client did not pass validation. Becomes a 400. */
export class InvalidInput extends Data.TaggedError('InvalidInput')<{
  readonly field: string
}> {}

export type AppError = NotFound | BackendUnavailable | InvalidInput
