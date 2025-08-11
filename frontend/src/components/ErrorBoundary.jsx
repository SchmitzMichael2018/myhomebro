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
      // You can render any custom fallback UI.
      return (
        <div className="p-8 text-center text-red-500 bg-red-50 min-h-screen flex flex-col justify-center items-center">
          <h1 className="text-2xl font-bold mb-4">Something went wrong.</h1>
          <p>We're sorry, an unexpected error occurred. Please try refreshing the page.</p>
          <pre className="mt-4 text-xs text-left bg-white p-2 rounded border border-red-200">
            {this.state.error && this.state.error.toString()}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;