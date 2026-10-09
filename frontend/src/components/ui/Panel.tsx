import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

/** Inside the console drawer panels render as flat sections instead of chamfered cards. */
export const FlatContext = createContext(false);

interface PanelProps {
  idx: string;
  title: string;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function Panel({ idx, title, right, className = "", bodyClassName = "p-4", children }: PanelProps) {
  const flat = useContext(FlatContext);
  if (flat) {
    return (
      <section className={`flat-section overflow-hidden ${className}`}>
        <header className="flat-head">
          <span className="tick" />
          <span className="label text-ink">{title}</span>
          <span className="ml-auto flex items-center gap-2">{right}</span>
        </header>
        <div className={bodyClassName}>{children}</div>
      </section>
    );
  }
  return (
    <section className={`panel fade-in ${className}`}>
      <div className="panel-in flex flex-col">
        <header className="panel-head">
          <span className="tick" />
          <span className="label text-ink">{idx} / {title}</span>
          <span className="ml-auto flex items-center gap-2">{right}</span>
        </header>
        <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
      </div>
    </section>
  );
}

export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode; color?: string; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label">{props.label}</div>
      <div className={`num leading-none ${props.big ? "text-4xl" : "text-2xl"}`} style={{ color: props.color }}>
        {props.value}
      </div>
      {props.sub != null && <div className="text-[11px] text-muted mt-1">{props.sub}</div>}
    </div>
  );
}

export function Chip({ children, color = "#cfb0b4" }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-block px-2 py-[2px] text-[10px] tracking-[0.15em] uppercase border"
      style={{ color, borderColor: color + "88", background: color + "14" }}
    >
      {children}
    </span>
  );
}

/** Smoothly eases a displayed number toward the real value; the final value is always exact. */
export function Tween({ value, format }: { value: number; format: (v: number) => string }) {
  return <TweenInner value={value} format={format} />;
}
function TweenInner({ value, format }: { value: number; format: (v: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now(), a = from.current, dur = 450;
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      const v = a + (value - a) * (1 - (1 - k) * (1 - k));
      from.current = v;
      setShown(k >= 1 ? value : v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}
