import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PastaDropdown } from '../Layout/PastaDropdown';
import { ClearLogsModal, type ClearLogsRange } from './ClearLogsModal';

interface AutoOperationEpisodeRow {
    id: number;
    episode_rating_key: string;
    episode_label: string;
    target_username: string;
    change_applied: string;
    match_reason: string;
    was_updated: number;
}

interface AutoOperationRow {
    id: number;
    machine_identifier: string;
    plex_user_id: number;
    username: string;
    trigger_type: string;
    show_rating_key: string;
    show_title: string;
    reference_episode_key: string;
    reference_episode_label: string;
    audio_summary: string | null;
    subtitle_summary: string | null;
    updated_count: number;
    skipped_count: number;
    created_at: number;
    episodes: AutoOperationEpisodeRow[];
}

interface ServerUserItem {
    plexUserId: number;
    username: string;
    title: string;
}

interface Props {
    machineIdentifier: string;
    refreshToken?: number;
}

const formatTriggerBadge = (triggerType: string): string => {
    switch (triggerType) {
        case 'PLAYBACK_CHANGE':
            return 'Playback Change';
        case 'PREPLAY_CHANGE':
            return 'Pre-Play Change';
        case 'NEW_EPISODE_SCAN':
            return 'New Episode Added';
        case 'UPGRADED_FILE_SCAN':
            return 'File Upgraded';
        default:
            return triggerType;
    }
};

const formatRelativeTime = (ts: number): string => {
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(ts).toLocaleString();
};

const renderSingleReasonBadge = (reason: string, wasUpdated: boolean): React.ReactNode => {
    const raw = reason.trim();
    const lower = raw.toLowerCase();

    if (lower.includes('already set')) {
        return <span className="badge bg-warning text-dark small">Already Set</span>;
    }

    if (lower.includes('no match')) {
        return <span className="badge bg-danger text-white small">No Match</span>;
    }

    if (lower.includes('skipped')) {
        return <span className="badge bg-danger text-white small">{raw}</span>;
    }

    if (wasUpdated || raw) {
        return (
            <span className="badge bg-success text-white small">
                {raw || 'Matched'}
            </span>
        );
    }

    return <span className="badge bg-warning text-dark small">Already Set</span>;
};

const renderMatchReasonBadge = (ep: AutoOperationEpisodeRow): React.ReactNode => {
    const raw = (ep.match_reason || '').trim();
    const parts = raw
        .split(/\n/)
        .map(s => s.trim())
        .filter(Boolean);

    if (parts.length <= 1) {
        return renderSingleReasonBadge(parts[0] || raw, Boolean(ep.was_updated));
    }

    // Normalize "Already Set (Skipped)" before comparing whether all track reasons are identical
    const normalized = parts.map(p =>
        p.toLowerCase().includes('already set') ? 'Already Set' : p
    );
    const allSame = normalized.every(p => p === normalized[0]);

    if (allSame) {
        return renderSingleReasonBadge(normalized[0], Boolean(ep.was_updated));
    }

    return (
        <div className="d-flex flex-column align-items-start gap-1">
            {normalized.map((part, idx) => (
                <div key={idx}>{renderSingleReasonBadge(part, Boolean(ep.was_updated))}</div>
            ))}
        </div>
    );
};

const renderChangeToApply = (
    ep: AutoOperationEpisodeRow,
    op: AutoOperationRow,
    isScanEvent: boolean
): React.ReactNode => {
    const raw = (ep.change_applied || '').trim();

    // Legacy fallback if an older DB row only stored "Already Set (Skipped)"
    if (raw === 'Already Set (Skipped)' || raw === 'Already Set') {
        if (!isScanEvent && (op.audio_summary || op.subtitle_summary)) {
            const fallbackLines: string[] = [];
            if (op.audio_summary) {
                fallbackLines.push(`Audio: → ${op.audio_summary}`);
            }
            if (op.subtitle_summary) {
                fallbackLines.push(`Subtitles: → ${op.subtitle_summary}`);
            }
            return (
                <div className="d-flex flex-column gap-1">
                    {fallbackLines.map((line, idx) => (
                        <div key={idx}>{line}</div>
                    ))}
                </div>
            );
        }
    }

    const lines = raw
        .split(/\n|\s+•\s+/)
        .map(s => s.trim())
        .filter(Boolean);

    if (lines.length <= 1) {
        return <span>{raw}</span>;
    }

    return (
        <div className="d-flex flex-column gap-1">
            {lines.map((line, idx) => (
                <div key={idx}>{line}</div>
            ))}
        </div>
    );
};

const getCurrentTimestampMs = () => Date.now();

export const ActivityLog: React.FC<Props> = ({ machineIdentifier, refreshToken = 0 }) => {
    const [operations, setOperations] = useState<AutoOperationRow[]>([]);
    const [serverUsers, setServerUsers] = useState<ServerUserItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

    // Filters
    const [userFilter, setUserFilter] = useState<string>('all');
    const [dateFilter, setDateFilter] = useState<string>('all');
    const [titleFilter, setTitleFilter] = useState<string>('');
    const [showClearModal, setShowClearModal] = useState(false);
    const [isClearing, setIsClearing] = useState(false);

    const loadOperations = useCallback(async () => {
        if (!machineIdentifier) return;
        setLoading(true);
        setError(null);
        try {
            const [logsRes, usersRes] = await Promise.all([
                fetch(`/api/admin/${encodeURIComponent(machineIdentifier)}/logs?limit=100`, {
                    credentials: 'same-origin',
                }),
                fetch(`/api/admin/${encodeURIComponent(machineIdentifier)}/users`, {
                    credentials: 'same-origin',
                }).catch(() => null),
            ]);
            if (!logsRes.ok) {
                throw new Error('Failed to load automation activity logs');
            }
            const data = (await logsRes.json()) as AutoOperationRow[];
            setOperations(data);
            if (usersRes && usersRes.ok) {
                const uData = (await usersRes.json()) as ServerUserItem[];
                setServerUsers(uData);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load logs');
        } finally {
            setLoading(false);
        }
    }, [machineIdentifier]);

    useEffect(() => {
        void loadOperations();
    }, [loadOperations, refreshToken]);

    const userOptions = useMemo(() => {
        const names = new Set<string>();
        for (const u of serverUsers) {
            const name = u.title || u.username;
            if (name) names.add(name);
        }
        for (const op of operations) {
            if (op.username && !op.username.startsWith('Scanner (')) {
                names.add(op.username);
            }
            for (const ep of op.episodes || []) {
                if (ep.target_username) names.add(ep.target_username);
            }
        }
        return Array.from(names).sort((a, b) => a.localeCompare(b));
    }, [serverUsers, operations]);

    const filteredOperations = useMemo(() => {
        const now = getCurrentTimestampMs();
        const query = titleFilter.trim().toLowerCase();
        const userQuery = userFilter.toLowerCase();

        const result: AutoOperationRow[] = [];
        for (const op of operations) {
            let view = op;

            if (userFilter !== 'all') {
                const episodes = (op.episodes || []).filter(
                    ep => ep.target_username.toLowerCase() === userQuery
                );
                if ((op.episodes || []).length > 0) {
                    if (episodes.length === 0) continue;
                } else if (op.username.toLowerCase() !== userQuery) {
                    continue;
                }
                view = {
                    ...op,
                    episodes,
                    updated_count: episodes.filter(ep => ep.was_updated).length,
                    skipped_count: episodes.filter(ep => !ep.was_updated).length,
                };
            }

            if (dateFilter !== 'all') {
                const ageMs = now - op.created_at;
                if (dateFilter === '5m' && ageMs > 5 * 60 * 1000) continue;
                if (dateFilter === '15m' && ageMs > 15 * 60 * 1000) continue;
                if (dateFilter === '30m' && ageMs > 30 * 60 * 1000) continue;
                if (dateFilter === '1h' && ageMs > 60 * 60 * 1000) continue;
                if (dateFilter === '6h' && ageMs > 6 * 60 * 60 * 1000) continue;
                if (dateFilter === '12h' && ageMs > 12 * 60 * 60 * 1000) continue;
                if (dateFilter === '24h' && ageMs > 24 * 60 * 60 * 1000) continue;
                if (dateFilter === '7d' && ageMs > 7 * 24 * 60 * 60 * 1000) continue;
                if (dateFilter === '30d' && ageMs > 30 * 24 * 60 * 60 * 1000) continue;
            }

            if (query) {
                const inShow = view.show_title.toLowerCase().includes(query);
                const inRef = view.reference_episode_label.toLowerCase().includes(query);
                const inEp = view.episodes?.some(ep =>
                    ep.episode_label.toLowerCase().includes(query)
                );
                if (!inShow && !inRef && !inEp) continue;
            }

            result.push(view);
        }
        return result;
    }, [operations, userFilter, dateFilter, titleFilter]);

    const toggleExpand = (id: number) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const handleClearLogs = async (range: ClearLogsRange) => {
        if (!machineIdentifier) return;
        setIsClearing(true);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/logs?olderThan=${encodeURIComponent(range)}`,
                {
                    method: 'DELETE',
                    credentials: 'same-origin',
                }
            );
            if (res.ok) {
                setShowClearModal(false);
                await loadOperations();
            }
        } catch {
            // Ignore transient error
        } finally {
            setIsClearing(false);
        }
    };

    return (
        <div>
            <div className="card mb-3 p-3">
                <div className="d-flex flex-wrap align-items-center gap-3 small">
                    <span className="fw-bold text-white">Filter Logs:</span>

                    <div className="d-flex align-items-center gap-2">
                        <span className="text-muted">User:</span>
                        <PastaDropdown
                            value={userFilter}
                            onChange={setUserFilter}
                            minWidth="140px"
                            options={[
                                { value: 'all', label: 'All Users' },
                                ...userOptions.map(name => ({
                                    value: name,
                                    label: name,
                                })),
                            ]}
                        />
                    </div>

                    <div className="d-flex align-items-center gap-2">
                        <span className="text-muted">Time:</span>
                        <PastaDropdown
                            value={dateFilter}
                            onChange={setDateFilter}
                            minWidth="155px"
                            options={[
                                { value: 'all', label: 'All Time' },
                                { value: '5m', label: 'Last 5 Minutes' },
                                { value: '15m', label: 'Last 15 Minutes' },
                                { value: '30m', label: 'Last 30 Minutes' },
                                { value: '1h', label: 'Last 1 Hour' },
                                { value: '6h', label: 'Last 6 Hours' },
                                { value: '12h', label: 'Last 12 Hours' },
                                { value: '24h', label: 'Last 24 Hours' },
                                { value: '7d', label: 'Last 7 Days' },
                                { value: '30d', label: 'Last 30 Days' },
                            ]}
                        />
                    </div>

                    <div className="d-flex align-items-center gap-2">
                        <span className="text-muted">Title:</span>
                        <input
                            type="text"
                            className="form-control form-control-sm"
                            style={{ width: '220px' }}
                            placeholder="Filter by show or episode..."
                            value={titleFilter}
                            onChange={e => setTitleFilter(e.target.value)}
                        />
                    </div>

                    <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm ms-auto"
                        onClick={() => setShowClearModal(true)}
                    >
                        <i className="fas fa-trash-alt me-1"></i>
                        Clear Logs
                    </button>
                </div>
            </div>

            <ClearLogsModal
                show={showClearModal}
                title="Clear Automation Logs"
                isClearing={isClearing}
                onClose={() => setShowClearModal(false)}
                onConfirm={range => void handleClearLogs(range)}
            />

            {loading ? (
                <div className="text-center py-5">
                    <div className="spinner-border text-warning" role="status" />
                </div>
            ) : error ? (
                <div className="alert alert-danger">{error}</div>
            ) : filteredOperations.length === 0 ? (
                <div className="card shadow-sm">
                    <div className="card-body text-center text-muted py-5">
                        {operations.length === 0
                            ? 'No automation events recorded yet for this server.'
                            : 'No logs match the selected filters.'}
                    </div>
                </div>
            ) : (
                <div className="d-flex flex-column gap-3">
                    {filteredOperations.map(op => {
                        const isExpanded = expandedIds.has(op.id);
                        const isScanEvent =
                            op.trigger_type === 'NEW_EPISODE_SCAN' ||
                            op.trigger_type === 'UPGRADED_FILE_SCAN';

                        return (
                            <div key={op.id} className="card shadow-sm">
                                <div
                                    className="card-header bg-white d-flex justify-content-between align-items-center"
                                    style={{ cursor: 'pointer', userSelect: 'none' }}
                                    onClick={() => toggleExpand(op.id)}
                                >
                                    <div>
                                        <h5 className="mb-1">
                                            {op.show_title} -{' '}
                                            {isScanEvent
                                                ? `${op.reference_episode_label} (${formatTriggerBadge(
                                                      op.trigger_type
                                                  )})`
                                                : `Triggered by ${op.reference_episode_label} (${formatTriggerBadge(
                                                      op.trigger_type
                                                  )})`}
                                        </h5>
                                        <div className="small text-muted">
                                            {isScanEvent ? (
                                                <>
                                                    Source:{' '}
                                                    <strong className="text-light">
                                                        Library Scanner
                                                    </strong>{' '}
                                                    • Scope: 1 Episode (
                                                    {op.updated_count + op.skipped_count}{' '}
                                                    {op.updated_count + op.skipped_count === 1
                                                        ? 'user'
                                                        : 'users'}{' '}
                                                    evaluated)
                                                </>
                                            ) : (
                                                <>
                                                    User:{' '}
                                                    <strong className="text-light">
                                                        {op.username}
                                                    </strong>
                                                    {op.audio_summary
                                                        ? ` • Audio: ${op.audio_summary}`
                                                        : ''}
                                                    {op.subtitle_summary
                                                        ? ` • Subtitles: ${op.subtitle_summary}`
                                                        : ''}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="d-flex align-items-center gap-3 small">
                                        <span>
                                            <strong style={{ color: '#F39C12' }}>
                                                {op.updated_count}
                                            </strong>{' '}
                                            {isScanEvent
                                                ? op.updated_count === 1
                                                    ? 'User Updated'
                                                    : 'Users Updated'
                                                : op.updated_count === 1
                                                  ? 'Episode Updated'
                                                  : 'Episodes Updated'}
                                            , {op.skipped_count}{' '}
                                            {isScanEvent
                                                ? op.skipped_count === 1
                                                    ? 'User Skipped'
                                                    : 'Users Skipped'
                                                : op.skipped_count === 1
                                                  ? 'Episode Skipped'
                                                  : 'Episodes Skipped'}{' '}
                                            • {formatRelativeTime(op.created_at)}
                                        </span>
                                        <i
                                            className={`fas fa-chevron-${
                                                isExpanded ? 'up' : 'down'
                                            }`}
                                        ></i>
                                    </div>
                                </div>

                                {isExpanded && op.episodes && op.episodes.length > 0 && (
                                    <div className="table-responsive">
                                        <table className="table table-hover table-sm mb-0 align-middle">
                                            <thead>
                                                <tr>
                                                    <th>Episode</th>
                                                    <th>User</th>
                                                    <th>Change to Apply</th>
                                                    <th>Match Reason</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {op.episodes.map(ep => (
                                                    <tr key={ep.id}>
                                                        <td>{ep.episode_label}</td>
                                                        <td>{ep.target_username}</td>
                                                        <td>
                                                            {renderChangeToApply(
                                                                ep,
                                                                op,
                                                                isScanEvent
                                                            )}
                                                        </td>
                                                        <td>{renderMatchReasonBadge(ep)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
