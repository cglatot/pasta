import type { PlexMetadata } from '../../../src/shared/types/plex.ts';
import { getDatabase } from '../storage/db.ts';

const DEFAULT_IGNORE_KEYWORDS = ['pasta_ignore', 'pal-ignore'];
const DEFAULT_FORCED_IGNORE_KEYWORDS = ['pasta_no_forced'];

export interface RuleEvaluationResult {
    allowed: boolean;
    reason: string;
}

/**
 * Evaluates whether TV automation is permitted for a given TV episode.
 * Precedence Hierarchy:
 * 1. Non-TV items (e.g. movies) -> always false
 * 2. Ignore Keywords / Labels (PASTA_IGNORE, PAL-IGNORE, custom keywords on Show or Episode) -> false
 * 3. Disabled Library (`scope_type = 'library'` with `policy = 'IGNORE'`) -> false
 * 4. Season rule (`scope_type = 'season'`) -> ALLOW or IGNORE
 * 5. Show rule (`scope_type = 'show'`) -> ALLOW or IGNORE
 * 6. Library rule (`scope_type = 'library'`) -> ALLOW or IGNORE
 * 7. Default for TV Show libraries -> ALLOW
 */
export const evaluateAutomationRule = (
    machineIdentifier: string,
    episode: PlexMetadata,
    show?: PlexMetadata | null
): RuleEvaluationResult => {
    if (episode.type !== 'episode') {
        return {
            allowed: false,
            reason: 'Automation is only enabled for TV Show episodes',
        };
    }

    const db = getDatabase();
    const rules = db
        .prepare(
            'SELECT scope_type, target_key, policy FROM automation_rules WHERE machine_identifier = ?'
        )
        .all(machineIdentifier) as Array<{
        scope_type: 'library' | 'show' | 'season' | 'keyword';
        target_key: string;
        policy: 'ALLOW' | 'IGNORE';
    }>;

    // 1. Check Ignore Keywords & Labels (across both Episode and parent Show metadata)
    const removedDefaults = new Set(
        rules
            .filter(r => r.scope_type === 'keyword' && r.policy === 'ALLOW')
            .map(r => r.target_key.toLowerCase().trim())
    );
    const activeDefaults = DEFAULT_IGNORE_KEYWORDS.filter(kw => !removedDefaults.has(kw));
    const customKeywords = rules
        .filter(r => r.scope_type === 'keyword' && r.policy === 'IGNORE')
        .map(r => r.target_key.toLowerCase().trim())
        .filter(Boolean);

    const allIgnoreKeywords = Array.from(new Set([...activeDefaults, ...customKeywords]));

    const labels = [
        ...(episode.Label || []),
        ...(show?.Label || []),
    ].map(l => (l.tag || '').toLowerCase().trim());

    const filePaths = (episode.Media || [])
        .flatMap(m => m.Part || [])
        .map(p => (p.file || '').toLowerCase());
    const searchableText = [
        episode.title || '',
        episode.parentTitle || '',
        episode.grandparentTitle || '',
        episode.summary || '',
        show?.title || '',
        show?.summary || '',
        ...labels,
        ...filePaths,
    ]
        .join(' ')
        .toLowerCase();

    for (const kw of allIgnoreKeywords) {
        if (kw && (labels.includes(kw) || searchableText.includes(kw))) {
            return {
                allowed: false,
                reason: `Matched ignore keyword "${kw}"`,
            };
        }
    }

    const seasonKey = episode.parentRatingKey ? String(episode.parentRatingKey) : '';
    const showKey = episode.grandparentRatingKey
        ? String(episode.grandparentRatingKey)
        : show?.ratingKey
          ? String(show.ratingKey)
          : '';
    const rawLibId =
        episode.librarySectionID ??
        episode.librarySectionKey ??
        show?.librarySectionID ??
        show?.librarySectionKey;
    const libraryKey = rawLibId ? String(rawLibId).replace(/^\/library\/sections\//, '') : '';

    // 2. Library-level IGNORE overrides everything underneath it when a library is unticked
    if (libraryKey) {
        const libRule = rules.find(
            r => r.scope_type === 'library' && r.target_key === libraryKey
        );
        if (libRule && libRule.policy === 'IGNORE') {
            return {
                allowed: false,
                reason: 'Library rule (IGNORE)',
            };
        }
    }

    // 3. Season-level rule
    if (seasonKey) {
        const seasonRule = rules.find(
            r => r.scope_type === 'season' && r.target_key === seasonKey
        );
        if (seasonRule) {
            return {
                allowed: seasonRule.policy === 'ALLOW',
                reason: `Season rule (${seasonRule.policy})`,
            };
        }
    }

    // 4. Show-level rule
    if (showKey) {
        const showRule = rules.find(r => r.scope_type === 'show' && r.target_key === showKey);
        if (showRule) {
            return {
                allowed: showRule.policy === 'ALLOW',
                reason: `Show rule (${showRule.policy})`,
            };
        }
    }

    // 5. Library-level rule (ALLOW)
    if (libraryKey) {
        const libRule = rules.find(
            r => r.scope_type === 'library' && r.target_key === libraryKey
        );
        if (libRule) {
            return {
                allowed: libRule.policy === 'ALLOW',
                reason: `Library rule (${libRule.policy})`,
            };
        }
    }

    return {
        allowed: true,
        reason: 'Default TV Library policy (ALLOW)',
    };
};

/**
 * Evaluates whether automatic forced subtitle fallback is permitted for a given TV episode.
 * Precedence Hierarchy:
 * 1. Master server toggle (`masterEnabled`) -> if false, always false
 * 2. Forced Ignore Keywords / Labels (`PASTA_NO_FORCED`, custom keywords on Show) -> false
 * 3. Disabled Library Forced Subs (`scope_type = 'library_forced'` with `policy = 'IGNORE'`) -> false
 * 4. Show Forced Subs rule (`scope_type = 'show_forced'`) -> ALLOW or IGNORE
 * 5. Library Forced Subs rule (`scope_type = 'library_forced'`) -> ALLOW or IGNORE
 * 6. Default when master toggle is enabled -> true
 */
export const evaluateForcedSubtitleRule = (
    machineIdentifier: string,
    masterEnabled: boolean,
    episode: PlexMetadata,
    show?: PlexMetadata | null
): boolean => {
    if (!masterEnabled || episode.type !== 'episode') {
        return false;
    }

    const db = getDatabase();
    const rules = db
        .prepare(
            'SELECT scope_type, target_key, policy FROM automation_rules WHERE machine_identifier = ?'
        )
        .all(machineIdentifier) as Array<{
        scope_type: string;
        target_key: string;
        policy: 'ALLOW' | 'IGNORE';
    }>;

    // 1. Check Forced Subtitle Ignore Keywords & Labels (Show-level labels & metadata)
    const removedDefaults = new Set(
        rules
            .filter(r => r.scope_type === 'keyword_forced' && r.policy === 'ALLOW')
            .map(r => r.target_key.toLowerCase().trim())
    );
    const activeDefaults = DEFAULT_FORCED_IGNORE_KEYWORDS.filter(kw => !removedDefaults.has(kw));
    const customKeywords = rules
        .filter(r => r.scope_type === 'keyword_forced' && r.policy === 'IGNORE')
        .map(r => r.target_key.toLowerCase().trim())
        .filter(Boolean);

    const allForcedIgnoreKeywords = Array.from(new Set([...activeDefaults, ...customKeywords]));

    const labels = [
        ...(episode.Label || []),
        ...(show?.Label || []),
    ].map(l => (l.tag || '').toLowerCase().trim());

    const filePaths = (episode.Media || [])
        .flatMap(m => m.Part || [])
        .map(p => (p.file || '').toLowerCase());
    const searchableText = [
        episode.title || '',
        episode.parentTitle || '',
        episode.grandparentTitle || '',
        episode.summary || '',
        show?.title || '',
        show?.summary || '',
        ...labels,
        ...filePaths,
    ]
        .join(' ')
        .toLowerCase();

    for (const kw of allForcedIgnoreKeywords) {
        if (kw && (labels.includes(kw) || searchableText.includes(kw))) {
            return false;
        }
    }

    const showKey = episode.grandparentRatingKey
        ? String(episode.grandparentRatingKey)
        : show?.ratingKey
          ? String(show.ratingKey)
          : '';
    const rawLibId =
        episode.librarySectionID ??
        episode.librarySectionKey ??
        show?.librarySectionID ??
        show?.librarySectionKey;
    const libraryKey = rawLibId ? String(rawLibId).replace(/^\/library\/sections\//, '') : '';

    // 2. Library-level forced IGNORE overrides shows inside that library when library Forced Subs is unticked
    if (libraryKey) {
        const libForcedRule = rules.find(
            r => r.scope_type === 'library_forced' && r.target_key === libraryKey
        );
        if (libForcedRule && libForcedRule.policy === 'IGNORE') {
            return false;
        }
    }

    // 3. Show-level forced rule
    if (showKey) {
        const showForcedRule = rules.find(
            r => r.scope_type === 'show_forced' && r.target_key === showKey
        );
        if (showForcedRule) {
            return showForcedRule.policy === 'ALLOW';
        }
    }

    // 4. Library-level forced rule (ALLOW)
    if (libraryKey) {
        const libForcedRule = rules.find(
            r => r.scope_type === 'library_forced' && r.target_key === libraryKey
        );
        if (libForcedRule) {
            return libForcedRule.policy === 'ALLOW';
        }
    }

    return true;
};
