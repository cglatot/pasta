/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SettingsContextType {
    autoCollapse: boolean;
    setAutoCollapse: (value: boolean) => void;
    maxListItems: number;
    setMaxListItems: (value: number) => void;
    navWidth: number;
    setNavWidth: (value: number) => void;
    connectionTimeout: number;
    setConnectionTimeout: (value: number) => void;
    resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

const loadSetting = <T,>(key: string, fallback: T): T => {
    const saved = localStorage.getItem(key);
    if (saved === null) return fallback;
    try {
        return JSON.parse(saved) as T;
    } catch {
        return fallback;
    }
};

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Initialize from localStorage or defaults
    const [autoCollapse, setAutoCollapseState] = useState(() =>
        loadSetting('pasta_settings_autoCollapse', false)
    );

    const [maxListItems, setMaxListItemsState] = useState(() =>
        loadSetting('pasta_settings_maxListItems', 6)
    );

    const [navWidth, setNavWidthState] = useState(() =>
        loadSetting('pasta_settings_navWidth', 25)
    );

    const [connectionTimeout, setConnectionTimeoutState] = useState(() =>
        loadSetting('pasta_settings_connectionTimeout', 5)
    );

    // Persistence wrappers
    const setAutoCollapse = (value: boolean) => {
        setAutoCollapseState(value);
        localStorage.setItem('pasta_settings_autoCollapse', JSON.stringify(value));
    };

    const setMaxListItems = (value: number) => {
        setMaxListItemsState(value);
        localStorage.setItem('pasta_settings_maxListItems', JSON.stringify(value));
    };

    const setNavWidth = (value: number) => {
        setNavWidthState(value);
        localStorage.setItem('pasta_settings_navWidth', JSON.stringify(value));
    };

    const setConnectionTimeout = (value: number) => {
        setConnectionTimeoutState(value);
        localStorage.setItem('pasta_settings_connectionTimeout', JSON.stringify(value));
    };

    const resetSettings = () => {
        setAutoCollapse(false);
        setMaxListItems(6);
        setNavWidth(25);
        setConnectionTimeout(5);
    };

    return (
        <SettingsContext.Provider value={{
            autoCollapse,
            setAutoCollapse,
            maxListItems,
            setMaxListItems,
            navWidth,
            setNavWidth,
            connectionTimeout,
            setConnectionTimeout,
            resetSettings
        }}>
            {children}
        </SettingsContext.Provider>
    );
};

export const useSettings = () => {
    const context = useContext(SettingsContext);
    if (context === undefined) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
};
