import React, { useState, useEffect, useRef } from 'react';

export interface PastaDropdownOption<T extends string = string> {
    value: T;
    label: string;
}

interface Props<T extends string = string> {
    id?: string;
    value: T;
    options: PastaDropdownOption<T>[];
    onChange: (value: T) => void;
    minWidth?: string | number;
    fullWidth?: boolean;
    align?: 'start' | 'end';
}

export const PastaDropdown = <T extends string = string>({
    id,
    value,
    options,
    onChange,
    minWidth = '150px',
    fullWidth = false,
    align = 'start',
}: Props<T>): React.ReactElement => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const handleOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open]);

    const selectedOption = options.find(o => o.value === value) || options[0];

    return (
        <div
            className={`position-relative ${fullWidth ? 'w-100' : 'd-inline-block'}`}
            ref={containerRef}
        >
            <button
                id={id}
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`btn btn-outline-primary btn-sm d-flex align-items-center justify-content-between gap-2 ${
                    fullWidth ? 'w-100' : ''
                }`}
                style={{ minWidth }}
                onClick={() => setOpen(prev => !prev)}
            >
                <span className="text-truncate">{selectedOption?.label ?? value}</span>
                <i className={`fas fa-chevron-${open ? 'up' : 'down'} small`} aria-hidden="true"></i>
            </button>

            {open && (
                <div
                    role="listbox"
                    className={`dropdown-menu ${
                        align === 'end' ? 'dropdown-menu-end' : ''
                    } show p-0`}
                    style={{
                        position: 'absolute',
                        left: align === 'end' ? 'auto' : 0,
                        right: align === 'end' ? 0 : 'auto',
                        top: '100%',
                        marginTop: '4px',
                        minWidth: fullWidth ? '100%' : '200px',
                        maxHeight: '320px',
                        overflowY: 'auto',
                        zIndex: 1055,
                    }}
                >
                    {options.map(opt => {
                        const isSelected = opt.value === value;
                        return (
                            <button
                                key={opt.value}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className="dropdown-item d-flex justify-content-between align-items-center gap-3 py-2 small"
                                onClick={() => {
                                    onChange(opt.value);
                                    setOpen(false);
                                }}
                            >
                                <span>{opt.label}</span>
                                {isSelected && <span style={{ color: '#F39C12' }} aria-hidden="true">✓</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
