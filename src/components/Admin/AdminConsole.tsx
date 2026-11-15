import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { PastaDropdown } from '../Layout/PastaDropdown';
import { ActivityLog } from './ActivityLog';
import { RuleManager } from './RuleManager';
import { ServerConfig } from './ServerConfig';
import { ServerDebugging } from './ServerDebugging';
import { UserManager } from './UserManager';

type AdminTab = 'logs' | 'rules' | 'users' | 'config' | 'debugging';

interface Props {
    initialMachineIdentifier?: string | null;
    onSelectMachineIdentifier?: (machineIdentifier: string) => void;
    onBack: () => void;
}

export const AdminConsole: React.FC<Props> = ({
    initialMachineIdentifier,
    onSelectMachineIdentifier,
    onBack,
}) => {
    const { managedServers, machineIdentifier, isServerConnected } = useAuth();
    const [selectedMachineId, setSelectedMachineId] = useState<string>(
        initialMachineIdentifier ||
            machineIdentifier ||
            managedServers[0]?.machineIdentifier ||
            ''
    );
    const [activeTab, setActiveTab] = useState<AdminTab>('logs');
    const [refreshToken, setRefreshToken] = useState(0);

    useEffect(() => {
        if (initialMachineIdentifier) {
            setSelectedMachineId(initialMachineIdentifier);
        } else if (
            !selectedMachineId &&
            managedServers.length > 0 &&
            managedServers[0]?.machineIdentifier
        ) {
            setSelectedMachineId(managedServers[0].machineIdentifier);
        }
    }, [initialMachineIdentifier, managedServers, selectedMachineId]);

    const currentServerEntry = managedServers.find(
        s => s.machineIdentifier === selectedMachineId
    );
    const isCallerOwner = currentServerEntry?.role === 'owner';

    if (managedServers.length === 0) {
        return (
            <div className="container py-4">
                <div className="card shadow-sm p-4 text-center">
                    <h4 className="mb-3">Admin Settings</h4>
                    <p className="text-muted">
                        You do not have Owner or PASTA Admin privileges for any Plex server
                        managed by this PASTA instance.
                    </p>
                    <div>
                        <button
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={onBack}
                        >
                            ← Back
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container py-4" style={{ maxWidth: '1140px' }}>
            <div className="d-flex flex-wrap justify-content-between align-items-center gap-3 mb-3">
                <div>
                    <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm mb-2"
                        onClick={onBack}
                    >
                        <i className="fas fa-arrow-left me-2"></i>
                        {isServerConnected ? 'Back to Media Browser' : 'Back to Server Selection'}
                    </button>
                    <h3 className="mb-0">Admin Settings</h3>
                </div>

                <div className="d-flex align-items-center gap-2">
                    <span className="text-muted small">Server:</span>
                    {managedServers.length <= 1 ? (
                        <span
                            className="form-control form-control-sm fw-bold d-inline-block"
                            style={{
                                color: '#F39C12',
                                width: 'auto',
                                minWidth: '140px',
                                cursor: 'default',
                            }}
                        >
                            {managedServers[0]?.serverName}
                        </span>
                    ) : (
                        <PastaDropdown
                            value={selectedMachineId}
                            onChange={val => {
                                setSelectedMachineId(val);
                                onSelectMachineIdentifier?.(val);
                            }}
                            minWidth="200px"
                            align="end"
                            options={managedServers.map(srv => ({
                                value: srv.machineIdentifier,
                                label: srv.serverName,
                            }))}
                        />
                    )}
                </div>
            </div>

            <div className="d-flex flex-wrap gap-2 mb-4">
                <button
                    type="button"
                    className={`btn btn-sm ${
                        activeTab === 'logs' ? 'btn-primary' : 'btn-outline-primary'
                    }`}
                    onClick={() => setActiveTab('logs')}
                >
                    Logs
                </button>
                <button
                    type="button"
                    className={`btn btn-sm ${
                        activeTab === 'rules' ? 'btn-primary' : 'btn-outline-primary'
                    }`}
                    onClick={() => setActiveTab('rules')}
                >
                    Library Settings
                </button>
                <button
                    type="button"
                    className={`btn btn-sm ${
                        activeTab === 'users' ? 'btn-primary' : 'btn-outline-primary'
                    }`}
                    onClick={() => setActiveTab('users')}
                >
                    Users
                </button>
                <button
                    type="button"
                    className={`btn btn-sm ${
                        activeTab === 'config' ? 'btn-primary' : 'btn-outline-primary'
                    }`}
                    onClick={() => setActiveTab('config')}
                >
                    Server Configuration
                </button>
                <button
                    type="button"
                    className={`btn btn-sm ${
                        activeTab === 'debugging' ? 'btn-primary' : 'btn-outline-primary'
                    }`}
                    onClick={() => setActiveTab('debugging')}
                >
                    Debugging
                </button>
                <button
                    type="button"
                    className="btn btn-outline-primary btn-sm ms-auto"
                    onClick={() => setRefreshToken(t => t + 1)}
                >
                    <i className="fas fa-sync-alt me-1"></i>
                    Refresh
                </button>
            </div>

            {selectedMachineId && (
                <>
                    {activeTab === 'logs' && (
                        <ActivityLog
                            machineIdentifier={selectedMachineId}
                            refreshToken={refreshToken}
                        />
                    )}
                    {activeTab === 'rules' && (
                        <RuleManager
                            key={`rules-${refreshToken}`}
                            machineIdentifier={selectedMachineId}
                        />
                    )}
                    {activeTab === 'users' && (
                        <UserManager
                            key={`users-${refreshToken}`}
                            machineIdentifier={selectedMachineId}
                            isCallerOwner={isCallerOwner}
                        />
                    )}
                    {activeTab === 'config' && (
                        <ServerConfig
                            key={`config-${refreshToken}`}
                            machineIdentifier={selectedMachineId}
                            onNavigateToRules={() => setActiveTab('rules')}
                        />
                    )}
                    {activeTab === 'debugging' && (
                        <ServerDebugging
                            key={`debugging-${refreshToken}`}
                            machineIdentifier={selectedMachineId}
                        />
                    )}
                </>
            )}
        </div>
    );
};
