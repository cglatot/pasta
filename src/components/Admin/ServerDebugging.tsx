import React, { useState, useEffect, useCallback } from 'react';
import { PastaDropdown } from '../Layout/PastaDropdown';

interface Props {
    machineIdentifier: string;
}

export const ServerDebugging: React.FC<Props> = ({ machineIdentifier }) => {
    const [loading, setLoading] = useState(true);
    const [debugLogging, setDebugLogging] = useState(false);
    const [debugForcedByEnv, setDebugForcedByEnv] = useState(false);
    const [togglingDebug, setTogglingDebug] = useState(false);
    const [diagnosticWindow, setDiagnosticWindow] = useState<'5m' | '15m' | '60m' | 'all'>('15m');
    const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
    const [runningCatchUp, setRunningCatchUp] = useState(false);
    const [catchUpMessage, setCatchUpMessage] = useState<{
        ok: boolean;
        message: string;
    } | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadState = useCallback(async () => {
        if (!machineIdentifier) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/config`,
                { credentials: 'same-origin' }
            );
            if (!res.ok) {
                throw new Error('Failed to load debugging status');
            }
            const data = (await res.json()) as {
                debugLogging?: boolean;
                debugForcedByEnv?: boolean;
            };
            setDebugLogging(Boolean(data.debugLogging));
            setDebugForcedByEnv(Boolean(data.debugForcedByEnv));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load debugging status');
        } finally {
            setLoading(false);
        }
    }, [machineIdentifier]);

    useEffect(() => {
        void loadState();
    }, [loadState]);

    const handleToggleDebugLogging = async (enabled: boolean) => {
        if (debugForcedByEnv) return;
        setTogglingDebug(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/debug-logging`,
                {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled }),
                }
            );
            if (!res.ok) {
                throw new Error('Failed to update debug logging setting');
            }
            const data = (await res.json()) as {
                debugLogging?: boolean;
                debugForcedByEnv?: boolean;
            };
            setDebugLogging(Boolean(data.debugLogging));
            setDebugForcedByEnv(Boolean(data.debugForcedByEnv));
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to update debug logging setting'
            );
        } finally {
            setTogglingDebug(false);
        }
    };

    const handleExportDiagnostics = async () => {
        setExportingDiagnostics(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/diagnostics?window=${encodeURIComponent(diagnosticWindow)}`,
                {
                    credentials: 'same-origin',
                }
            );
            if (!res.ok) {
                throw new Error('Failed to export diagnostic logs');
            }
            const report = await res.json();
            const blob = new Blob([JSON.stringify(report, null, 2)], {
                type: 'application/json',
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.href = url;
            a.download = `pasta-diagnostics-${dateStr}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to export diagnostic logs');
        } finally {
            setExportingDiagnostics(false);
        }
    };

    const handleRunCatchUpScan = async () => {
        setRunningCatchUp(true);
        setCatchUpMessage(null);
        setError(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/catch-up-scan`,
                {
                    method: 'POST',
                    credentials: 'same-origin',
                }
            );
            const data = (await res.json().catch(() => ({}))) as {
                ok?: boolean;
                scannedCount?: number;
                processedCount?: number;
                error?: string;
            };
            if (!res.ok || !data.ok) {
                throw new Error(data.error || 'Catch-up scan failed.');
            }
            const scanned = data.scannedCount ?? 0;
            const processed = data.processedCount ?? 0;
            setCatchUpMessage({
                ok: true,
                message:
                    processed > 0
                        ? `Checked ${scanned} recent episode(s) from the last 24h - synced ${processed} new or upgraded episode(s).`
                        : `Checked ${scanned} recent episode(s) from the last 24h - all episodes are already up to date.`,
            });
        } catch (err) {
            setCatchUpMessage({
                ok: false,
                message: err instanceof Error ? err.message : 'Catch-up scan failed.',
            });
        } finally {
            setRunningCatchUp(false);
        }
    };

    if (loading) {
        return (
            <div className="text-center py-5">
                <div className="spinner-border text-warning" role="status" />
            </div>
        );
    }

    return (
        <div className="card shadow-sm" style={{ maxWidth: '680px' }}>
            <div className="card-header bg-white">
                <h5 className="mb-0">Debugging &amp; Maintenance</h5>
            </div>
            <div className="card-body">
                {error && <div className="alert alert-danger py-2">{error}</div>}

                <div className="fw-bold mb-2">Diagnostics</div>
                <div className="mb-4 ps-3 border-start border-secondary">
                    <div className="mb-3 d-flex justify-content-between align-items-center">
                        <div>
                            <label
                                htmlFor="debugLoggingSwitch"
                                className="form-label small fw-bold mb-0"
                                style={{
                                    cursor: debugForcedByEnv ? 'not-allowed' : 'pointer',
                                }}
                            >
                                Enable Debug Logging
                            </label>
                            <div className="form-text mt-0">
                                Mirrors verbose diagnostic events to container logs (
                                <code>stdout</code>) and expands the in-memory diagnostic buffer (up
                                to 2,500 deduplicated events / 4 MB max) for troubleshooting.
                                {debugForcedByEnv && (
                                    <span className="d-block text-warning mt-1">
                                        <i className="fas fa-lock me-1" aria-hidden="true"></i>
                                        Enabled via the <code>PASTA_DEBUG=true</code> container
                                        environment variable.
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="form-check form-switch mb-0 ms-3">
                            <input
                                className="form-check-input"
                                type="checkbox"
                                id="debugLoggingSwitch"
                                disabled={debugForcedByEnv || togglingDebug}
                                checked={Boolean(debugLogging || debugForcedByEnv)}
                                onChange={e => void handleToggleDebugLogging(e.target.checked)}
                            />
                        </div>
                    </div>

                    <div>
                        <label
                            htmlFor="diagnosticWindowSelect"
                            className="form-label small fw-bold mb-1"
                        >
                            Export Diagnostic Report
                        </label>
                        <div className="form-text mt-0 mb-2">
                            Downloads a sanitized JSON report (with all tokens, URLs, and personal
                            details stripped) filtered to the selected time window for bug reports.
                        </div>
                        <div className="d-flex flex-wrap align-items-center gap-2">
                            <PastaDropdown
                                id="diagnosticWindowSelect"
                                minWidth="145px"
                                value={diagnosticWindow}
                                onChange={val => setDiagnosticWindow(val)}
                                options={[
                                    { value: '5m', label: 'Last 5 mins' },
                                    { value: '15m', label: 'Last 15 mins' },
                                    { value: '60m', label: 'Last 1 hour' },
                                    { value: 'all', label: 'All available' },
                                ]}
                            />
                            <button
                                type="button"
                                className="btn btn-outline-primary btn-sm text-nowrap"
                                onClick={() => void handleExportDiagnostics()}
                                disabled={exportingDiagnostics}
                            >
                                <i className="fas fa-file-download me-2" aria-hidden="true"></i>
                                {exportingDiagnostics
                                    ? 'Exporting...'
                                    : 'Export Diagnostic Logs'}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="fw-bold mb-2">Trigger Scan</div>
                <div className="ps-3 border-start border-secondary">
                    <div className="fw-bold small mb-1">Recent Episode Catch-Up Scan</div>
                    <div className="form-text mt-0 mb-2">
                        Manually checks all TV libraries for episodes added or upgraded in the last
                        24 hours and applies each viewer&apos;s preferred audio and subtitle tracks
                        if they were missed while the server or container was offline.
                    </div>
                    <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        onClick={() => void handleRunCatchUpScan()}
                        disabled={runningCatchUp}
                    >
                        <i
                            className={`fas ${
                                runningCatchUp ? 'fa-sync-alt fa-spin' : 'fa-search'
                            } me-2`}
                            aria-hidden="true"
                        ></i>
                        {runningCatchUp
                            ? 'Scanning Recent Episodes...'
                            : 'Scan for Recent Episodes'}
                    </button>
                    {catchUpMessage && (
                        <div
                            className={`small mt-2 ${
                                catchUpMessage.ok ? 'text-success' : 'text-danger'
                            }`}
                        >
                            <i
                                className={`fas ${
                                    catchUpMessage.ok
                                        ? 'fa-check-circle'
                                        : 'fa-exclamation-triangle'
                                } me-1`}
                                aria-hidden="true"
                            ></i>
                            {catchUpMessage.message}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
