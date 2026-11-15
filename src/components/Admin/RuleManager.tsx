import React, { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import type { PlexLibrary, PlexMetadata } from '../../types/plex';

type RuleScopeType =
    | 'library'
    | 'show'
    | 'season'
    | 'keyword'
    | 'library_forced'
    | 'show_forced'
    | 'keyword_forced';

interface AutomationRuleRow {
    id: number;
    scope_type: RuleScopeType;
    target_key: string;
    target_title: string;
    parent_key: string | null;
    policy: 'ALLOW' | 'IGNORE';
    updated_at: number;
}

interface Props {
    machineIdentifier: string;
}

const DEFAULT_KEYWORDS = ['PASTA_IGNORE', 'PAL-IGNORE'];
const DEFAULT_FORCED_KEYWORDS = ['PASTA_NO_FORCED'];
const FORCED_MASTER_OFF_TOOLTIP =
    "Enable 'Auto-Select Forced Subtitles Matching Audio' in Server Configuration to use this setting.";

/** Minimum height of an expanded Show Exclusions list, even on very short screens. */
const MIN_EXCLUSIONS_HEIGHT = 160;
/** Breathing room kept below the Ignore Keywords card (matches the page's bottom margin). */
const PAGE_BOTTOM_GAP = 24;

const CHECKBOX_COL_WIDTH = '110px';
const CHECKBOX_SIZE_STYLE: React.CSSProperties = {
    width: '1.35em',
    height: '1.35em',
};

const formatLibraryTypeLabel = (type: string): string => {
    switch (type) {
        case 'show':
            return 'TV Show Library';
        case 'movie':
            return 'Movie Library';
        case 'artist':
            return 'Music Library';
        case 'photo':
            return 'Photo Library';
        default:
            return 'Library';
    }
};

export const RuleManager: React.FC<Props> = ({ machineIdentifier }) => {
    const [libraries, setLibraries] = useState<PlexLibrary[]>([]);
    const [rules, setRules] = useState<AutomationRuleRow[]>([]);
    const [masterForcedEnabled, setMasterForcedEnabled] = useState<boolean>(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Expanded library keys and cached shows for Show Exclusions
    const [expandedLibraries, setExpandedLibraries] = useState<Set<string>>(new Set());
    const [libraryShows, setLibraryShows] = useState<Record<string, PlexMetadata[]>>({});
    const [newKeyword, setNewKeyword] = useState('');
    const [newForcedKeyword, setNewForcedKeyword] = useState('');

    // Dynamic Show Exclusions height & scrollbar width compensation
    const exclusionListRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const keywordsCardRef = useRef<HTMLDivElement>(null);
    const [exclusionsMaxHeight, setExclusionsMaxHeight] = useState<number>(320);
    // Matches the 10px ::-webkit-scrollbar width in index.css; updated dynamically from live DOM
    const [scrollbarCompensation, setScrollbarCompensation] = useState<number>(10);

    const recalcExclusionsHeight = useCallback(() => {
        const lists = Array.from(exclusionListRefs.current.values());
        if (lists.length > 0) {
            const measuredSbWidth = lists[0].offsetWidth - lists[0].clientWidth;
            if (measuredSbWidth > 0 && measuredSbWidth !== scrollbarCompensation) {
                setScrollbarCompensation(measuredSbWidth);
            }
        }

        const keywordsCard = keywordsCardRef.current;
        if (lists.length === 0 || !keywordsCard) return;

        const firstTop = Math.min(
            ...lists.map(el => el.getBoundingClientRect().top + window.scrollY)
        );
        const listsHeight = lists.reduce(
            (sum, el) => sum + el.getBoundingClientRect().height,
            0
        );
        const keywordsBottom = keywordsCard.getBoundingClientRect().bottom + window.scrollY;
        const nonListContent = keywordsBottom - firstTop - listsHeight;
        const available = window.innerHeight - firstTop - nonListContent - PAGE_BOTTOM_GAP;

        setExclusionsMaxHeight(
            Math.max(MIN_EXCLUSIONS_HEIGHT, Math.floor(available / lists.length))
        );
    }, [scrollbarCompensation]);

    useLayoutEffect(() => {
        recalcExclusionsHeight();
    }, [recalcExclusionsHeight, expandedLibraries, libraryShows]);

    useEffect(() => {
        window.addEventListener('resize', recalcExclusionsHeight);
        return () => window.removeEventListener('resize', recalcExclusionsHeight);
    }, [recalcExclusionsHeight]);

    const loadData = useCallback(async () => {
        if (!machineIdentifier) return;
        setLoading(true);
        setError(null);
        try {
            const [libsRes, rulesRes, configRes] = await Promise.all([
                fetch(`/api/media/${encodeURIComponent(machineIdentifier)}/libraries`, {
                    credentials: 'same-origin',
                }),
                fetch(`/api/admin/${encodeURIComponent(machineIdentifier)}/rules`, {
                    credentials: 'same-origin',
                }),
                fetch(`/api/admin/${encodeURIComponent(machineIdentifier)}/config`, {
                    credentials: 'same-origin',
                }),
            ]);

            if (!libsRes.ok || !rulesRes.ok) {
                throw new Error('Failed to load library automation rules');
            }

            const [libsData, rulesData] = await Promise.all([
                libsRes.json() as Promise<PlexLibrary[]>,
                rulesRes.json() as Promise<AutomationRuleRow[]>,
            ]);

            if (configRes.ok) {
                const configData = (await configRes.json()) as {
                    autoForcedSubtitles?: boolean;
                };
                setMasterForcedEnabled(Boolean(configData.autoForcedSubtitles));
            }

            setLibraries(libsData);
            setRules(rulesData);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load library settings');
        } finally {
            setLoading(false);
        }
    }, [machineIdentifier]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const getPolicy = (
        scopeType: RuleScopeType,
        targetKey: string
    ): 'ALLOW' | 'IGNORE' | 'DEFAULT' => {
        const found = rules.find(
            r => r.scope_type === scopeType && r.target_key === String(targetKey)
        );
        return found ? found.policy : 'DEFAULT';
    };

    const isLibraryEnabled = (libKey: string): boolean => {
        return getPolicy('library', libKey) !== 'IGNORE';
    };

    const isLibraryForcedEnabled = (libKey: string): boolean => {
        if (!masterForcedEnabled || !isLibraryEnabled(libKey)) return false;
        return getPolicy('library_forced', libKey) !== 'IGNORE';
    };

    const isShowEnabled = (libKey: string, showKey: string): boolean => {
        if (!isLibraryEnabled(libKey)) return false;
        return getPolicy('show', showKey) !== 'IGNORE';
    };

    const isShowForcedEnabled = (libKey: string, showKey: string): boolean => {
        if (
            !masterForcedEnabled ||
            !isLibraryForcedEnabled(libKey) ||
            !isShowEnabled(libKey, showKey)
        ) {
            return false;
        }
        return getPolicy('show_forced', showKey) !== 'IGNORE';
    };

    const saveRule = async (
        scopeType: RuleScopeType,
        targetKey: string,
        targetTitle: string,
        parentKey: string | null,
        policy: 'ALLOW' | 'IGNORE' | 'DEFAULT'
    ) => {
        try {
            const res = await fetch(
                `/api/admin/${encodeURIComponent(machineIdentifier)}/rules`,
                {
                    method: 'PUT',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        scopeType,
                        targetKey,
                        targetTitle,
                        parentKey,
                        policy,
                    }),
                }
            );
            if (res.ok) {
                const updated = (await res.json()) as AutomationRuleRow[];
                setRules(updated);
            }
        } catch {
            // Ignore transient network errors
        }
    };

    const toggleExpandLibrary = async (libKey: string) => {
        const next = new Set(expandedLibraries);
        if (next.has(libKey)) {
            next.delete(libKey);
            setExpandedLibraries(next);
            return;
        }
        next.add(libKey);
        setExpandedLibraries(next);

        if (!libraryShows[libKey]) {
            try {
                const res = await fetch(
                    `/api/media/${encodeURIComponent(
                        machineIdentifier
                    )}/libraries/${encodeURIComponent(libKey)}/items`,
                    { credentials: 'same-origin' }
                );
                if (res.ok) {
                    const items = (await res.json()) as PlexMetadata[];
                    setLibraryShows(prev => ({ ...prev, [libKey]: items }));
                }
            } catch {
                // Ignore
            }
        }
    };

    const handleAddKeyword = async (e: React.FormEvent) => {
        e.preventDefault();
        const clean = newKeyword.trim();
        if (!clean) return;
        setNewKeyword('');
        await saveRule('keyword', clean, clean, null, 'IGNORE');
    };

    const handleAddForcedKeyword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!masterForcedEnabled) return;
        const clean = newForcedKeyword.trim();
        if (!clean) return;
        setNewForcedKeyword('');
        await saveRule('keyword_forced', clean, clean, null, 'IGNORE');
    };

    if (loading) {
        return (
            <div className="text-center py-5">
                <div className="spinner-border text-warning" role="status" />
            </div>
        );
    }

    if (error) {
        return <div className="alert alert-danger">{error}</div>;
    }

    // 1. Active general ignore keywords
    const keywordRules = rules.filter(r => r.scope_type === 'keyword');
    const removedDefaults = new Set(
        keywordRules
            .filter(r => r.policy === 'ALLOW')
            .map(r => r.target_key.toUpperCase().trim())
    );
    const activeDefaultKeywords = DEFAULT_KEYWORDS.filter(kw => !removedDefaults.has(kw));
    const customKeywordRows = keywordRules.filter(
        r =>
            r.policy === 'IGNORE' &&
            !DEFAULT_KEYWORDS.includes(r.target_key.toUpperCase().trim())
    );

    // 2. Active forced-subtitle ignore keywords
    const forcedKeywordRules = rules.filter(r => r.scope_type === 'keyword_forced');
    const removedForcedDefaults = new Set(
        forcedKeywordRules
            .filter(r => r.policy === 'ALLOW')
            .map(r => r.target_key.toUpperCase().trim())
    );
    const activeDefaultForcedKeywords = DEFAULT_FORCED_KEYWORDS.filter(
        kw => !removedForcedDefaults.has(kw)
    );
    const customForcedKeywordRows = forcedKeywordRules.filter(
        r =>
            r.policy === 'IGNORE' &&
            !DEFAULT_FORCED_KEYWORDS.includes(r.target_key.toUpperCase().trim())
    );

    return (
        <div className="d-flex flex-column gap-4">
            <div className="card shadow-sm">
                <div className="card-header bg-white px-3 d-flex justify-content-between align-items-center">
                    <h5 className="mb-0">Libraries</h5>
                    <div
                        className="d-flex align-items-center"
                        style={{ paddingRight: `${scrollbarCompensation}px` }}
                    >
                        <div
                            className="small fw-bold text-center"
                            style={{ width: CHECKBOX_COL_WIDTH }}
                        >
                            Automation
                        </div>
                        <div
                            className="small fw-bold text-center"
                            style={{
                                width: CHECKBOX_COL_WIDTH,
                                opacity: masterForcedEnabled ? 1 : 0.5,
                            }}
                            title={
                                !masterForcedEnabled
                                    ? FORCED_MASTER_OFF_TOOLTIP
                                    : 'Auto-select Forced subtitles matching audio when subtitles are None'
                            }
                        >
                            Forced Subs
                        </div>
                    </div>
                </div>
                <div>
                    {libraries.map((lib, idx) => {
                        const isTv = lib.type === 'show';
                        const enabled = isTv && isLibraryEnabled(lib.key);
                        const libForcedEnabled = isTv && isLibraryForcedEnabled(lib.key);
                        const isExpanded = expandedLibraries.has(lib.key);
                        const shows = libraryShows[lib.key] || [];
                        const isLast = idx === libraries.length - 1;

                        if (!isTv) {
                            return (
                                <div
                                    key={lib.key}
                                    className="px-3 py-2 d-flex justify-content-between align-items-center"
                                    style={{
                                        opacity: 0.5,
                                        cursor: 'not-allowed',
                                        borderBottom: isLast ? 'none' : '1px solid #444',
                                    }}
                                    title="Automation is only available for TV Show libraries."
                                >
                                    <div className="d-flex align-items-center flex-wrap gap-2">
                                        <span className="text-muted">
                                            {lib.title} ({formatLibraryTypeLabel(lib.type)} -
                                            Disabled)
                                        </span>
                                        <span className="small text-muted">
                                            - Automation is only available for TV Show libraries
                                        </span>
                                    </div>
                                    <div
                                        className="d-flex align-items-center"
                                        style={{ paddingRight: `${scrollbarCompensation}px` }}
                                    >
                                        <div
                                            className="d-flex justify-content-center"
                                            style={{ width: CHECKBOX_COL_WIDTH }}
                                        >
                                            <input
                                                className="form-check-input m-0"
                                                type="checkbox"
                                                disabled
                                                checked={false}
                                                readOnly
                                                style={{
                                                    ...CHECKBOX_SIZE_STYLE,
                                                    cursor: 'not-allowed',
                                                    pointerEvents: 'none',
                                                }}
                                            />
                                        </div>
                                        <div
                                            className="d-flex justify-content-center"
                                            style={{ width: CHECKBOX_COL_WIDTH }}
                                        >
                                            <input
                                                className="form-check-input m-0"
                                                type="checkbox"
                                                disabled
                                                checked={false}
                                                readOnly
                                                style={{
                                                    ...CHECKBOX_SIZE_STYLE,
                                                    cursor: 'not-allowed',
                                                    pointerEvents: 'none',
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        }

                        const libForcedDisabled = !masterForcedEnabled || !enabled;
                        const libForcedTooltip = !masterForcedEnabled
                            ? FORCED_MASTER_OFF_TOOLTIP
                            : !enabled
                              ? 'Enable library automation to configure Forced Subtitles for this library.'
                              : undefined;

                        return (
                            <div
                                key={lib.key}
                                className="px-3 py-2"
                                style={{
                                    cursor: 'default',
                                    borderBottom: isLast ? 'none' : '1px solid #444',
                                }}
                            >
                                <div className="d-flex justify-content-between align-items-center">
                                    <div className="d-flex align-items-center flex-wrap gap-3">
                                        <label
                                            className="fw-bold mb-0"
                                            htmlFor={`lib-rule-${lib.key}`}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            {lib.title} (TV Show Library)
                                        </label>
                                        <button
                                            type="button"
                                            className="btn btn-outline-primary btn-sm"
                                            onClick={() => void toggleExpandLibrary(lib.key)}
                                        >
                                            Show Exclusions {isExpanded ? '▾' : '▸'}
                                        </button>
                                    </div>

                                    <div
                                        className="d-flex align-items-center"
                                        style={{ paddingRight: `${scrollbarCompensation}px` }}
                                    >
                                        <div
                                            className="d-flex justify-content-center"
                                            style={{ width: CHECKBOX_COL_WIDTH }}
                                        >
                                            <input
                                                className="form-check-input m-0"
                                                type="checkbox"
                                                id={`lib-rule-${lib.key}`}
                                                style={{
                                                    ...CHECKBOX_SIZE_STYLE,
                                                    cursor: 'pointer',
                                                }}
                                                checked={enabled}
                                                onChange={e =>
                                                    void saveRule(
                                                        'library',
                                                        lib.key,
                                                        lib.title,
                                                        null,
                                                        e.target.checked ? 'ALLOW' : 'IGNORE'
                                                    )
                                                }
                                            />
                                        </div>
                                        <div
                                            className="d-flex justify-content-center"
                                            style={{ width: CHECKBOX_COL_WIDTH }}
                                        >
                                            <span
                                                className="d-inline-flex"
                                                title={libForcedTooltip}
                                                style={{
                                                    opacity: libForcedDisabled ? 0.5 : 1,
                                                    cursor: libForcedDisabled
                                                        ? 'not-allowed'
                                                        : 'pointer',
                                                }}
                                            >
                                                <input
                                                    className="form-check-input m-0"
                                                    type="checkbox"
                                                    id={`lib-forced-rule-${lib.key}`}
                                                    disabled={libForcedDisabled}
                                                    checked={
                                                        libForcedDisabled ? false : libForcedEnabled
                                                    }
                                                    style={{
                                                        ...CHECKBOX_SIZE_STYLE,
                                                        cursor: libForcedDisabled
                                                            ? 'not-allowed'
                                                            : 'pointer',
                                                        pointerEvents: libForcedDisabled
                                                            ? 'none'
                                                            : 'auto',
                                                    }}
                                                    onChange={e =>
                                                        void saveRule(
                                                            'library_forced',
                                                            lib.key,
                                                            lib.title,
                                                            null,
                                                            e.target.checked ? 'ALLOW' : 'IGNORE'
                                                        )
                                                    }
                                                />
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {isExpanded && (
                                    <div
                                        ref={el => {
                                            if (el) {
                                                exclusionListRefs.current.set(lib.key, el);
                                            } else {
                                                exclusionListRefs.current.delete(lib.key);
                                            }
                                        }}
                                        className="mt-3 ps-3 pt-2 border-top border-secondary"
                                        style={{
                                            maxHeight: `${exclusionsMaxHeight}px`,
                                            overflowY: 'auto',
                                            scrollbarGutter: 'stable',
                                        }}
                                    >
                                        {shows.length === 0 ? (
                                            <div className="small text-muted py-1">
                                                Loading shows...
                                            </div>
                                        ) : (
                                            shows.map(show => {
                                                const showAllowed = isShowEnabled(
                                                    lib.key,
                                                    show.ratingKey
                                                );
                                                const showForcedAllowed = isShowForcedEnabled(
                                                    lib.key,
                                                    show.ratingKey
                                                );
                                                const showForcedDisabled =
                                                    !masterForcedEnabled ||
                                                    !enabled ||
                                                    !libForcedEnabled ||
                                                    !showAllowed;
                                                const showForcedTooltip = !masterForcedEnabled
                                                    ? FORCED_MASTER_OFF_TOOLTIP
                                                    : !enabled || !libForcedEnabled
                                                      ? 'Forced Subtitles are disabled for this library.'
                                                      : !showAllowed
                                                        ? 'Automation is disabled for this show.'
                                                        : undefined;

                                                return (
                                                    <div
                                                        key={show.ratingKey}
                                                        className="d-flex justify-content-between align-items-center py-1 ps-2 rounded hover-highlight"
                                                    >
                                                        <span
                                                            className={`small ${
                                                                showAllowed
                                                                    ? 'text-light'
                                                                    : 'text-muted'
                                                            }`}
                                                        >
                                                            {show.title}
                                                        </span>
                                                        <div className="d-flex align-items-center">
                                                            <div
                                                                className="d-flex justify-content-center"
                                                                style={{
                                                                    width: CHECKBOX_COL_WIDTH,
                                                                }}
                                                            >
                                                                <span
                                                                    className="d-inline-flex"
                                                                    title={
                                                                        !enabled
                                                                            ? 'Library automation is disabled.'
                                                                            : undefined
                                                                    }
                                                                    style={{
                                                                        opacity: !enabled ? 0.5 : 1,
                                                                        cursor: !enabled
                                                                            ? 'not-allowed'
                                                                            : 'pointer',
                                                                    }}
                                                                >
                                                                    <input
                                                                        className="form-check-input m-0"
                                                                        type="checkbox"
                                                                        disabled={!enabled}
                                                                        checked={showAllowed}
                                                                        style={{
                                                                            ...CHECKBOX_SIZE_STYLE,
                                                                            cursor: !enabled
                                                                                ? 'not-allowed'
                                                                                : 'pointer',
                                                                            pointerEvents: !enabled
                                                                                ? 'none'
                                                                                : 'auto',
                                                                        }}
                                                                        onChange={e =>
                                                                            void saveRule(
                                                                                'show',
                                                                                show.ratingKey,
                                                                                show.title,
                                                                                lib.key,
                                                                                e.target.checked
                                                                                    ? 'DEFAULT'
                                                                                    : 'IGNORE'
                                                                            )
                                                                        }
                                                                    />
                                                                </span>
                                                            </div>
                                                            <div
                                                                className="d-flex justify-content-center"
                                                                style={{
                                                                    width: CHECKBOX_COL_WIDTH,
                                                                }}
                                                            >
                                                                <span
                                                                    className="d-inline-flex"
                                                                    title={showForcedTooltip}
                                                                    style={{
                                                                        opacity: showForcedDisabled
                                                                            ? 0.5
                                                                            : 1,
                                                                        cursor: showForcedDisabled
                                                                            ? 'not-allowed'
                                                                            : 'pointer',
                                                                    }}
                                                                >
                                                                    <input
                                                                        className="form-check-input m-0"
                                                                        type="checkbox"
                                                                        disabled={
                                                                            showForcedDisabled
                                                                        }
                                                                        checked={
                                                                            showForcedDisabled
                                                                                ? false
                                                                                : showForcedAllowed
                                                                        }
                                                                        style={{
                                                                            ...CHECKBOX_SIZE_STYLE,
                                                                            cursor: showForcedDisabled
                                                                                ? 'not-allowed'
                                                                                : 'pointer',
                                                                            pointerEvents:
                                                                                showForcedDisabled
                                                                                    ? 'none'
                                                                                    : 'auto',
                                                                        }}
                                                                        onChange={e =>
                                                                            void saveRule(
                                                                                'show_forced',
                                                                                show.ratingKey,
                                                                                show.title,
                                                                                lib.key,
                                                                                e.target.checked
                                                                                    ? 'DEFAULT'
                                                                                    : 'IGNORE'
                                                                            )
                                                                        }
                                                                    />
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="card shadow-sm" ref={keywordsCardRef}>
                <div className="card-header bg-white">
                    <h5 className="mb-0">Ignore Keywords & Labels</h5>
                </div>
                <div className="card-body">
                    <div>
                        <p className="small text-muted mb-2">
                            Shows or episodes with any of these Plex labels or keywords in their
                            title, summary, or file path will be ignored by automation.
                        </p>
                        <div className="d-flex flex-wrap align-items-center gap-2">
                            {activeDefaultKeywords.map(kw => (
                                <button
                                    key={kw}
                                    type="button"
                                    className="btn btn-outline-secondary btn-sm"
                                    onClick={() =>
                                        void saveRule('keyword', kw, kw, null, 'DEFAULT')
                                    }
                                    title="Click to remove keyword"
                                >
                                    {kw} ✕
                                </button>
                            ))}
                            {customKeywordRows.map(kw => (
                                <button
                                    key={kw.id}
                                    type="button"
                                    className="btn btn-outline-secondary btn-sm"
                                    onClick={() =>
                                        void saveRule(
                                            'keyword',
                                            kw.target_key,
                                            kw.target_title,
                                            null,
                                            'DEFAULT'
                                        )
                                    }
                                    title="Click to remove keyword"
                                >
                                    {kw.target_key} ✕
                                </button>
                            ))}
                            <form onSubmit={handleAddKeyword} className="d-inline-flex gap-2 ms-2">
                                <input
                                    type="text"
                                    className="form-control form-control-sm"
                                    placeholder="Add keyword..."
                                    value={newKeyword}
                                    onChange={e => setNewKeyword(e.target.value)}
                                    style={{ width: '180px' }}
                                />
                                <button type="submit" className="btn btn-primary btn-sm">
                                    Add
                                </button>
                            </form>
                        </div>
                    </div>

                    <hr className="my-3 border-secondary" />

                    <div
                        title={!masterForcedEnabled ? FORCED_MASTER_OFF_TOOLTIP : undefined}
                        style={{
                            opacity: masterForcedEnabled ? 1 : 0.5,
                            cursor: masterForcedEnabled ? 'default' : 'not-allowed',
                        }}
                    >
                        <div style={{ pointerEvents: masterForcedEnabled ? 'auto' : 'none' }}>
                            <p className="small text-muted mb-2">
                                Shows or episodes with any of these Plex labels or keywords in their
                                title, summary, or file path will be ignored by automatic Forced
                                subtitle selection.
                            </p>
                            <div className="d-flex flex-wrap align-items-center gap-2">
                                {activeDefaultForcedKeywords.map(kw => (
                                    <button
                                        key={kw}
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        disabled={!masterForcedEnabled}
                                        onClick={() =>
                                            void saveRule('keyword_forced', kw, kw, null, 'DEFAULT')
                                        }
                                        title="Click to remove keyword"
                                    >
                                        {kw} ✕
                                    </button>
                                ))}
                                {customForcedKeywordRows.map(kw => (
                                    <button
                                        key={kw.id}
                                        type="button"
                                        className="btn btn-outline-secondary btn-sm"
                                        disabled={!masterForcedEnabled}
                                        onClick={() =>
                                            void saveRule(
                                                'keyword_forced',
                                                kw.target_key,
                                                kw.target_title,
                                                null,
                                                'DEFAULT'
                                            )
                                        }
                                        title="Click to remove keyword"
                                    >
                                        {kw.target_key} ✕
                                    </button>
                                ))}
                                <form
                                    onSubmit={handleAddForcedKeyword}
                                    className="d-inline-flex gap-2 ms-2"
                                >
                                    <input
                                        type="text"
                                        className="form-control form-control-sm"
                                        placeholder="Add keyword..."
                                        disabled={!masterForcedEnabled}
                                        value={newForcedKeyword}
                                        onChange={e => setNewForcedKeyword(e.target.value)}
                                        style={{ width: '180px' }}
                                    />
                                    <button
                                        type="submit"
                                        className="btn btn-primary btn-sm"
                                        disabled={!masterForcedEnabled}
                                    >
                                        Add
                                    </button>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
