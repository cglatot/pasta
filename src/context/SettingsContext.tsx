import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface SettingsContextType {
    autoCollapse: boolean;
    setAutoCollapse: (value: boolean) => void;
    maxListItems: number;
    setMaxListItems: (value: number) => void;
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

    // Persistence wrappers
    const setAutoCollapse = (value: boolean) => {
        setAutoCollapseState(value);
        localStorage.setItem('pasta_settings_autoCollapse', JSON.stringify(value));
    };

    const setMaxListItems = (value: number) => {
        setMaxListItemsState(value);
        localStorage.setItem('pasta_settings_maxListItems', JSON.stringify(value));
    };

    return (
        <SettingsContext.Provider value={{ autoCollapse, setAutoCollapse, maxListItems, setMaxListItems }}>
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
