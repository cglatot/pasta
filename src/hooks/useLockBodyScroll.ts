import { useEffect } from 'react';

let lockCount = 0;
let originalOverflow = '';
let appliedGutter = false;

/**
 * Prevents scrolling of the background while a modal or overlay is active.
 * Only applies scrollbar-gutter when a vertical scrollbar is actually present,
 * completely avoiding empty reserved gutters when the page does not need scrolling.
 */
export function useLockBodyScroll(lock: boolean): void {
    useEffect(() => {
        if (!lock) return;

        if (lockCount === 0) {
            originalOverflow = document.body.style.overflow;
            const hasVerticalScrollbar = window.innerWidth > document.documentElement.clientWidth;
            if (hasVerticalScrollbar) {
                document.documentElement.style.scrollbarGutter = 'stable';
                appliedGutter = true;
            }
            document.body.style.overflow = 'hidden';
        }
        lockCount++;

        return () => {
            lockCount--;
            if (lockCount <= 0) {
                lockCount = 0;
                document.body.style.overflow = originalOverflow;
                if (appliedGutter) {
                    document.documentElement.style.scrollbarGutter = '';
                    appliedGutter = false;
                }
            }
        };
    }, [lock]);
}
