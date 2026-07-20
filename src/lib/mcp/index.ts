import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listSyncRunsTool from "./tools/list-sync-runs";
import getSyncConfigTool from "./tools/get-sync-config";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "cataloggenerator-mcp",
  title: "Catalog Generator MCP",
  version: "0.1.0",
  instructions:
    "Tools to inspect the catalog sync pipeline for this app. Use `list_sync_runs` to see recent runs and `get_sync_config` to read the current sync configuration. All tools act as the signed-in app user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listSyncRunsTool, getSyncConfigTool],
});
