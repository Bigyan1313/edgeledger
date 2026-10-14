import { request } from './client.js'

// The daily price action review. The server decides which day a review is
// for, from the market's clock — there is no date to send.
export const reviewsApi = {
  today: () => request('/reviews/today'),
  list: ({ all = false } = {}) => request(`/reviews${all ? '?all=true' : ''}`),
  get: (id) => request(`/reviews/${id}`),
  create: (data) => request('/reviews', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/reviews/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
}

export const DAY_TYPES = [
  { value: 'trend_up', label: 'Trend up' },
  { value: 'trend_down', label: 'Trend down' },
  { value: 'range', label: 'Range' },
  { value: 'reversal', label: 'Reversal' },
  { value: 'chop', label: 'Chop' },
]
export const LIQUIDITY_TAKEN = [
  { value: 'buy_side', label: 'Buy-side' },
  { value: 'sell_side', label: 'Sell-side' },
  { value: 'both', label: 'Both' },
  { value: 'neither', label: 'Neither' },
]
export const PLAN_OUTCOMES = [
  { value: 'yes', label: 'Yes' },
  { value: 'partly', label: 'Partly' },
  { value: 'no', label: 'No' },
]
export const MIN_SUMMARY = 20
export const MAX_REVIEW_SCREENSHOTS = 3
