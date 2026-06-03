import { useState } from 'react'

// Default dollars-per-pip-per-lot. Varies by instrument/broker.
// XAUUSD ≈ $10/pip per 1.00 lot (1 pip = $0.10 move) on most brokers.
const INSTRUMENT_DPP = {
  XAUUSD: 10,
  EURUSD: 10,
  GBPUSD: 10,
  USDJPY: 9.1,
  GBPJPY: 9.1,
  AUDUSD: 10,
  USDCAD: 7.3,
}

export default function Calculators() {
  return (
    <div className="space-y-8 max-w-3xl mx-auto">
      <h2 className="text-xl font-semibold text-white">Calculators</h2>
      <div className="grid md:grid-cols-2 gap-6">
        <PositionSizer />
        <RiskReward />
      </div>
    </div>
  )
}

function PositionSizer() {
  const [balance, setBalance]   = useState('')
  const [riskPct, setRiskPct]   = useState('1')
  const [slPips, setSlPips]     = useState('')
  const [instrument, setInstrument] = useState('XAUUSD')
  const [dpp, setDpp]           = useState(String(INSTRUMENT_DPP.XAUUSD))

  const bal = parseFloat(balance)
  const pct = parseFloat(riskPct)
  const pips = parseFloat(slPips)
  const dollarsPerPip = parseFloat(dpp)

  const riskDollars = bal && pct ? (bal * pct) / 100 : null
  const lotSizeRaw  = riskDollars && pips && dollarsPerPip
    ? riskDollars / (pips * dollarsPerPip)
    : null
  const lotSize = lotSizeRaw != null ? Math.floor(lotSizeRaw * 100) / 100 : null

  const onInstrument = (val) => {
    setInstrument(val)
    if (INSTRUMENT_DPP[val]) setDpp(String(INSTRUMENT_DPP[val]))
  }

  return (
    <Card title="Position Size" subtitle="Risk % → lot size">
      <Row label="Account Balance ($)">
        <Input value={balance} onChange={setBalance} placeholder="e.g. 10000" />
      </Row>
      <Row label="Risk %">
        <Input value={riskPct} onChange={setRiskPct} placeholder="e.g. 1" />
      </Row>
      <Row label="Instrument">
        <select value={instrument} onChange={e => onInstrument(e.target.value)} className={inputCls}>
          {Object.keys(INSTRUMENT_DPP).map(i => <option key={i}>{i}</option>)}
          <option>Other</option>
        </select>
      </Row>
      <Row label="Stop Loss (pips)">
        <Input value={slPips} onChange={setSlPips} placeholder="e.g. 55" />
      </Row>
      <Row label="$ / pip / lot">
        <Input value={dpp} onChange={setDpp} placeholder="e.g. 10" />
      </Row>

      <Results>
        <Result label="Risk in dollars" value={riskDollars != null ? `$${riskDollars.toFixed(2)}` : '—'} />
        <Result
          label="Lot size"
          value={lotSize != null ? lotSize.toFixed(2) : '—'}
          highlight
        />
      </Results>
    </Card>
  )
}

function RiskReward() {
  const [direction, setDirection] = useState('long')
  const [entry, setEntry]   = useState('')
  const [stop, setStop]     = useState('')
  const [target, setTarget] = useState('')

  const e = parseFloat(entry), sl = parseFloat(stop), tp = parseFloat(target)
  let risk = null, reward = null, rr = null
  if (e && sl && tp) {
    risk   = direction === 'long' ? e - sl : sl - e
    reward = direction === 'long' ? tp - e : e - tp
    if (risk > 0 && reward > 0) rr = reward / risk
  }

  return (
    <Card title="Risk : Reward" subtitle="Entry / stop / target → R:R">
      <Row label="Direction">
        <div className="flex gap-2">
          {['long', 'short'].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                direction === d
                  ? d === 'long'
                    ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                    : 'bg-red-500/20 border-red-500 text-red-400'
                  : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              {d === 'long' ? '▲ Long' : '▼ Short'}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Entry Price">
        <Input value={entry} onChange={setEntry} placeholder="e.g. 2320.50" />
      </Row>
      <Row label="Stop Loss">
        <Input value={stop} onChange={setStop} placeholder="e.g. 2315.00" />
      </Row>
      <Row label="Take Profit">
        <Input value={target} onChange={setTarget} placeholder="e.g. 2337.00" />
      </Row>

      <Results>
        <Result label="Risk (price)"   value={risk   != null && risk   > 0 ? risk.toFixed(2)   : '—'} />
        <Result label="Reward (price)" value={reward != null && reward > 0 ? reward.toFixed(2) : '—'} />
        <Result
          label="R : R"
          value={rr != null ? `${rr.toFixed(2)} : 1` : '—'}
          highlight
          color={rr != null && rr >= 2 ? 'text-emerald-400' : rr != null && rr < 1 ? 'text-red-400' : 'text-white'}
        />
      </Results>
    </Card>
  )
}

/* ---- small presentational helpers ---- */

const inputCls = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-emerald-500 w-full'

function Card({ title, subtitle, children }) {
  return (
    <div className="bg-gray-800/60 border border-gray-700/50 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-white font-semibold">{title}</h3>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400 uppercase tracking-wider">{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder }) {
  return (
    <input
      type="number"
      step="any"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={inputCls}
    />
  )
}

function Results({ children }) {
  return <div className="border-t border-gray-700/50 pt-4 space-y-2">{children}</div>
}

function Result({ label, value, highlight, color = 'text-white' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`font-bold ${highlight ? 'text-lg' : 'text-sm'} ${color}`}>{value}</span>
    </div>
  )
}
