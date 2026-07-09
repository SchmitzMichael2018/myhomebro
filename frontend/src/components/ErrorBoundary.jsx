// src/components/ErrorBoundary.jsx

import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  // This lifecycle method is called when an error is thrown in a child component.
  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error: error };
  }

  // This lifecycle method is for logging the error information.
  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    // You could also log this to an external service like Sentry, LogRocket, etc.
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center p-6">
          <section className="w-full max-w-xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center shadow-sm">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-700">Workspace error</div>
            <h1 className="mt-2 text-2xl font-black text-rose-950">This workspace could not finish loading.</h1>
            <p className="mt-3 text-sm leading-6 text-rose-900">
              Refresh the page and try again. If the problem continues, open Support and include what you were trying to review or prepare.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl bg-rose-700 px-4 py-2 text-sm font-black text-white hover:bg-rose-800"
              >
                Retry
              </button>
              <a
                href="/app/support"
                className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-black text-rose-800 hover:bg-rose-100"
              >
                Open Support
              </a>
            </div>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
