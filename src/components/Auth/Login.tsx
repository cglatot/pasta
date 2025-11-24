import React, { useState } from 'react';
import { PinLogin } from './PinLogin';
import { ManualLogin } from './ManualLogin';

export const Login: React.FC = () => {
    const [mode, setMode] = useState<'pin' | 'manual'>('pin');

    return (
        <div className="card border-0 shadow my-5">
            <div className="card-body p-5">
                <div className="text-center mb-4">
                    <div className="btn-group" role="group">
                        <button
                            type="button"
                            className={`btn ${mode === 'pin' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setMode('pin')}
                        >
                            Plex Login
                        </button>
                        <button
                            type="button"
                            className={`btn ${mode === 'manual' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setMode('manual')}
                        >
                            Manual Connection
                        </button>
                    </div>
                </div>

                {mode === 'pin' ? <PinLogin /> : <ManualLogin />}
            </div>
        </div>
    );
};
