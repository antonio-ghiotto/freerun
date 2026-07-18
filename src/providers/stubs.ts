// Stub providers for commercial services that require API keys the user hasn't
// configured. They surface in the UI as disabled with a clear message.
import type { TrackProvider, TrackResult } from "./types";

function unavailable(reason: string) {
  return async (): Promise<TrackResult[]> => {
    throw new Error(reason);
  };
}

function stub(id: string, name: string, reason: string): TrackProvider {
  const err = unavailable(reason);
  return {
    id,
    name,
    enabled: false,
    available: false,
    unavailableReason: reason,
    searchByLocation: err,
    searchNearby: err,
    async downloadTrack() {
      throw new Error(reason);
    },
  };
}

export const KomootStubProvider = stub(
  "komoot",
  "Komoot",
  "Richiede una chiave API Komoot. Configurala nelle impostazioni per abilitare la ricerca.",
);

export const WikilocStubProvider = stub(
  "wikiloc",
  "Wikiloc",
  "Richiede una chiave API Wikiloc. Non disponibile pubblicamente senza account partner.",
);

export const OutdoorActiveStubProvider = stub(
  "outdooractive",
  "Outdooractive",
  "Richiede una chiave API Outdooractive.",
);

export const OpenRunnerStubProvider = stub(
  "openrunner",
  "OpenRunner",
  "Richiede una chiave API OpenRunner.",
);
