import { Button } from "@gryt/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { LocalizedText } from "@/i18n";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Uncaught error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex items-center justify-center" style={{ width: "100vw", height: "100vh", background: "var(--gryt-neutral-1)" }}>
        <div style={{ textAlign: "center", maxWidth: 420, padding: 32 }}>
          <p className="text-xl font-bold mb-3">{<LocalizedText translationKey="shellFull.ErrorBoundary_tsx_8d886c0ba6" />}</p>
          <p className="text-sm text-gryt-muted mb-4" style={{ marginTop: 8 }}>
            {this.state.error?.message || <LocalizedText translationKey="shellFull.ErrorBoundary_tsx_4444a27dbd" />}
          </p>
          <Button size="small"
            style={{ marginTop: 16 }}
            onClick={() => window.location.reload()}
          >{<LocalizedText translationKey="shellFull.ErrorBoundary_tsx_cce7155371" />}</Button>
        </div>
      </div>
    );
  }
}
