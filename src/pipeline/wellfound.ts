/**
 * Wellfound-specific pipeline.
 *
 * Minimal pipeline — no resume state, no settings loading.
 */

/**
 * Run the Wellfound pipeline.
 *
 * @param signal   - AbortSignal for cancellation
 * @param onProgress - Optional progress callback
 */
export async function runWellfoundPipeline(
  signal: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<void> {
  console.log("[SOS] Wellfound: Pipeline started")
  signal.throwIfAborted()

  // TODO: Implement full Wellfound pipeline logic
  onProgress?.("Wellfound pipeline — coming soon")

  // Placeholder: keep the pipeline alive briefly for testing
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 2000)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })
}
