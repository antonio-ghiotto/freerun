// Common types for the multi-provider hiking search system.

export type Activity =
  | "hiking"
  | "trail"
  | "mtb"
  | "gravel"
  | "walking"
  | "running"
  | "cycling"
  | "skiing"
  | "other";

export type Difficulty = "easy" | "moderate" | "hard" | "expert" | "unknown";

export interface GeoLocation {
  lat: number;
  lon: number;
  name?: string;
}

export interface BoundingBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

/** Common search result across all providers. */
export interface TrackResult {
  id: string; // provider-scoped unique id (usually `${providerId}:${remoteId}`)
  provider: string; // provider id
  providerLabel: string; // human-readable provider name
  remoteId: string; // provider-native id
  title: string;
  description?: string;
  distance?: number; // meters
  elevationGain?: number; // meters
  estimatedTime?: number; // seconds
  difficulty?: Difficulty;
  activity?: Activity;
  thumbnail?: string;
  location?: GeoLocation;
  boundingBox?: BoundingBox;
  gpxUrl?: string;
  detailsUrl?: string;
  rating?: number; // 0..5
  downloads?: number;
}

export interface SearchByLocationParams {
  location: GeoLocation;
  radiusKm: number;
  activity?: Activity;
  limit?: number;
  signal?: AbortSignal;
}

export interface SearchNearbyParams {
  center: GeoLocation;
  radiusKm: number;
  activity?: Activity;
  limit?: number;
  signal?: AbortSignal;
}

export interface TrackProvider {
  id: string;
  name: string;
  enabled: boolean;
  /** True when the provider is a real network source; false for stubs requiring keys. */
  available: boolean;
  /** Optional note explaining why the provider is unavailable (e.g. missing API key). */
  unavailableReason?: string;

  searchByLocation(params: SearchByLocationParams): Promise<TrackResult[]>;
  searchNearby(params: SearchNearbyParams): Promise<TrackResult[]>;
  /** Return raw GPX xml text for the given result. */
  downloadTrack(result: TrackResult, signal?: AbortSignal): Promise<string>;
  /** Optional enrichment (bbox, gain, description). Default: return unchanged. */
  getTrackDetails?(result: TrackResult, signal?: AbortSignal): Promise<TrackResult>;
}

export type SortKey =
  | "relevance"
  | "distance"
  | "elevation"
  | "duration"
  | "length"
  | "popularity"
  | "rating"
  | "proximity"
  | "provider"
  | "name";

export interface ResultFilters {
  activities?: Activity[];
  difficulty?: Difficulty[];
  minDistance?: number; // km
  maxDistance?: number; // km
  minElevation?: number; // m
  maxElevation?: number; // m
  minDuration?: number; // hours
  maxDuration?: number; // hours
  providers?: string[]; // provider ids
  minRating?: number;
}
