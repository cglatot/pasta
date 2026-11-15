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
    previousStreamName?: string; // The name of the stream that was selected before processing
    updatedUsersCount?: number; // Present when updating across multiple users in Server Mode
    totalUsersCount?: number; // Total target users evaluated for this item in Server Mode
}

export interface QueuedBatchJobSummary {
    jobId: string;
    scope: 'season' | 'show' | 'collection' | 'library';
    targetTitle: string;
    streamType: 'audio' | 'subtitle';
    streamName: string;
    targetUsersSummary: string;
    initiatedByUsername: string;
}

export interface DetailedProgressState {
    jobId?: string;
    total: number;
    current: number;
    success: number;
    failed: number;
    isProcessing: boolean;
    statusMessage: string;
    results: EpisodeResult[];
    itemType?: 'movie' | 'episode';
    targetUsersSummary?: string;
    queuedJobs?: QueuedBatchJobSummary[];
}

export type TargetUsersMode = 'single' | 'all' | 'specific';

export interface TargetUsersSelection {
    mode: TargetUsersMode;
    userIds: number[];
    label: string;
}
