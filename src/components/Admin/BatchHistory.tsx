import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../providers/server/ServerProvider';
import { PastaDropdown } from '../Layout/PastaDropdown';
import { ClearLogsModal, type ClearLogsRange } from './ClearLogsModal';

interface ManualBatchLogRow {
    id: number;
    machine_identifier: string;
    initiated_by_user_id: number;
    initiated_by_username: string;
    target_users_mode: string;
    target_users_summary: string;
    target_user_ids_json: string;
    scope: string;
    target_title: string;
    stream_type: string;
    selected_stream_name: string;
    updated_count: number;
    skipped_count: number;
    duration_ms: number;
    created_at: number;
}

interface ServerUserItem {
    plex_user_id?: number;
    plexUserId?: number;
    username: string;
    title?: string;
}

interface Props {
    machineIdentifierOverride?: string | null;
    onBack: () => void;
}

export const BatchHistory: React.FC<Props> = ({ machineIdentifierOverride, onBack }) => {
    const { machineIdentifier: connectedMachineId, isServerConnected } = useAuth();
    const machineIdentifier = connectedMachineId || machineIdentifierOverride || null;
    const [logs, setLogs] = useState<ManualBatchLogRow[]>([]);
    const [isAdmin, setIsAdmin] = useState(false);
    const [serverUsers, setServerUsers] = useState<ServerUserItem[]>([]);
    const [loading, setLoading] = useState(true);

    // Admin filters
    const [initiatedByFilter, setInitiatedByFilter] = useState<string>('all');
    const [appliedToFilter, setAppliedToFilter] = useState<string>('any');
    const [scopeFilter, setScopeFilter] = useState<string>('all');
    const [showClearModal, setShowClearModal] = useState(false);
    const [isClearing, setIsClearing] = useState(false);

    const loadHistory = useCallback(async () => {
        if (!machineIdentifier) {
            setLogs([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const data = await apiFetch<{ logs: ManualBatchLogRow[]; isAdmin: boolean }>(
                '/api/batch/history',
                {
                    params: {
                        machineIdentifier,
                        initiatedBy: initiatedByFilter,
                        appliedTo: appliedToFilter,
                        scope: scopeFilter,
                    },
                }
            );
            setLogs(data.logs || []);
            setIsAdmin(Boolean(data.isAdmin));

            if (data.isAdmin && serverUsers.length === 0) {
                const users = await apiFetch<ServerUserItem[]>(
                    `/api/admin/${encodeURIComponent(machineIdentifier)}/users`
                ).catch((): ServerUserItem[] => []);
                setServerUsers(users);
            }
        } catch (err) {
            console.error('Failed to load batch logs:', err);
        } finally {
            setLoading(false);
        }
    }, [machineIdentifier, initiatedByFilter, appliedToFilter, scopeFilter, serverUsers.length]);

    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    const formatTimestamp = (ts: number) => {
        try {
            return new Date(ts).toLocaleString();
        } catch {
            return '';
        }
    };

    const handleClearLogs = async (range: ClearLogsRange) => {
        if (!machineIdentifier) return;
        setIsClearing(true);
        try {
            const res = await fetch(
                `/api/batch/history?machineIdentifier=${encodeURIComponent(
                    machineIdentifier
                )}&olderThan=${encodeURIComponent(range)}`,
                {
                    method: 'DELETE',
                    credentials: 'same-origin',
                }
            );
            if (res.ok) {
                setShowClearModal(false);
                await loadHistory();
            }
        } catch {
            // Ignore transient error
        } finally {
            setIsClearing(false);
        }
    };

    const initiatedByOptions = useMemo(() => {
        const userMap = new Map<string, string>();
        for (const u of serverUsers) {
            const uid = String(u.plex_user_id ?? u.plexUserId ?? 0);
            if (uid !== '0') userMap.set(uid, u.title || u.username);
        }
        for (const l of logs) {
            const uid = String(l.initiated_by_user_id);
            if (!userMap.has(uid) && l.initiated_by_username) {
                userMap.set(uid, `${l.initiated_by_username} (former)`);
            }
        }
        return [
            { value: 'all', label: 'All Users' },
            ...Array.from(userMap.entries()).map(([value, label]) => ({ value, label })),
        ];
    }, [serverUsers, logs]);

    const appliedToOptions = useMemo(() => {
        const userMap = new Map<string, string>();
        for (const u of serverUsers) {
            const uid = String(u.plex_user_id ?? u.plexUserId ?? 0);
            if (uid !== '0') userMap.set(uid, u.title || u.username);
        }
        for (const l of logs) {
            try {
                const ids = JSON.parse(l.target_user_ids_json) as number[];
                if (Array.isArray(ids)) {
                    for (const id of ids) {
                        const sid = String(id);
                        if (!userMap.has(sid)) {
                            userMap.set(sid, `User ${sid} (former)`);
                        }
                    }
                }
            } catch {
                // Ignore parse error
            }
        }
        return [
            { value: 'any', label: 'Any User' },
            { value: 'all', label: 'All Users' },
            ...Array.from(userMap.entries()).map(([value, label]) => ({ value, label })),
        ];
    }, [serverUsers, logs]);

    return (
        <div className="container my-4">
            <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                    <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm mb-2"
                        onClick={onBack}
                    >
                        <i className="fas fa-arrow-left me-2"></i>
                        {isServerConnected ? 'Back to Media Browser' : 'Back to Server Selection'}
                    </button>
                    <h3 className="mb-0">Logs (Manual Batch Runs)</h3>
                </div>
                <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    onClick={() => void loadHistory()}
                >
                    <i className="fas fa-sync-alt me-1"></i>
                    Refresh
                </button>
            </div>

            {isAdmin && (
                <div className="card mb-3 p-3">
                    <div className="d-flex flex-wrap align-items-center gap-3 small">
                        <span className="fw-bold text-white">Filter Logs:</span>

                        <div className="d-flex align-items-center gap-2">
                            <span className="text-muted">Initiated By:</span>
                            <PastaDropdown
                                value={initiatedByFilter}
                                onChange={setInitiatedByFilter}
                                minWidth="140px"
                                options={initiatedByOptions}
                            />
                        </div>

                        <div className="d-flex align-items-center gap-2">
                            <span className="text-muted">Applied To:</span>
                            <PastaDropdown
                                value={appliedToFilter}
                                onChange={setAppliedToFilter}
                                minWidth="140px"
                                options={appliedToOptions}
                            />
                        </div>

                        <div className="d-flex align-items-center gap-2">
                            <span className="text-muted">Scope:</span>
                            <PastaDropdown
                                value={scopeFilter}
                                onChange={setScopeFilter}
                                minWidth="135px"
                                options={[
                                    { value: 'all', label: 'All Scopes' },
                                    { value: 'library', label: 'Library' },
                                    { value: 'collection', label: 'Collection' },
                                    { value: 'show', label: 'Show' },
                                    { value: 'season', label: 'Season' },
                                ]}
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
            )}

            <ClearLogsModal
                show={showClearModal}
                title="Clear Manual Batch Logs"
                isClearing={isClearing}
                onClose={() => setShowClearModal(false)}
                onConfirm={range => void handleClearLogs(range)}
            />

            <div className="card shadow">
                <div className="table-responsive">
                    <table className="table table-hover mb-0">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Initiated By</th>
                                <th>Applied To</th>
                                <th>Scope</th>
                                <th>Target</th>
                                <th>Selected Track</th>
                                <th>Result</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-4 text-muted">
                                        Loading batch logs...
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="text-center py-4 text-muted">
                                        No manual batch runs recorded yet.
                                    </td>
                                </tr>
                            ) : (
                                logs.map(log => (
                                    <tr key={log.id}>
                                        <td className="small">{formatTimestamp(log.created_at)}</td>
                                        <td>{log.initiated_by_username}</td>
                                        <td>{log.target_users_summary}</td>
                                        <td className="text-capitalize">{log.scope}</td>
                                        <td className="fw-bold">{log.target_title}</td>
                                        <td>
                                            <span className="text-capitalize">{log.stream_type}:</span>{' '}
                                            {log.selected_stream_name}
                                        </td>
                                        <td>
                                            {log.updated_count} updated, {log.skipped_count} skipped
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};
