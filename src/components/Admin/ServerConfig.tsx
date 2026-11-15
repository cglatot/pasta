import React, { useState, useEffect, useCallback } from 'react';
import { PastaDropdown } from '../Layout/PastaDropdown';

interface ServerConfigState {
    machineIdentifier: string;
    serverName: string;
    serverUrl: string;
    customUrlOverride: string;
    authStatus: string;
    isMonitoringEnabled: boolean;
    debounceSeconds: number;
    updateLevel: 'show' | 'season';
    updateStrategy: 'next' | 'all';
    autoForcedSubtitles: boolean;
    triggerOnPlay: boolean;
    triggerOnScan: boolean;
    triggerOnActivity: boolean;
    retentionDays: number;
}

interface Props {
    machineIdentifier: string;
    onNavigateToRules?: () => void;
}

export const ServerConfig: React.FC<Props> = ({ machineIdentifier, onNavigateToRules }) => {
    const [config, setConfig] = useState<ServerConfigState | null>(null);
    const [savedConfig, setSavedConfig] = useState<ServerConfigState | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [savedMessage, setSavedMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [testingUrl, setTestingUrl] = useState(false);
    const [testResult, setTestResult] = useState<{
        ok: boolean;
        message: string;
    } | null>(null);

    const loadConfig = useCallback(async () => {
        if (!machineIdentifier) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/config`,
                { credentials: 'same-origin' }
            );
            if (!res.ok) {
                throw new Error('Failed to load server configuration');
            }
            const data = (await res.json()) as ServerConfigState;
            setConfig(data);
            setSavedConfig(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load configuration');
        } finally {
            setLoading(false);
        }
    }, [machineIdentifier]);

    useEffect(() => {
        void loadConfig();
    }, [loadConfig]);

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!config) return;
        setSaving(true);
        setSavedMessage(null);
        setError(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/config`,
                {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(config),
                }
            );
            if (!res.ok) {
                throw new Error('Failed to save server configuration');
            }
            const data = (await res.json().catch(() => ({}))) as {
                ok?: boolean;
                customUrlOverride?: string;
            };
            const nextConfig: ServerConfigState = {
                ...config,
                customUrlOverride:
                    typeof data.customUrlOverride === 'string'
                        ? data.customUrlOverride
                        : config.customUrlOverride,
            };
            setConfig(nextConfig);
            setSavedConfig(nextConfig);
            setSavedMessage('Configuration saved successfully.');
            setTimeout(() => setSavedMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    const handleTestConnection = async () => {
        if (!config) return;
        setTestingUrl(true);
        setTestResult(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/test-connection`,
                {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: config.customUrlOverride }),
                }
            );
            const data = (await res.json()) as {
                ok: boolean;
                url?: string;
                friendlyName?: string;
                latencyMs?: number;
                errorMessage?: string;
            };
            if (data.ok) {
                if (config.customUrlOverride.trim() && data.url) {
                    const normalizedUrl = data.url;
                    setConfig(prev =>
                        prev ? { ...prev, customUrlOverride: normalizedUrl } : prev
                    );
                }
                setTestResult({
                    ok: true,
                    message: `Connected to ${data.friendlyName || config.serverName} at ${data.url} (${data.latencyMs}ms)`,
                });
            } else {
                setTestResult({
                    ok: false,
                    message: data.errorMessage || 'Could not connect to Plex server.',
                });
            }
        } catch (err) {
            setTestResult({
                ok: false,
                message: err instanceof Error ? err.message : 'Connection test failed.',
            });
        } finally {
            setTestingUrl(false);
        }
    };

    if (loading) {
        return (
            <div className="text-center py-5">
                <div className="spinner-border text-warning" role="status" />
            </div>
        );
    }

    if (!config) {
        return <div className="alert alert-danger">{error || 'Configuration unavailable'}</div>;
    }

    const isDirty = Boolean(
        savedConfig &&
            (config.isMonitoringEnabled !== savedConfig.isMonitoringEnabled ||
                config.debounceSeconds !== savedConfig.debounceSeconds ||
                config.updateLevel !== savedConfig.updateLevel ||
                config.updateStrategy !== savedConfig.updateStrategy ||
                config.autoForcedSubtitles !== savedConfig.autoForcedSubtitles ||
                config.triggerOnPlay !== savedConfig.triggerOnPlay ||
                config.triggerOnScan !== savedConfig.triggerOnScan ||
                config.triggerOnActivity !== savedConfig.triggerOnActivity ||
                config.retentionDays !== savedConfig.retentionDays ||
                config.customUrlOverride.trim() !== savedConfig.customUrlOverride.trim())
    );

    return (
        <div className="card shadow-sm" style={{ maxWidth: '680px' }}>
            <div className="card-header bg-white d-flex justify-content-between align-items-center">
                <h5 className="mb-0">Server Configuration</h5>
                {config.authStatus === 'AUTH_EXPIRED' && (
                    <span className="badge bg-danger">Owner Token Expired - Re-login Needed</span>
                )}
            </div>
            <div className="card-body">
                {error && <div className="alert alert-danger py-2">{error}</div>}
                {savedMessage && <div className="alert alert-success py-2">{savedMessage}</div>}

                <form onSubmit={handleSave}>
                    <div className="mb-3 d-flex justify-content-between align-items-center">
                        <label
                            htmlFor="enableMonitoringSwitch"
                            className="form-label fw-bold mb-0"
                            style={{ cursor: 'pointer' }}
                        >
                            Enable Background Auto-Sync
                        </label>
                        <div className="form-check form-switch mb-0">
                            <input
                                className="form-check-input"
                                type="checkbox"
                                id="enableMonitoringSwitch"
                                style={{ cursor: 'pointer' }}
                                checked={config.isMonitoringEnabled}
                                onChange={e =>
                                    setConfig({
                                        ...config,
                                        isMonitoringEnabled: e.target.checked,
                                    })
                                }
                            />
                        </div>
                    </div>

                    <div
                        className="mb-4 ps-3 border-start border-secondary"
                        style={{
                            opacity: config.isMonitoringEnabled ? 1 : 0.5,
                            transition: 'opacity 0.15s ease',
                        }}
                    >
                        <div className="small fw-bold text-uppercase text-muted mb-2">
                            Automation Triggers
                        </div>

                        <div className="mb-2 d-flex justify-content-between align-items-center">
                            <div>
                                <label
                                    htmlFor="triggerOnPlaySwitch"
                                    className="form-label small fw-bold mb-0"
                                    style={{
                                        cursor: config.isMonitoringEnabled
                                            ? 'pointer'
                                            : 'not-allowed',
                                    }}
                                >
                                    Update on Playback
                                </label>
                                <div className="form-text mt-0">
                                    Sync tracks across episodes when a user changes audio or
                                    subtitles while playing an episode.
                                </div>
                            </div>
                            <div className="form-check form-switch mb-0 ms-3">
                                <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id="triggerOnPlaySwitch"
                                    disabled={!config.isMonitoringEnabled}
                                    checked={config.triggerOnPlay}
                                    onChange={e =>
                                        setConfig({
                                            ...config,
                                            triggerOnPlay: e.target.checked,
                                        })
                                    }
                                />
                            </div>
                        </div>

                        <div className="mb-2 d-flex justify-content-between align-items-center">
                            <div>
                                <label
                                    htmlFor="triggerOnActivitySwitch"
                                    className="form-label small fw-bold mb-0"
                                    style={{
                                        cursor: config.isMonitoringEnabled
                                            ? 'pointer'
                                            : 'not-allowed',
                                    }}
                                >
                                    Update on Pre-Play Selection
                                </label>
                                <div className="form-text mt-0">
                                    Sync tracks across episodes when a user changes audio or
                                    subtitles on an episode page before starting playback.
                                </div>
                            </div>
                            <div className="form-check form-switch mb-0 ms-3">
                                <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id="triggerOnActivitySwitch"
                                    disabled={!config.isMonitoringEnabled}
                                    checked={config.triggerOnActivity}
                                    onChange={e =>
                                        setConfig({
                                            ...config,
                                            triggerOnActivity: e.target.checked,
                                        })
                                    }
                                />
                            </div>
                        </div>

                        <div className="d-flex justify-content-between align-items-center">
                            <div>
                                <label
                                    htmlFor="triggerOnScanSwitch"
                                    className="form-label small fw-bold mb-0"
                                    style={{
                                        cursor: config.isMonitoringEnabled
                                            ? 'pointer'
                                            : 'not-allowed',
                                    }}
                                >
                                    Update on New &amp; Upgraded Episodes
                                </label>
                                <div className="form-text mt-0">
                                    Automatically apply each viewer&apos;s preferred tracks when new
                                    episodes are scanned or existing files are upgraded.
                                </div>
                            </div>
                            <div className="form-check form-switch mb-0 ms-3">
                                <input
                                    className="form-check-input"
                                    type="checkbox"
                                    id="triggerOnScanSwitch"
                                    disabled={!config.isMonitoringEnabled}
                                    checked={config.triggerOnScan}
                                    onChange={e =>
                                        setConfig({
                                            ...config,
                                            triggerOnScan: e.target.checked,
                                        })
                                    }
                                />
                            </div>
                        </div>
                    </div>

                    <div className="fw-bold mb-2">Automation Behavior</div>
                    <div className="mb-4 ps-3 border-start border-secondary">
                        <div className="mb-3">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                                <label
                                    htmlFor="debounceRange"
                                    className="form-label small fw-bold mb-0"
                                >
                                    Track Change Debounce Time
                                </label>
                                <span className="badge bg-pasta-orange">
                                    {config.debounceSeconds}s
                                </span>
                            </div>
                            <input
                                type="range"
                                className="form-range"
                                id="debounceRange"
                                style={{ cursor: 'pointer' }}
                                min={5}
                                max={120}
                                step={5}
                                value={config.debounceSeconds}
                                onChange={e =>
                                    setConfig({
                                        ...config,
                                        debounceSeconds: Number.parseInt(e.target.value, 10),
                                    })
                                }
                            />
                            <div className="form-text mt-0">
                                Seconds to wait after a playback track change before updating
                                remaining episodes.
                            </div>
                        </div>

                        <div className="row g-3 mb-3">
                            <div className="col-sm-6">
                                <label
                                    htmlFor="updateLevelSelect"
                                    className="form-label fw-bold small"
                                >
                                    Update Scope
                                </label>
                                <PastaDropdown
                                    id="updateLevelSelect"
                                    fullWidth
                                    value={config.updateLevel}
                                    onChange={val =>
                                        setConfig({
                                            ...config,
                                            updateLevel: val,
                                        })
                                    }
                                    options={[
                                        { value: 'show', label: 'Entire Show' },
                                        { value: 'season', label: 'Current Season Only' },
                                    ]}
                                />
                            </div>
                            <div className="col-sm-6">
                                <label
                                    htmlFor="updateStrategySelect"
                                    className="form-label fw-bold small"
                                >
                                    Update Strategy
                                </label>
                                <PastaDropdown
                                    id="updateStrategySelect"
                                    fullWidth
                                    value={config.updateStrategy}
                                    onChange={val =>
                                        setConfig({
                                            ...config,
                                            updateStrategy: val,
                                        })
                                    }
                                    options={[
                                        { value: 'next', label: 'Upcoming Episodes Only' },
                                        { value: 'all', label: 'All Episodes' },
                                    ]}
                                />
                            </div>
                        </div>

                        <div>
                            <div className="d-flex justify-content-between align-items-center mb-1">
                                <label
                                    htmlFor="autoForcedSubSwitch"
                                    className="form-label small fw-bold mb-0"
                                    style={{ cursor: 'pointer' }}
                                >
                                    Auto-Select Forced Subtitles Matching Audio
                                </label>
                                <div className="form-check form-switch mb-0 ms-3">
                                    <input
                                        className="form-check-input"
                                        type="checkbox"
                                        id="autoForcedSubSwitch"
                                        style={{ cursor: 'pointer' }}
                                        checked={config.autoForcedSubtitles}
                                        onChange={e =>
                                            setConfig({
                                                ...config,
                                                autoForcedSubtitles: e.target.checked,
                                            })
                                        }
                                    />
                                </div>
                            </div>
                            <div className="form-text mt-0">
                                When subtitles are set to None, automatically select a Forced
                                subtitle track matching the selected audio language if one exists.
                                {onNavigateToRules && (
                                    <>
                                        {' '}
                                        Configure per-library, show, and label exclusions in{' '}
                                        <button
                                            type="button"
                                            className="btn btn-link btn-sm p-0 align-baseline text-decoration-underline"
                                            style={{ color: '#F39C12', fontSize: 'inherit' }}
                                            onClick={onNavigateToRules}
                                        >
                                            Library Settings →
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="fw-bold mb-2">Other Settings</div>
                    <div className="mb-4 ps-3 border-start border-secondary">
                        <div className="mb-3">
                            <label
                                htmlFor="customUrlInput"
                                className="form-label fw-bold small"
                            >
                                Custom Plex URL / IP (Optional)
                            </label>
                            <div className="d-flex gap-2">
                                <input
                                    type="text"
                                    id="customUrlInput"
                                    className="form-control form-control-sm"
                                    placeholder={
                                        config.serverUrl ||
                                        'http://192.168.1.10:32400 or 192.168.1.10:32400'
                                    }
                                    value={config.customUrlOverride}
                                    onChange={e => {
                                        setConfig({
                                            ...config,
                                            customUrlOverride: e.target.value,
                                        });
                                        setTestResult(null);
                                    }}
                                />
                                <button
                                    type="button"
                                    className="btn btn-outline-primary btn-sm text-nowrap"
                                    onClick={() => void handleTestConnection()}
                                    disabled={testingUrl}
                                >
                                    <i className="fas fa-plug me-1"></i>
                                    {testingUrl ? 'Testing...' : 'Test Connection'}
                                </button>
                            </div>
                            {testResult && (
                                <div
                                    className={`small mt-2 ${
                                        testResult.ok ? 'text-success' : 'text-danger'
                                    }`}
                                >
                                    <i
                                        className={`fas ${
                                            testResult.ok
                                                ? 'fa-check-circle'
                                                : 'fa-exclamation-triangle'
                                        } me-1`}
                                    ></i>
                                    {testResult.message}
                                </div>
                            )}
                            <div className="form-text">
                                Overrides auto-discovered Plex connections (e.g. Docker internal
                                bridge or LAN IP). Active URL:{' '}
                                <code>
                                    {config.customUrlOverride.trim() || config.serverUrl}
                                </code>{' '}
                                (Auto-detected: <code>{config.serverUrl}</code>)
                            </div>
                        </div>

                        <div>
                            <label
                                htmlFor="retentionDaysSelect"
                                className="form-label fw-bold small"
                            >
                                Log Retention Period
                            </label>
                            <PastaDropdown
                                id="retentionDaysSelect"
                                fullWidth
                                value={String(config.retentionDays)}
                                onChange={val =>
                                    setConfig({
                                        ...config,
                                        retentionDays: Number.parseInt(val, 10) || 90,
                                    })
                                }
                                options={[
                                    { value: '30', label: '30 Days' },
                                    { value: '60', label: '60 Days' },
                                    { value: '90', label: '90 Days (Default)' },
                                    { value: '180', label: '180 Days' },
                                    { value: '365', label: '1 Year' },
                                ]}
                            />
                            <div className="form-text">
                                Automatically prunes automation and manual batch log entries older
                                than this period.
                            </div>
                        </div>
                    </div>

                    <div className="d-flex justify-content-end">
                        <button
                            type="submit"
                            className={`btn ${isDirty && !saving ? 'btn-primary' : 'btn-secondary'}`}
                            disabled={saving || !isDirty}
                        >
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
