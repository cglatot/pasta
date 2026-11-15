/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext } from 'react';
import { clientStandaloneProvider } from './client/ClientProvider';
import { serverModeProvider } from './server/ServerProvider';
import type { IPastaProvider } from './types';

declare global {
    interface Window {
        __PASTA_SERVER_MODE__?: boolean;
        __PASTA_UNMOUNTED_CONFIG__?: boolean;
    }
}

export const isServerRuntimeMode = (): boolean => {
    if (import.meta.env.VITE_PASTA_MODE === 'server' || import.meta.env.MODE === 'server') {
        return true;
    }
    return typeof window !== 'undefined' && Boolean(window.__PASTA_SERVER_MODE__);
};

export const isUnmountedConfigFallback = (): boolean => {
    return typeof window !== 'undefined' && Boolean(window.__PASTA_UNMOUNTED_CONFIG__);
};

const defaultProvider: IPastaProvider = isServerRuntimeMode()
    ? serverModeProvider
    : clientStandaloneProvider;

const PastaProviderContext = createContext<IPastaProvider>(defaultProvider);

export const PastaProvider: React.FC<{
    provider?: IPastaProvider;
    children: React.ReactNode;
}> = ({ provider, children }) => {
    const activeProvider =
        provider || (isServerRuntimeMode() ? serverModeProvider : clientStandaloneProvider);
    return (
        <PastaProviderContext.Provider value={activeProvider}>
            {children}
        </PastaProviderContext.Provider>
    );
};

export const usePastaProvider = (): IPastaProvider => {
    return useContext(PastaProviderContext);
};
