export type LayerKey = "osm" | "otm" | "cyclosm" | "sat";

export const LAYER_LABELS: Record<LayerKey, string> = {
  osm: "OpenStreetMap",
  otm: "OpenTopoMap",
  cyclosm: "CyclOSM (escursionistica)",
  sat: "Satellite (Esri)",
};
