import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-oat flex items-center justify-center px-4">
          <div className="bg-linen rounded-2xl shadow-sm p-8 max-w-md w-full text-center border border-cream-border">
            <p className="text-5xl mb-4">😕</p>
            <h1 className="text-xl font-bold text-bark mb-2">Something went wrong</h1>
            <p className="text-cocoa text-sm mb-6">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-primary hover:bg-primary-pressed text-white font-medium px-6 py-2.5 rounded-2xl transition-colors"
            >
              Reload app
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
