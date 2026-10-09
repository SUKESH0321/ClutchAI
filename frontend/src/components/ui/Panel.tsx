import type { ReactNode } from "react";

interface PanelProps {
  idx: string;
  title: string;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

export function Panel({ idx, title, right, className = "", bodyClassName = "p-4", children }: PanelProps) {
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

export function Chip({ children, color = "#8A93A3" }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-block px-2 py-[2px] text-[10px] tracking-[0.15em] uppercase border"
      style={{ color, borderColor: color + "88", background: color + "14" }}
    >
      {children}
    </span>
  );
}
