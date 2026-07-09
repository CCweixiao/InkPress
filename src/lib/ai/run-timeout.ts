export function createRunAbortSignal(
  requestSignal: AbortSignal,
  timeoutMs: number
): AbortSignal {
  return AbortSignal.any([
    requestSignal,
    AbortSignal.timeout(Math.max(1, timeoutMs)),
  ]);
}
