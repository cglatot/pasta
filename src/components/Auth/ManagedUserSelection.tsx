import React, { useState, useRef, useEffect } from 'react';
import type { PlexHomeUser } from '../../types/plex';
import { LoadingOverlay } from '../Layout/LoadingOverlay';

interface PinVerificationCardProps {
    title: string;
    backLabel?: string;
    loadingMessage?: string;
    onVerify: (pin: string) => Promise<void> | void;
    onBack: () => void;
}

export const PinVerificationCard: React.FC<PinVerificationCardProps> = ({
    title,
    backLabel = 'Back',
    loadingMessage = 'Verifying PIN...',
    onVerify,
    onBack,
}) => {
    const [digits, setDigits] = useState<string[]>(['', '', '', '']);
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const inputRefs = [
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
        useRef<HTMLInputElement>(null),
    ];

    useEffect(() => {
        inputRefs[0].current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const submitPin = async (pinValue: string) => {
        if (submitting || pinValue.length !== 4) return;
        setSubmitting(true);
        setError('');
        try {
            await onVerify(pinValue);
        } catch {
            setError('Incorrect PIN. Please try again.');
            setDigits(['', '', '', '']);
            setTimeout(() => inputRefs[0].current?.focus(), 50);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDigitChange = (index: number, rawValue: string) => {
        if (submitting) return;
        const cleaned = rawValue.replace(/\D/g, '');
        if (!cleaned) {
            const next = [...digits];
            next[index] = '';
            setDigits(next);
            return;
        }

        const char = cleaned.slice(-1);
        const next = [...digits];
        next[index] = char;
        setDigits(next);
        if (error) setError('');

        if (index < 3) {
            inputRefs[index + 1].current?.focus();
        }

        const joined = next.join('');
        if (joined.length === 4 && next.every(d => d.length === 1)) {
            void submitPin(joined);
        }
    };

    const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (submitting) return;

        if (e.key === 'Backspace') {
            if (digits[index]) {
                e.preventDefault();
                const next = [...digits];
                next[index] = '';
                setDigits(next);
            } else if (index > 0) {
                e.preventDefault();
                const next = [...digits];
                next[index - 1] = '';
                setDigits(next);
                inputRefs[index - 1].current?.focus();
            }
        } else if (e.key === 'ArrowLeft' && index > 0) {
            e.preventDefault();
            inputRefs[index - 1].current?.focus();
        } else if (e.key === 'ArrowRight' && index < 3) {
            e.preventDefault();
            inputRefs[index + 1].current?.focus();
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        if (submitting) return;
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
        if (!pasted) return;

        const next = ['', '', '', ''];
        for (let i = 0; i < pasted.length; i++) {
            next[i] = pasted[i];
        }
        setDigits(next);
        if (error) setError('');

        if (pasted.length === 4) {
            void submitPin(pasted);
        } else {
            inputRefs[pasted.length]?.current?.focus();
        }
    };

    return (
        <>
            {submitting && <LoadingOverlay message={loadingMessage} />}
            <div className="card shadow-sm">
                <div className="card-header bg-white d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">{title}</h5>
                    <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        onClick={onBack}
                        disabled={submitting}
                    >
                        {backLabel}
                    </button>
                </div>
                <div className="card-body py-4">
                    <div className="d-flex justify-content-center gap-3 my-2">
                        {digits.map((digit, idx) => (
                            <input
                                key={idx}
                                ref={inputRefs[idx]}
                                type="password"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                className="form-control text-center fw-bold"
                                style={{
                                    width: '56px',
                                    height: '64px',
                                    fontSize: '1.5rem',
                                }}
                                value={digit}
                                onChange={e => handleDigitChange(idx, e.target.value)}
                                onKeyDown={e => handleKeyDown(idx, e)}
                                onPaste={handlePaste}
                                maxLength={1}
                                disabled={submitting}
                                aria-label={`PIN digit ${idx + 1}`}
                            />
                        ))}
                    </div>
                    {error && (
                        <div className="alert alert-danger py-2 mt-3 mb-0 text-center">
                            {error}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

interface Props {
    users: PlexHomeUser[];
    onSelect: (user: PlexHomeUser, pin?: string) => Promise<void> | void;
    onCancel?: () => void;
}

export const ManagedUserSelection: React.FC<Props> = ({ users, onSelect, onCancel }) => {
    const [selectedUser, setSelectedUser] = useState<PlexHomeUser | null>(null);
    const [switching, setSwitching] = useState(false);

    const handleUserClick = async (user: PlexHomeUser) => {
        if (user.protected) {
            setSelectedUser(user);
        } else {
            setSwitching(true);
            try {
                await onSelect(user);
            } finally {
                setSwitching(false);
            }
        }
    };

    if (selectedUser) {
        return (
            <PinVerificationCard
                title={`Enter PIN for ${selectedUser.title || selectedUser.username}`}
                backLabel="Back"
                loadingMessage="Switching user..."
                onVerify={async pin => {
                    await onSelect(selectedUser, pin);
                }}
                onBack={() => setSelectedUser(null)}
            />
        );
    }

    return (
        <>
            {switching && <LoadingOverlay message="Switching user..." />}
            <div className="card shadow-sm">
                <div className="card-header bg-white d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">Select User</h5>
                    {onCancel && (
                        <button className="btn btn-outline-secondary btn-sm" onClick={onCancel}>
                            Cancel
                        </button>
                    )}
                </div>
                <div className="list-group list-group-flush">
                    {users.map(user => (
                        <button
                            key={user.id}
                            className="list-group-item list-group-item-action d-flex align-items-center p-3"
                            onClick={() => void handleUserClick(user)}
                        >
                            <img
                                src={user.thumb}
                                alt={user.username}
                                className="rounded-circle me-3"
                                style={{ width: 40, height: 40, objectFit: 'cover' }}
                            />
                            <div className="flex-grow-1">
                                <div className="fw-bold">{user.title || user.username}</div>
                                {user.email && <small className="text-muted">{user.email}</small>}
                            </div>
                            {user.protected && <i className="fas fa-lock text-warning"></i>}
                        </button>
                    ))}
                </div>
            </div>
        </>
    );
};
