import React, { useState, useEffect, useCallback } from 'react';

interface ServerUserRow {
    machineIdentifier: string;
    plexUserId: number;
    uuid: string;
    username: string;
    title: string;
    email: string;
    thumb: string;
    isHomeUser: boolean;
    isProtected: boolean;
    isServerOwner: boolean;
    isPastaAdmin: boolean;
}

interface Props {
    machineIdentifier: string;
    isCallerOwner: boolean;
}

export const UserManager: React.FC<Props> = ({ machineIdentifier, isCallerOwner }) => {
    const [users, setUsers] = useState<ServerUserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [updatingUserId, setUpdatingUserId] = useState<number | null>(null);

    const loadUsers = useCallback(async () => {
        if (!machineIdentifier) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/users`,
                { credentials: 'same-origin' }
            );
            if (!res.ok) {
                throw new Error('Failed to load server users');
            }
            const data = (await res.json()) as ServerUserRow[];
            setUsers(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load users');
        } finally {
            setLoading(false);
        }
    }, [machineIdentifier]);

    useEffect(() => {
        void loadUsers();
    }, [loadUsers]);

    const togglePastaAdmin = async (targetUser: ServerUserRow, nextValue: boolean) => {
        if (!isCallerOwner || targetUser.isServerOwner) return;
        setUpdatingUserId(targetUser.plexUserId);
        setError(null);
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/users/${
                    targetUser.plexUserId
                }/role`,
                {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isPastaAdmin: nextValue }),
                }
            );
            if (!res.ok) {
                const errData = (await res.json().catch(() => ({}))) as { error?: string };
                throw new Error(errData.error || 'Failed to update user role');
            }
            const data = (await res.json()) as { users?: ServerUserRow[] };
            if (Array.isArray(data.users)) {
                setUsers(data.users);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update role');
        } finally {
            setUpdatingUserId(null);
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
        <div className="card shadow-sm" style={{ maxWidth: '760px' }}>
            <div className="card-header bg-white">
                <h5 className="mb-0">Users</h5>
            </div>
            {error && <div className="alert alert-danger m-3 py-2">{error}</div>}
            <div className="table-responsive">
                <table className="table table-hover mb-0 align-middle">
                    <thead>
                        <tr>
                            <th style={{ width: '35%' }}>User</th>
                            <th style={{ width: '25%' }}>Type</th>
                            <th style={{ width: '25%' }}>Role</th>
                            <th className="text-center" style={{ width: '15%', whiteSpace: 'nowrap' }}>
                                PASTA Admin
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(u => {
                            const isOwner = u.isServerOwner;
                            const isAdmin = u.isPastaAdmin;
                            const typeLabel = isOwner
                                ? 'Server Owner'
                                : u.isHomeUser
                                  ? 'Plex Home User'
                                  : 'Shared User';
                            const roleLabel = isOwner
                                ? 'Owner'
                                : isAdmin
                                  ? 'PASTA Admin'
                                  : 'Standard User';

                            return (
                                <tr key={u.plexUserId}>
                                    <td>
                                        <div className="d-flex align-items-center gap-2">
                                            {u.thumb && (
                                                <img
                                                    src={u.thumb}
                                                    alt={u.username}
                                                    className="rounded-circle"
                                                    style={{ width: 24, height: 24 }}
                                                />
                                            )}
                                            <span>{u.title || u.username}</span>
                                        </div>
                                    </td>
                                    <td>{typeLabel}</td>
                                    <td>{roleLabel}</td>
                                    <td className="text-center" style={{ verticalAlign: 'middle' }}>
                                        {isOwner ? (
                                            <span className="text-muted">--</span>
                                        ) : (
                                            <div className="d-flex justify-content-center align-items-center">
                                            <input
                                                className="form-check-input m-0"
                                                type="checkbox"
                                                style={{
                                                    width: '1.35em',
                                                    height: '1.35em',
                                                    cursor: isCallerOwner
                                                        ? 'pointer'
                                                        : 'not-allowed',
                                                }}
                                                checked={isAdmin}
                                                disabled={
                                                    !isCallerOwner ||
                                                    updatingUserId === u.plexUserId
                                                }
                                                title={
                                                    isCallerOwner
                                                        ? 'Grant or revoke PASTA Admin privileges'
                                                        : 'Only the Plex Server Owner can grant or revoke PASTA Admin privileges'
                                                }
                                                onChange={e =>
                                                    void togglePastaAdmin(u, e.target.checked)
                                                }
                                            />
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {users.length === 0 && (
                            <tr>
                                <td colSpan={4} className="text-center text-muted py-4">
                                    No users synced for this server yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
