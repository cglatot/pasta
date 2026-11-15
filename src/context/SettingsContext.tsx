/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';

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

const loadScopedSetting = <T,>(
    userScope: string,
    settingName: string,
    fallback: T,
    allowLegacyFallback: boolean
): T => {
    const scopedKey = `pasta_settings_${userScope}_${settingName}`;
    const saved = localStorage.getItem(scopedKey);
    if (saved !== null) {
        try {
            return JSON.parse(saved) as T;
        } catch {
            return fallback;
        }
    }
    if (allowLegacyFallback) {
        const legacySaved = localStorage.getItem(`pasta_settings_${settingName}`);
        if (legacySaved !== null) {
            try {
                return JSON.parse(legacySaved) as T;
            } catch {
                return fallback;
            }
        }
    }
    return fallback;
};

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const { user, isManagedUser } = useAuth();
    const userScope = user?.id
        ? `user_${user.id}`
        : user?.uuid
          ? `user_${user.uuid}`
          : 'default';
    const allowLegacy = !isManagedUser && userScope !== 'default';

    // Initialize from per-user localStorage or defaults
    const [autoCollapse, setAutoCollapseState] = useState(() =>
        loadScopedSetting(userScope, 'autoCollapse', false, allowLegacy)
    );

    const [maxListItems, setMaxListItemsState] = useState(() =>
        loadScopedSetting(userScope, 'maxListItems', 6, allowLegacy)
    );

    const [navWidth, setNavWidthState] = useState(() =>
        loadScopedSetting(userScope, 'navWidth', 25, allowLegacy)
    );

    const [connectionTimeout, setConnectionTimeoutState] = useState(() =>
        loadScopedSetting(userScope, 'connectionTimeout', 5, allowLegacy)
    );

    // Reload settings whenever the active Plex profile changes (Admin <-> Managed User)
    useEffect(() => {
        setAutoCollapseState(loadScopedSetting(userScope, 'autoCollapse', false, allowLegacy));
        setMaxListItemsState(loadScopedSetting(userScope, 'maxListItems', 6, allowLegacy));
        setNavWidthState(loadScopedSetting(userScope, 'navWidth', 25, allowLegacy));
        setConnectionTimeoutState(
            loadScopedSetting(userScope, 'connectionTimeout', 5, allowLegacy)
        );
    }, [userScope, allowLegacy]);

    // Persistence wrappers scoped to the active user profile
    const setAutoCollapse = (value: boolean) => {
        setAutoCollapseState(value);
        localStorage.setItem(
            `pasta_settings_${userScope}_autoCollapse`,
            JSON.stringify(value)
        );
    };

    const setMaxListItems = (value: number) => {
        setMaxListItemsState(value);
        localStorage.setItem(
            `pasta_settings_${userScope}_maxListItems`,
            JSON.stringify(value)
        );
    };

    const setNavWidth = (value: number) => {
        setNavWidthState(value);
        localStorage.setItem(`pasta_settings_${userScope}_navWidth`, JSON.stringify(value));
    };

    const setConnectionTimeout = (value: number) => {
        setConnectionTimeoutState(value);
        localStorage.setItem(
            `pasta_settings_${userScope}_connectionTimeout`,
            JSON.stringify(value)
        );
    };

    const resetSettings = () => {
        setAutoCollapse(false);
        setMaxListItems(6);
        setNavWidth(25);
        setConnectionTimeout(5);
    };

    return (
        <SettingsContext.Provider
            value={{
                autoCollapse,
                setAutoCollapse,
                maxListItems,
                setMaxListItems,
                navWidth,
                setNavWidth,
                connectionTimeout,
                setConnectionTimeout,
                resetSettings,
            }}
        >
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
