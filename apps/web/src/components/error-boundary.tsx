import { Component, type ErrorInfo, type ReactNode } from "react";
import { createLogger } from "@shared/http";
import { ErrorScreen } from "./error-screen";

const logger = createLogger("web.error-boundary");
interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}
interface State {
  hasError: boolean;
}
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.error("render.uncaught", { error, componentStack: errorInfo.componentStack });
  }

  override render() {
    if (this.state.hasError) return this.props.fallback ?? <ErrorScreen />;
    return this.props.children;
  }
}
