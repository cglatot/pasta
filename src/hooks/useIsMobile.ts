import { useState, useEffect } from 'react';

/**
 * Hook to detect if viewport is mobile size (< 768px)
 * Uses Bootstrap's md breakpoint
 */
export const useIsMobile = (): boolean => {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkIsMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };

        // Initial check
        checkIsMobile();

        // Listen for resize events
        window.addEventListener('resize', checkIsMobile);

        return () => window.removeEventListener('resize', checkIsMobile);
    }, []);

    return isMobile;
};
