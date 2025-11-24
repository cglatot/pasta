export interface PlexResource {
  name: string;
  product: string;
  productVersion: string;
  platform: string;
  platformVersion: string;
  device: string;
  clientIdentifier: string;
  createdAt: string;
  lastSeenAt: string;
  provides: string;
  ownerId: string;
  sourceTitle: string;
  publicAddress: string;
  accessToken: string;
  owned: boolean;
  home: boolean;
  synced: boolean;
  relay: boolean;
  presence: boolean;
  httpsRequired: boolean;
  publicAddressMatches: boolean;
  dnsRebindingProtection: boolean;
  natLoopbackSupported: boolean;
  connections: PlexConnection[];
}

export interface PlexConnection {
  protocol: string;
  address: string;
  port: number;
  uri: string;
  local: boolean;
  relay: boolean;
  IPv6: boolean;
}

export interface PlexMediaContainer<T> {
  MediaContainer: {
    size: number;
    allowSync?: boolean;
    identifier?: string;
    mediaTagPrefix?: string;
    mediaTagVersion?: number;
    title1?: string;
    title2?: string;
    Directory?: T[];
    Metadata?: T[];
    thumb?: string;
  };
}

export interface PlexLibrary {
  allowSync: boolean;
  art: string;
  composite: string;
  filters: boolean;
  refreshing: boolean;
  thumb: string;
  key: string;
  type: 'movie' | 'show' | 'artist' | 'photo';
  title: string;
  agent: string;
  scanner: string;
  language: string;
  uuid: string;
  updatedAt: number;
  createdAt: number;
  scannedAt: number;
  content: boolean;
  directory: boolean;
  contentChangedAt: number;
  hidden: number;
  Location: { id: number; path: string }[];
}

export interface PlexMetadata {
  ratingKey: string;
  key: string;
  guid: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  title: string;
  titleSort?: string;
  summary?: string;
  index?: number;
  parentIndex?: number;
  year?: number;
  thumb?: string;
  art?: string;
  banner?: string;
  theme?: string;
  duration?: number;
  addedAt: number;
  updatedAt: number;
  Media?: PlexMedia[];
}

export interface PlexMedia {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  Part: PlexPart[];
}

export interface PlexPart {
  id: number;
  key: string;
  duration: number;
  file: string;
  size: number;
  container: string;
  videoProfile: string;
  Stream: PlexStream[];
}

export interface PlexStream {
  id: number;
  streamType: 1 | 2 | 3; // 1=Video, 2=Audio, 3=Subtitle
  default?: boolean;
  selected?: boolean;
  codec: string;
  index: number;
  bitrate?: number;
  language?: string;
  languageCode?: string;
  title?: string;
  displayTitle?: string;
  extendedDisplayTitle?: string;
}

export interface PlexUser {
  id: number;
  uuid: string;
  hasPassword?: boolean;
  username?: string;
  email?: string;
  thumb?: string;
  title?: string;
  home?: boolean;
  restricted?: boolean;
  status?: string;
  admin?: boolean;
  guest?: boolean;
  protected?: boolean;
}

export interface PlexHomeUser {
  id: number;
  uuid: string;
  title: string;
  username: string;
  email: string;
  thumb: string;
  protected: boolean;
  admin: boolean;
}
