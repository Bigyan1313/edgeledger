import { useState, useEffect } from 'react'

// Full-screen loading state shown while the first API call is in flight.
// On Render's free tier the backend sleeps after ~15 idle minutes and takes
// ~30-60s to wake, so a quick load shows just the balloon — and only if it
// drags on do we fade in the explanation (no excuse needed for a fast load).
export default function WakingScreen() {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 4000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="fixed inset-0 bg-gray-900 overflow-hidden flex items-center justify-center">
      <style>{`
        @keyframes balloon-wander {
          0%   { transform: translate(-12vw, 62vh); }
          20%  { transform: translate(14vw, 18vh); }
          40%  { transform: translate(44vw, 48vh); }
          60%  { transform: translate(68vw, 8vh); }
          80%  { transform: translate(86vw, 52vh); }
          100% { transform: translate(112vw, 22vh); }
        }
        @keyframes balloon-bob {
          0%, 100% { transform: translateY(0) rotate(-2.5deg); }
          50%      { transform: translateY(-16px) rotate(2.5deg); }
        }
        .balloon-track {
          position: absolute;
          top: 0;
          left: 0;
          animation: balloon-wander 18s linear infinite;
          will-change: transform;
        }
        .balloon-bob {
          animation: balloon-bob 3.4s ease-in-out infinite;
        }
      `}</style>

      {/* the wanderer (behind the text) */}
      <div className="balloon-track" aria-hidden="true">
        <div className="balloon-bob">
          <BalloonSvg />
        </div>
      </div>

      <div className="relative z-10 text-center px-6">
        <h1 className="text-2xl font-bold text-white mb-2">
          Edge<span className="text-emerald-400">Ledger</span>
        </h1>
        <p className="text-gray-400">Loading your trades…</p>
        <p
          className={`text-sm text-gray-500 mt-3 max-w-xs mx-auto transition-opacity duration-700 ${
            slow ? 'opacity-100' : 'opacity-0'
          }`}
        >
          The free server naps after 15 quiet minutes — waking it up can take
          ~30–60 seconds. Enjoy the balloon ride meanwhile. 🎈
        </p>
      </div>
    </div>
  )
}

function BalloonSvg() {
  return (
    <svg width="84" height="112" viewBox="0 0 84 112" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* envelope */}
      <path d="M42 2 C18 2 4 20 4 40 C4 58 22 73 34 81 L50 81 C62 73 80 58 80 40 C80 20 66 2 42 2 Z" fill="#10b981" />
      {/* side gores for depth */}
      <path d="M42 2 C30 2 21 20 21 40 C21 58 30 73 36 81 L42 81 Z" fill="#34d399" opacity="0.65" />
      <path d="M42 2 C54 2 63 20 63 40 C63 58 54 73 48 81 L42 81 Z" fill="#047857" opacity="0.65" />
      {/* center stripe */}
      <path d="M42 2 C38 2 34 20 34 40 C34 58 38 73 40 81 L44 81 C46 73 50 58 50 40 C50 20 46 2 42 2 Z" fill="#a7f3d0" />
      {/* ropes */}
      <line x1="34" y1="81" x2="36.5" y2="96" stroke="#9ca3af" strokeWidth="1.5" />
      <line x1="50" y1="81" x2="47.5" y2="96" stroke="#9ca3af" strokeWidth="1.5" />
      {/* basket */}
      <rect x="33" y="96" width="18" height="13" rx="3" fill="#926b3e" />
      <rect x="33" y="96" width="18" height="4.5" rx="2" fill="#b08968" />
    </svg>
  )
}
