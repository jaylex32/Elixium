import {Component, type ErrorInfo, type ReactNode} from 'react';
import {AlertTriangle, RotateCcw} from 'lucide-react';
import {Button} from '@/shared/components/ui/Button';

interface Props {
  children: ReactNode;
  /** Changing this value resets the boundary — pass the current page id. */
  resetKey?: string | number;
  /** Shown in the fallback so the user knows what failed. */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors from one subtree.
 *
 * Without a boundary, a single page throwing during render unmounts the whole
 * React tree — the user loses the player, the nav, and any in-flight state,
 * and sees a blank page with no way back. Scoping one of these per route keeps
 * a failure contained to the page that caused it.
 *
 * Must be a class: there is still no hook equivalent of componentDidCatch.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {error: null};

  static getDerivedStateFromError(error: Error): State {
    return {error};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the component stack — React's own console output does not include
    // it once the boundary swallows the error.
    console.error('[ErrorBoundary]', this.props.label ?? '', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    // Navigating away from a broken page should clear the error, otherwise the
    // fallback sticks around for every subsequent route.
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({error: null});
    }
  }

  render() {
    const {error} = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex flex-col items-center justify-center px-6 py-24 text-center" role="alert">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger/12">
          <AlertTriangle size={26} className="text-danger" />
        </div>
        <p className="text-base font-semibold text-text-primary">
          {this.props.label ? `${this.props.label} failed to render` : 'Something went wrong'}
        </p>
        <p className="mt-1 max-w-md text-sm text-text-muted">
          The rest of the app is still running — switch pages, or try again.
        </p>

        <pre className="mt-4 max-w-full overflow-x-auto rounded-sm border border-border bg-secondary-bg px-3 py-2 text-left text-xs text-text-secondary">
          {error.message || String(error)}
        </pre>

        <Button variant="secondary" size="sm" className="mt-5" onClick={() => this.setState({error: null})}>
          <RotateCcw size={14} />
          Try again
        </Button>
      </div>
    );
  }
}
