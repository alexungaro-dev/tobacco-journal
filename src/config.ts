export const APP_NAME = "Tobacco Journal";
export const APP_MONOGRAM = "TJ";
export const MODULES = [
  "dashboard",
  "pipes",
  "tobaccos",
  "cigars",
  "diary",
] as const;
export type Module = (typeof MODULES)[number];
