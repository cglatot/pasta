import { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null
        };
    }

    static getDerivedStateFromError(error: Error): State {
        return {
            hasError: true,
            error
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleReset = () => {
        this.setState({
            hasError: false,
            error: null
        });
    };

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="container mt-5">
                    <div className="row justify-content-center">
                        <div className="col-md-8 col-lg-6">
                            <div className="card bg-dark text-white shadow-lg">
                                <div className="card-body text-center p-5">
                                    <i className="fas fa-exclamation-triangle fa-4x text-warning mb-4"></i>
                                    <h2 className="card-title mb-3">Something Went Wrong</h2>
                                    <p className="card-text text-muted mb-4">
                                        The application encountered an unexpected error. This has been logged for debugging.
                                    </p>

                                    {this.state.error && (
                                        <div className="alert alert-secondary mb-4" role="alert">
                                            <small className="font-monospace">{this.state.error.message}</small>
                                        </div>
                                    )}

                                    <div className="d-grid gap-2 d-md-flex justify-content-md-center">
                                        <button
                                            className="btn btn-primary btn-lg px-4"
                                            onClick={this.handleReset}
                                        >
                                            <i className="fas fa-redo me-2"></i>
                                            Try Again
                                        </button>
                                        <button
                                            className="btn btn-outline-light btn-lg px-4"
                                            onClick={this.handleReload}
                                        >
                                            <i className="fas fa-sync me-2"></i>
                                            Reload Page
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
