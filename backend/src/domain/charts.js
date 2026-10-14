// Chart images attached to plans and reviews: compressed data URLs, a few at
// most. One rule for both, so a chart that is fine on a review is never
// refused on a plan.

export const MAX_CHARTS = 3
// A compressed chart is a few hundred KB as base64; this only stops a pasted
// full-resolution PNG from becoming a multi-megabyte row.
const MAX_CHART_CHARS = 4_000_000

export function validateCharts(list, field = 'screenshots') {
  if (!Array.isArray(list)) return [{ field, message: 'Charts must be a list of images.' }]
  if (list.length > MAX_CHARTS) return [{ field, message: `At most ${MAX_CHARTS} charts.` }]
  if (list.some(s => typeof s !== 'string' || !s.startsWith('data:image/') || s.length > MAX_CHART_CHARS)) {
    return [{ field, message: 'Each chart must be an image under about 3MB.' }]
  }
  return []
}
