import type { PlexMetadata, PlexPart, PlexStream } from './types/plex.ts';
import type { MatchReason, SkipReason } from './types/batchTypes.ts';

export interface MatchResult {
    stream: PlexStream;
    matchLevel: number;
    matchReason: MatchReason;
}

export interface PartStreamUpdate {
    partId: number;
    streamId: number;
    alreadySelected: boolean;
}

export interface EpisodePartResolution {
    hasStreams: boolean;
    partUpdates: PartStreamUpdate[];
    allAlreadyMatched: boolean;
    matchReason?: MatchReason;
    skipReason?: SkipReason;
    errorMessage?: string;
    streamName?: string;
    previousStreamName?: string;
}

const DESCRIPTIVE_KEYWORDS = [
    'commentary',
    'description',
    'descriptive',
    'narration',
    'narrative',
    'described',
];

/**
 * Formats a PlexStream into PASTA's human-readable "DisplayTitle - Title" label.
 */
export const formatStreamName = (stream: PlexStream): string => {
    const displayTitle = stream.displayTitle || '';
    const title = stream.title || '';

    if (displayTitle && title && displayTitle !== title) {
        return `${displayTitle} - ${title}`;
    }
    return displayTitle || title || 'Unknown';
};

/**
 * Returns true if the stream title or displayTitle indicates a commentary track.
 */
export const isCommentaryStream = (stream: PlexStream | null | undefined): boolean => {
    if (!stream) return false;
    const text = `${stream.title || ''} ${stream.displayTitle || ''} ${stream.extendedDisplayTitle || ''}`.toLowerCase();
    return text.includes('commentary');
};

/**
 * Returns true if the stream is a commentary, audio description, or visually impaired track.
 */
export const isDescriptiveOrCommentary = (stream: PlexStream | null | undefined): boolean => {
    if (!stream) return false;
    if (stream.visualImpaired) return true;
    const text = `${stream.title || ''} ${stream.displayTitle || ''} ${stream.extendedDisplayTitle || ''}`.toLowerCase();
    if (DESCRIPTIVE_KEYWORDS.some(kw => text.includes(kw))) {
        return true;
    }
    if (stream.streamType === 2 && /\bsdh\b/i.test(text)) {
        return true;
    }
    return false;
};

const normalize = (val: unknown): string => {
    if (val === undefined || val === null || val === 'undefined') return '';
    return String(val);
};

const hasValue = (val: unknown): boolean => normalize(val) !== '';

/**
 * Computes an opportunistic tie-breaker score when multiple candidate streams achieve
 * the same primary matchLevel (1..7).
 */
const computeTieBreakScore = (
    targetStream: PlexStream,
    candidate: PlexStream,
    candidateListIndex: number
): number => {
    let score = 0;

    // 1. Commentary & Audio Description guardrail (+1000 if matching commentary/normal state)
    const targetIsDescriptive = isDescriptiveOrCommentary(targetStream);
    const candidateIsDescriptive = isDescriptiveOrCommentary(candidate);
    if (targetIsDescriptive === candidateIsDescriptive) {
        score += 1000;
    } else {
        score -= 1000;
    }

    // 2. Forced flag affinity (+200 if forced state matches)
    if (Boolean(targetStream.forced) === Boolean(candidate.forced)) {
        score += 200;
    }

    // 3. Hearing Impaired (SDH) flag affinity (+100 if hearingImpaired state matches)
    if (Boolean(targetStream.hearingImpaired) === Boolean(candidate.hearingImpaired)) {
        score += 100;
    }

    // 4. Audio channel count & layout affinity
    if (targetStream.streamType === 2) {
        if (
            targetStream.channels !== undefined &&
            candidate.channels !== undefined
        ) {
            if (targetStream.channels === candidate.channels) {
                score += 40;
            } else {
                score -= Math.min(20, Math.abs(targetStream.channels - candidate.channels) * 4);
            }
        }
        if (
            hasValue(targetStream.audioChannelLayout) &&
            normalize(targetStream.audioChannelLayout) === normalize(candidate.audioChannelLayout)
        ) {
            score += 20;
        }
    }

    // 5. Prefer earlier tracks in the candidate list when all else is equal
    score -= candidateListIndex * 0.1;

    return score;
};

/**
 * Finds the best matching stream in a list of candidates based on the target stream's properties.
 * Uses PASTA's 7-level priority matching system enhanced with opportunistic tie-breaking:
 *
 * Match Priority (highest to lowest):
 * 7. Everything matches (title + displayTitle + language + languageCode + codec)
 * 6. title + displayTitle + codec match
 * 5. title + displayTitle match
 * 4. title matches (exact)
 * 3. displayTitle matches (exact)
 * 2. language matches
 * 1. languageCode matches
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
    const targetHasLanguage = hasValue(searchLanguage) || hasValue(searchCode);
    const targetIsDescriptive = isDescriptiveOrCommentary(targetStream);

    interface Match {
        stream: PlexStream;
        level: number;
        tieBreakScore: number;
        reason: MatchReason;
    }

    const potentialMatches: Match[] = [];

    for (let idx = 0; idx < candidates.length; idx++) {
        const candidate = candidates[idx];
        let matchLevel = 0;
        let matchReason: MatchReason | null = null;

        // Guardrail: If reference track is normal dialogue (not commentary/descriptive) and
        // no explicit keyword was supplied, do not match a commentary/descriptive track via
        // language-only fallback if a normal dialogue track in that language exists.
        const candidateIsDescriptive = isDescriptiveOrCommentary(candidate);

        // Exact equality (empty == empty), used only for the "everything matches" level
        const titleEqual = normalize(candidate.title) === normalize(searchTitle);
        const displayTitleEqual = normalize(candidate.displayTitle) === normalize(searchDisplayTitle);
        const languageEqual = normalize(candidate.language) === normalize(searchLanguage);
        const codeEqual = normalize(candidate.languageCode) === normalize(searchCode);
        const codecMatch = normalize(candidate.codec) === normalize(searchCodec);

        // Meaningful matches: the target must actually have a value for the property
        const titleMatch = hasValue(searchTitle) && titleEqual;
        const displayTitleMatch = hasValue(searchDisplayTitle) && displayTitleEqual;
        const languageMatch = hasValue(searchLanguage) && languageEqual;
        const codeMatch = hasValue(searchCode) && codeEqual;
        const sameLanguage = !targetHasLanguage || languageMatch || codeMatch;

        // Level 7: Everything matches (including codec)
        if (titleEqual && displayTitleEqual && languageEqual && codeEqual && codecMatch && (!candidateIsDescriptive || targetIsDescriptive)) {
            matchLevel = 7;
            matchReason = 'Exact Match (All Properties)';
        }
        // Level 6: title + displayTitle + codec match
        else if (titleMatch && displayTitleMatch && codecMatch && sameLanguage) {
            matchLevel = 6;
            matchReason = 'Match: Title + Display Title + Codec';
        }
        // Level 5: title + displayTitle match
        else if (titleMatch && displayTitleMatch && sameLanguage) {
            matchLevel = 5;
            matchReason = 'Match: Title + Display Title';
        }
        // Level 4: title matches exactly
        else if (titleMatch && sameLanguage) {
            matchLevel = 4;
            matchReason = 'Match: Title';
        }
        // Level 3: displayTitle matches exactly
        else if (displayTitleMatch && sameLanguage) {
            matchLevel = 3;
            matchReason = 'Match: Display Title';
        }
        // Level 2: language matches
        else if (languageMatch) {
            matchLevel = 2;
            matchReason = 'Match: Language';
        }
        // Level 1: languageCode matches
        else if (codeMatch) {
            matchLevel = 1;
            matchReason = 'Match: Language Code';
        }

        if (matchLevel > 0 && matchReason) {
            potentialMatches.push({
                stream: candidate,
                level: matchLevel,
                tieBreakScore: computeTieBreakScore(targetStream, candidate, idx),
                reason: matchReason,
            });
        }
    }

    if (potentialMatches.length === 0) return null;

    // If the reference stream is NOT descriptive/commentary and no explicit keyword was provided,
    // filter out descriptive/commentary candidates unless ALL matching candidates are descriptive.
    let filteredMatches = potentialMatches;
    if (!targetIsDescriptive && (!keyword || keyword.trim() === '')) {
        const nonDescriptive = potentialMatches.filter(m => !isDescriptiveOrCommentary(m.stream));
        if (nonDescriptive.length > 0) {
            filteredMatches = nonDescriptive;
        }
    }

    // Return the match with the highest level, breaking ties with tieBreakScore
    const bestMatch = filteredMatches.reduce((best, current) => {
        if (current.level !== best.level) {
            return current.level > best.level ? current : best;
        }
        return current.tieBreakScore > best.tieBreakScore ? current : best;
    });

    return {
        stream: bestMatch.stream,
        matchLevel: bestMatch.level,
        matchReason: bestMatch.reason,
    };
};

/**
 * Forced subtitle matching helper:
 * When the reference subtitle selection is None (0), checks if the candidate streams contain a
 * forced subtitle track matching the selected audio track's language.
 */
export const findForcedSubtitleForAudioLanguage = (
    selectedAudioStream: PlexStream | null | undefined,
    candidateStreams: PlexStream[]
): MatchResult | null => {
    if (!selectedAudioStream || !candidateStreams || candidateStreams.length === 0) {
        return null;
    }

    const audioLang = normalize(selectedAudioStream.language);
    const audioCode = normalize(selectedAudioStream.languageCode);
    if (!audioLang && !audioCode) return null;

    const forcedSubtitles = candidateStreams.filter(
        s => s.streamType === 3 && Boolean(s.forced) && !isDescriptiveOrCommentary(s)
    );

    for (const sub of forcedSubtitles) {
        if (audioLang && normalize(sub.language) === audioLang) {
            return {
                stream: sub,
                matchLevel: 2,
                matchReason: 'Match: Language',
            };
        }
        if (audioCode && normalize(sub.languageCode) === audioCode) {
            return {
                stream: sub,
                matchLevel: 1,
                matchReason: 'Match: Language Code',
            };
        }
    }

    return null;
};

/**
 * Collects all PlexPart entries across all Media versions (e.g. 4K + 1080p) and multi-part files.
 */
export const getAllMediaParts = (item: PlexMetadata): PlexPart[] => {
    const parts: PlexPart[] = [];
    if (!item.Media) return parts;
    for (const media of item.Media) {
        if (media.Part) {
            for (const part of media.Part) {
                if (part && Array.isArray(part.Stream)) {
                    parts.push(part);
                }
            }
        }
    }
    return parts;
};

/**
 * Resolves the target stream IDs across ALL Media[] versions and Part[] entries on an episode or movie.
 * Used by both ClientStandaloneProvider (pastatool.com) and ServerModeProvider (updater.ts).
 */
export const resolveEpisodePartUpdates = (
    episode: PlexMetadata,
    targetStream: PlexStream | null,
    type: 'audio' | 'subtitle',
    options?: {
        keyword?: string;
        exactMatch?: boolean;
    }
): EpisodePartResolution => {
    const parts = getAllMediaParts(episode);
    if (parts.length === 0) {
        return {
            hasStreams: false,
            partUpdates: [],
            allAlreadyMatched: false,
            skipReason: 'Error',
            errorMessage: 'No streams available',
        };
    }

    const primaryPart = parts[0];
    const currentStream = primaryPart.Stream.find(
        s => s.streamType === (type === 'audio' ? 2 : 3) && s.selected
    );
    const previousStreamName = currentStream
        ? formatStreamName(currentStream)
        : (type === 'subtitle' ? 'None' : undefined);

    if (targetStream === null && type === 'audio') {
        return {
            hasStreams: true,
            partUpdates: [],
            allAlreadyMatched: false,
            skipReason: 'Error',
            errorMessage: 'Cannot set audio to None',
            previousStreamName,
        };
    }

    const partUpdates: PartStreamUpdate[] = [];
    let primaryMatchReason: MatchReason | undefined;
    let primaryStreamName: string | undefined;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];

        if (targetStream === null) {
            // Setting subtitles to None (0)
            const anySubtitleSelected = part.Stream.some(s => s.streamType === 3 && s.selected);
            partUpdates.push({
                partId: part.id,
                streamId: 0,
                alreadySelected: !anySubtitleSelected,
            });
            if (i === 0) {
                primaryStreamName = 'None';
                primaryMatchReason = 'Exact Match (All Properties)';
            }
            continue;
        }

        if (options?.exactMatch) {
            const exactStream = part.Stream.find(s => s.id === targetStream.id);
            if (exactStream) {
                partUpdates.push({
                    partId: part.id,
                    streamId: exactStream.id,
                    alreadySelected: Boolean(exactStream.selected),
                });
                if (i === 0) {
                    primaryMatchReason = 'Exact Selection';
                    primaryStreamName = formatStreamName(exactStream);
                }
            } else if (i > 0) {
                // Secondary Media version (e.g. 1080p alongside 4K): match opportunistically using targetStream
                const secondaryMatch = findMatchingStream(targetStream, part.Stream, options?.keyword);
                if (secondaryMatch) {
                    partUpdates.push({
                        partId: part.id,
                        streamId: secondaryMatch.stream.id,
                        alreadySelected: Boolean(secondaryMatch.stream.selected),
                    });
                }
            } else {
                return {
                    hasStreams: true,
                    partUpdates: [],
                    allAlreadyMatched: false,
                    skipReason: 'Error',
                    errorMessage: 'Target stream not found in episode',
                    previousStreamName,
                };
            }
        } else {
            const matchResult = findMatchingStream(targetStream, part.Stream, options?.keyword);
            if (matchResult) {
                partUpdates.push({
                    partId: part.id,
                    streamId: matchResult.stream.id,
                    alreadySelected: Boolean(matchResult.stream.selected),
                });
                if (!primaryMatchReason) {
                    primaryMatchReason = matchResult.matchReason;
                    primaryStreamName = formatStreamName(matchResult.stream);
                }
            }
        }
    }

    if (partUpdates.length === 0) {
        const skipReason: SkipReason = options?.keyword ? 'KeywordFiltered' : 'NoMatch';
        return {
            hasStreams: true,
            partUpdates: [],
            allAlreadyMatched: false,
            skipReason,
            previousStreamName,
        };
    }

    const allAlreadyMatched = partUpdates.every(u => u.alreadySelected);
    if (allAlreadyMatched) {
        return {
            hasStreams: true,
            partUpdates,
            allAlreadyMatched: true,
            skipReason: 'AlreadyMatched',
            matchReason: primaryMatchReason,
            streamName: primaryStreamName,
            previousStreamName,
        };
    }

    return {
        hasStreams: true,
        partUpdates,
        allAlreadyMatched: false,
        matchReason: primaryMatchReason,
        streamName: primaryStreamName,
        previousStreamName,
    };
};
