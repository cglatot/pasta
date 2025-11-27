import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SettingsContextType {
    autoCollapse: boolean;
    setAutoCollapse: (value: boolean) => void;
    maxListItems: number;
    setMaxListItems: (value: number) => void;
    navWidth: number;
    setNavWidth: (value: number) => void;
    resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Initialize from localStorage or defaults
    const [autoCollapse, setAutoCollapseState] = useState(() => {
        const saved = localStorage.getItem('pasta_settings_autoCollapse');
        return saved !== null ? JSON.parse(saved) : false;
    });

    const [maxListItems, setMaxListItemsState] = useState(() => {
        const saved = localStorage.getItem('pasta_settings_maxListItems');
        return saved !== null ? JSON.parse(saved) : 6;
    });

    const [navWidth, setNavWidthState] = useState(() => {
        const saved = localStorage.getItem('pasta_settings_navWidth');
        return saved !== null ? JSON.parse(saved) : 25;
    });

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

    const resetSettings = () => {
        setAutoCollapse(false);
        setMaxListItems(6);
        setNavWidth(25);
    };

    return (
        <SettingsContext.Provider value={{
            autoCollapse,
            setAutoCollapse,
            maxListItems,
            setMaxListItems,
            navWidth,
            setNavWidth,
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
