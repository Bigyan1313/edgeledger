import { CircleDot } from 'lucide-react'

// The reference composition, mapped onto what EdgeLedger actually has: a dark
// card with a dimmed label, a status pill, an oversized figure whose decimals
// drop back to grey, and the stacked violet cards beneath it.
//
// In the reference those stacked cards are payment cards. Here they are the
// trading accounts the P&L came from, which is the same shape carrying real
// information rather than decoration.
export default function BalanceCard({ netPnl, accounts = [], openCount = 0, totalTrades = 0 }) {
  const negative = netPnl < 0
  const [whole, fraction] = Math.abs(netPnl).toFixed(2).split('.')
  const withCommas = Number(whole).toLocaleString('en-US')

  // Two at most: the reference stacks two, and a third would crowd the tier.
  const shown = accounts.slice(0, 2)

  return (
    <div className="card overflow-hidden">
      <div className="px-6 pt-5 pb-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-medium text-bright">Net P&amp;L</span>
          <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold px-3 py-1.5 rounded-full border ${
            openCount > 0
              ? 'bg-violet/15 text-violet-soft border-violet/35'
              : 'bg-gain-bg text-gain border-gain/35'
          }`}>
            <CircleDot size={12} strokeWidth={2.5} />
            {openCount > 0 ? `${openCount} open` : 'Flat'}
          </span>
        </div>

        <div className={`mt-4 text-[54px] leading-none font-semibold tracking-[-0.03em] tnum ${negative ? 'text-loss' : 'text-bright'}`}>
          {negative ? '−' : ''}${withCommas}<span className="text-muted">.{fraction}</span>
        </div>

        <div className="mt-2 text-[13px] text-muted tnum">
          across {totalTrades} closed {totalTrades === 1 ? 'trade' : 'trades'}
        </div>
      </div>

      {/* The stacked tier. Overlapping radii and a lighter second card reproduce
          the reference's layered look. */}
      {shown.length > 0 && (
        <div className="-mt-2">
          {shown.map((account, i) => {
            const top = i === 0
            return (
              <div
                key={account.id}
                className={`flex items-center justify-between px-6 py-4 rounded-[22px] ${top ? '-mb-4 relative z-10' : ''}`}
                style={{
                  background: top
                    ? 'linear-gradient(180deg, #5f59ec 0%, #524bdf 100%)'
                    : 'linear-gradient(180deg, #c1b0f8 0%, #b09bf2 100%)',
                  boxShadow: top ? '0 10px 26px -14px rgb(0 0 0 / 0.85)' : undefined,
                }}
              >
                <span className={`text-[15px] font-semibold tnum ${top ? 'text-white' : 'text-violet-deep'}`}>
                  {account.name}
                </span>
                <span className={`text-[12px] font-bold tracking-wide uppercase ${top ? 'text-white/85' : 'text-violet-deep/75'}`}>
                  {account.mode}{account.propFirm ? ` · ${account.propFirm}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
