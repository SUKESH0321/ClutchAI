import { Component, Suspense, type ReactNode } from "react";

/**
 * Error boundary for optional scene content: if a model or texture fails to load, the rest of the
 * simulator keeps running and `fallback` (default: nothing) is shown instead. Failures are logged once.
 */
export class Safe extends Component<{ children: ReactNode; fallback?: ReactNode; name?: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) {
    // eslint-disable-next-line no-console
    console.warn(`[scene] "${this.props.name ?? "asset"}" failed to load; continuing with a fallback.`, e);
    window.dispatchEvent(new CustomEvent("scene-asset-failed", { detail: this.props.name ?? "asset" }));
  }
  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return <Suspense fallback={this.props.fallback ?? null}>{this.props.children}</Suspense>;
  }
}
