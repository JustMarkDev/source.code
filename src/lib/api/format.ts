import { format } from 'oxfmt'

/**
 * Formats generated files the way `vp fmt` does, so a regenerated file matches
 * what is committed. Keep these options equal to the `fmt` block in
 * `vite.config.ts`; the tests that compare generated output with the committed
 * files fail when they drift.
 */
export async function formatSource(
  fileName: string,
  text: string,
): Promise<string> {
  const { code, errors } = await format(fileName, text, {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 80,
  })
  const failure = errors.find((e) => e.severity === 'Error')
  if (failure) throw new Error(`${fileName}: ${failure.message}`)
  return code
}
