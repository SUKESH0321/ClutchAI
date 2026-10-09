interface Props {
  open: boolean;
  onClick: () => void;
  /** short live badge, e.g. "BOX" when the optimizer wants a stop */
  badge?: string | null;
}

const TREAD = Array.from({ length: 40 }, (_, i) => i * 9);
const SPOKES = [0, 72, 144, 216, 288];

/** Floating racing-wheel button: rubber tyre with tread, red compound band, metallic multi-spoke rim. */
export default function WheelButton({ open, onClick, badge }: Props) {
  return (
    <div className="wheel-wrap">
      <button type="button" className="wheel-btn" onClick={onClick} aria-expanded={open} aria-controls="race-console"
        aria-label={open ? "Close race control and telemetry" : "Open race control and telemetry"}>
        <svg viewBox="0 0 120 120" width="84" height="84" aria-hidden="true">
          <defs>
            <radialGradient id="rubber" cx="38%" cy="32%" r="80%">
              <stop offset="0" stopColor="#4a3438" /><stop offset="0.55" stopColor="#1f1316" /><stop offset="1" stopColor="#0b0607" />
            </radialGradient>
            <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f6f1ee" /><stop offset="0.35" stopColor="#a8a0a2" />
              <stop offset="0.6" stopColor="#e9e2e0" /><stop offset="1" stopColor="#6c6165" />
            </linearGradient>
            <linearGradient id="metalDark" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#3a2d31" /><stop offset="1" stopColor="#8d8084" />
            </linearGradient>
            <radialGradient id="hubRed" cx="40%" cy="35%" r="70%">
              <stop offset="0" stopColor="#ff7a82" /><stop offset="0.6" stopColor="#ff3b47" /><stop offset="1" stopColor="#8e0f1b" />
            </radialGradient>
          </defs>

          {/* tyre */}
          <circle cx="60" cy="60" r="58" fill="url(#rubber)" />
          {TREAD.map((a) => (
            <rect key={a} x="58.4" y="1.5" width="3.2" height="6.5" rx="0.8" fill="#080405" opacity="0.95" transform={`rotate(${a} 60 60)`} />
          ))}
          <circle cx="60" cy="60" r="50" fill="none" stroke="#080405" strokeWidth="1.5" opacity="0.7" />
          {/* red compound band on the sidewall */}
          <circle cx="60" cy="60" r="46" fill="none" stroke="#ff3b47" strokeWidth="3.2" />
          <circle cx="60" cy="60" r="46" fill="none" stroke="#fff4f1" strokeWidth="1" strokeDasharray="2 5" opacity="0.7" />
          <circle cx="60" cy="60" r="42" fill="#120a0c" />

          {/* rim (rotates) */}
          <g className="wheel-rim">
            <circle cx="60" cy="60" r="40" fill="url(#metal)" />
            <circle cx="60" cy="60" r="35" fill="#1a0f12" />
            {SPOKES.map((a) => (
              <g key={a} transform={`rotate(${a} 60 60)`}>
                <path d="M 56.4 56 L 54.2 26 Q 60 22.5 65.8 26 L 63.6 56 Z" fill="url(#metal)" />
                <path d="M 58 52 L 57.2 29 L 60 27.6" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.9" />
              </g>
            ))}
            <circle cx="60" cy="60" r="35" fill="none" stroke="url(#metalDark)" strokeWidth="2.2" />
            <circle cx="60" cy="60" r="15" fill="url(#metalDark)" />
            {SPOKES.map((a) => (
              <circle key={a} cx="60" cy="49.5" r="1.7" fill="#e8dfdd" transform={`rotate(${a + 36} 60 60)`} />
            ))}
          </g>

          {/* hub nut */}
          <circle cx="60" cy="60" r="8.5" fill="url(#hubRed)" stroke="#2a0a10" strokeWidth="1" />
          <circle cx="60" cy="60" r="3" fill="#2a0a10" />
          {/* specular highlights */}
          <ellipse cx="38" cy="30" rx="22" ry="9" fill="#fff" opacity="0.14" transform="rotate(-38 38 30)" />
          <path d="M 12 70 A 50 50 0 0 0 40 108" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="2" />
        </svg>
        {badge && (
          <span className="absolute -top-1 -right-2 num text-[12px] px-2 py-[1px] pulse-dot"
            style={{ background: "#ff3b47", color: "#fff", border: "1px solid #ffd0d4", letterSpacing: ".1em" }}>{badge}</span>
        )}
      </button>
      <span className="wheel-tip" role="tooltip">{open ? "Close console" : "Race Control & Telemetry"}</span>
    </div>
  );
}
