import React, { useState, useRef, useEffect, useCallback } from 'react';

export interface VirtualListRowProps<T> {
    index: number;
    style: React.CSSProperties;
    data: T;
}

interface VirtualListProps<T> {
    items: T[];
    itemHeight: number;
    height?: number;
    className?: string;
    style?: React.CSSProperties;
    overscan?: number;
    children: (props: VirtualListRowProps<T>) => React.ReactNode;
}

export function VirtualList<T>({
    items,
    itemHeight,
    height,
    className,
    style,
    overscan = 3,
    children
}: VirtualListProps<T>) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [observedHeight, setObservedHeight] = useState(() => {
        if (typeof window !== 'undefined') {
            return Math.round(window.innerHeight * 0.6);
        }
        return 400;
    });

    useEffect(() => {
        if (height !== undefined || !containerRef.current) return;
        if (containerRef.current.clientHeight > 0) {
            setObservedHeight(containerRef.current.clientHeight);
        }
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                if (entry.contentRect.height > 0) {
                    setObservedHeight(entry.contentRect.height);
                }
            }
        });
        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [height]);

    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        setScrollTop(e.currentTarget.scrollTop);
    }, []);

    const effectiveHeight = height ?? observedHeight;
    const totalHeight = items.length * itemHeight;

    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(effectiveHeight / itemHeight) + 2 * overscan;
    const endIndex = Math.min(items.length, startIndex + visibleCount);

    const visibleItems: React.ReactNode[] = [];
    for (let i = startIndex; i < endIndex; i++) {
        const itemStyle: React.CSSProperties = {
            position: 'absolute',
            top: i * itemHeight,
            left: 0,
            width: '100%',
            height: itemHeight
        };
        visibleItems.push(children({ index: i, style: itemStyle, data: items[i] }));
    }

    return (
        <div
            ref={containerRef}
            onScroll={handleScroll}
            className={className}
            style={{
                overflowY: 'auto',
                position: 'relative',
                height: height ?? '100%',
                width: '100%',
                ...style
            }}
        >
            <div style={{ height: totalHeight, width: '100%', position: 'relative' }}>
                {visibleItems}
            </div>
        </div>
    );
}
