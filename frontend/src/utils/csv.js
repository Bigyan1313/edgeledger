const COLUMNS = [
  'id', 'date', 'pair', 'direction', 'setup',
  'entryPrice', 'stopLoss', 'takeProfit', 'exitPrice',
  'lotSize', 'riskDollars', 'pnl', 'outcome',
  'emotionBefore', 'followedChecklist', 'fullPort', 'notes',
]

// Wrap a value in quotes if it contains a comma, quote, or newline.
function escape(value) {
  if (value == null) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export function tradesToCsv(trades) {
  const header = COLUMNS.join(',')
  const rows = trades.map(t =>
    COLUMNS.map(col => escape(t[col])).join(',')
  )
  return [header, ...rows].join('\n')
}

export function downloadCsv(trades) {
  const csv = tradesToCsv(trades)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `edgeledger-trades-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
