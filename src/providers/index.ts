import { WaymarkedTrailsProvider } from "./WaymarkedTrailsProvider";
import { OverpassProvider } from "./OverpassProvider";
import { LocalFolderProvider } from "./LocalFolderProvider";
import {
  KomootStubProvider,
  OpenRunnerStubProvider,
  OutdoorActiveStubProvider,
  WikilocStubProvider,
} from "./stubs";
import { ProviderManager } from "./ProviderManager";

/** Singleton manager: all providers ship active-by-default except stubs and LocalFolder. */
export const providerManager = new ProviderManager([
  new WaymarkedTrailsProvider(),
  new OverpassProvider(),
  new LocalFolderProvider(),
  KomootStubProvider,
  WikilocStubProvider,
  OutdoorActiveStubProvider,
  OpenRunnerStubProvider,
]);

export { ProviderManager } from "./ProviderManager";
export * from "./types";
