export type MatchReason =
    | 'Exact Match (All Properties)'
    | 'Match: Title + Display Title + Codec'
    | 'Match: Title + Display Title'
    | 'Match: Title'
    | 'Match: Display Title'
    | 'Match: Language'
    | 'Match: Language Code'
    | 'Exact Selection';

export type SkipReason =
    | 'NoMatch'
    | 'AlreadyMatched'
    | 'KeywordFiltered'
    | 'Error';

export interface EpisodeResult {
    episodeTitle: string;
    seasonNumber?: number;
    episodeNumber?: number;
    success: boolean;
    matchReason?: MatchReason;
    skipReason?: SkipReason;
    errorMessage?: string;
    streamName?: string; // The name of the stream that was applied
}

export interface DetailedProgressState {
    total: number;
    current: number;
    success: number;
    failed: number;
    isProcessing: boolean;
    statusMessage: string;
    results: EpisodeResult[];
    itemType?: 'movie' | 'episode';
}
