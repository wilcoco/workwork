import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <h2 style={{ color: '#b91c1c' }}>오류가 발생했습니다</h2>
          <p style={{ color: '#64748b', marginTop: 8 }}>
            {this.state.error?.message || '알 수 없는 오류'}
          </p>
          <button
            className="btn"
            style={{ marginTop: 12 }}
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
          >
            새로고침
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
