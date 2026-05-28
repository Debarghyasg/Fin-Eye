/**
 * Barrel export for the Fin-Sight API client modules.
 *
 * Page code typically imports either through this barrel or directly from
 * a sub-module:
 *
 *     import { IS_LIVE_API, listDocuments } from "@/lib/api";
 *     import { submitQuery } from "@/lib/api/queries";
 */
export * from "./client";
export * from "./alerts";
export * from "./analytics";
export * from "./audit";
export * from "./auth";
export * from "./comparisons";
export * from "./documents";
export * from "./queries";
