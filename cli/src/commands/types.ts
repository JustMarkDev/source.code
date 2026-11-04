import type { Ctx } from '../output'
import type { Parsed } from '../args'

export type Command = (
  args: { rest: Array<string>; flags: Parsed['flags'] },
  ctx: Ctx,
) => number | void | Promise<number | void>
