'use client';
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { name: string; children: ReactNode };
type State = { failed: boolean };

/** Contains a render failure to one area of the app so the rest of the household stays usable. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Same Again: ${this.props.name} failed to render`, error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice" role="alert">
        <strong>{this.props.name} could not be displayed.</strong>
        <p>Your shared data is safe. Try again, or reload the page if this keeps happening.</p>
        <button className="btn" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
      </div>
    );
  }
}
