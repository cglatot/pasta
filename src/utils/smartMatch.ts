import type { PlexStream } from '../types/plex';
import type { MatchReason } from '../types/batchTypes';

export interface MatchResult {
    stream: PlexStream;
    matchLevel: number;
    matchReason: MatchReason;
}

/**
 * Finds the best matching stream in a list of candidates based on the target stream's properties.
 * Uses a priority-based matching system from the legacy PASTA logic.
 * 
 * Match Priority (highest to lowest):
 * 1. Everything matches (title + displayTitle + language + languageCode + codec)
 * 2. title + displayTitle + codec match
 * 3. title + displayTitle match
 * 4. title matches (exact)
 * 5. displayTitle matches (exact)
 * 6. language matches
 * 7. languageCode matches
 */
export const findMatchingStream = (
    targetStream: PlexStream,
    candidateStreams: PlexStream[],
    keyword?: string
): MatchResult | null => {
    if (!candidateStreams || candidateStreams.length === 0) return null;

    // Filter candidates by stream type (audio/subtitle)
    let candidates = candidateStreams.filter(s => s.streamType === targetStream.streamType);

    // If a keyword is provided, filter candidates to only include those containing the keyword
    if (keyword && keyword.trim() !== '') {
        const lowerKeyword = keyword.toLowerCase().trim();
        candidates = candidates.filter(s => {
            const title = (s.title || '').toLowerCase();
            const displayTitle = (s.displayTitle || '').toLowerCase();
            return title.includes(lowerKeyword) || displayTitle.includes(lowerKeyword);
        });
    }

    if (candidates.length === 0) return null;

    const searchTitle = targetStream.title;
    const searchDisplayTitle = targetStream.displayTitle;
    const searchLanguage = targetStream.language;
    const searchCode = targetStream.languageCode;
    const searchCodec = targetStream.codec;

    // Helper to check if a value is defined and not "undefined" string
    const isDefined = (val: unknown): boolean => {
        return val !== undefined && val !== null && val !== 'undefined' && val !== '';
    };

    interface Match {
        stream: PlexStream;
        level: number;
        reason: MatchReason;
    }

    const potentialMatches: Match[] = [];

    for (const candidate of candidates) {
        let matchLevel = 0;
        let matchReason: MatchReason | null = null;

        // Level 7: Everything matches (including codec)
        if (
            isDefined(searchTitle) && candidate.title === searchTitle &&
            isDefined(searchDisplayTitle) && candidate.displayTitle === searchDisplayTitle &&
            isDefined(searchLanguage) && candidate.language === searchLanguage &&
            isDefined(searchCode) && candidate.languageCode === searchCode &&
            isDefined(searchCodec) && candidate.codec === searchCodec
        ) {
            matchLevel = 7;
            matchReason = 'Exact Match (All Properties)';
        }
        // Level 6: title + displayTitle + codec match
        else if (
            isDefined(searchTitle) && candidate.title === searchTitle &&
            isDefined(searchDisplayTitle) && candidate.displayTitle === searchDisplayTitle &&
            isDefined(searchCodec) && candidate.codec === searchCodec
        ) {
            matchLevel = 6;
            matchReason = 'Match: Title + Display Title + Codec';
        }
        // Level 5: title + displayTitle match
        else if (
            isDefined(searchTitle) && candidate.title === searchTitle &&
            isDefined(searchDisplayTitle) && candidate.displayTitle === searchDisplayTitle
        ) {
            matchLevel = 5;
            matchReason = 'Match: Title + Display Title';
        }
        // Level 4: title matches exactly
        else if (isDefined(searchTitle) && candidate.title === searchTitle) {
            matchLevel = 4;
            matchReason = 'Match: Title';
        }
        // Level 3: displayTitle matches exactly
        else if (isDefined(searchDisplayTitle) && candidate.displayTitle === searchDisplayTitle) {
            matchLevel = 3;
            matchReason = 'Match: Display Title';
        }
        // Level 2: language matches
        else if (isDefined(searchLanguage) && candidate.language === searchLanguage) {
            matchLevel = 2;
            matchReason = 'Match: Language';
        }
        // Level 1: languageCode matches
        else if (isDefined(searchCode) && candidate.languageCode === searchCode) {
            matchLevel = 1;
            matchReason = 'Match: Language Code';
        }

        if (matchLevel > 0 && matchReason) {
            potentialMatches.push({ stream: candidate, level: matchLevel, reason: matchReason });
        }
    }

    if (potentialMatches.length === 0) return null;

    // Return the match with the highest level (most specific match)
    const bestMatch = potentialMatches.reduce((best, current) =>
        current.level > best.level ? current : best
    );

    return {
        stream: bestMatch.stream,
        matchLevel: bestMatch.level,
        matchReason: bestMatch.reason
    };
};
