import { useState, useEffect } from 'react';

/**
 * Hook to detect if viewport is mobile size (< 768px)
 * Uses Bootstrap's md breakpoint
 */
export const useIsMobile = (): boolean => {
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(max-width: 767.98px)').matches;
    });

    useEffect(() => {
        const mql = window.matchMedia('(max-width: 767.98px)');
        const onChange = (e: MediaQueryListEvent) => {
            setIsMobile(e.matches);
        };

        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
    }, []);

    return isMobile;
};
