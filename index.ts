import { definePluginEntry, type OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { registerCli } from "./src/cli.js";
import { ConfigSchema, resolveConfig } from "./src/config.js";
import { registerHooks } from "./src/hooks.js";
import { WorldscribeRuntime } from "./src/service.js";
import { registerTools } from "./src/tools/register.js";
import { registerSourceArchive } from "./src/source-archive.js";

export default definePluginEntry({
  id: "worldscribe",
  name: "Worldscribe",
  description: "Structured long-document memory: timeline, entities, states, storylines and mental states over books, documents and your daily conversations.",
  configSchema: ConfigSchema as never,
  register(api: OpenClawPluginApi) {
    if ((api.pluginConfig as { sourceArchive?: boolean })?.sourceArchive === true) {
      registerSourceArchive(api);
      return;
    }
    let rt: WorldscribeRuntime;
    try {
      rt = new WorldscribeRuntime(resolveConfig(api.pluginConfig), api.logger);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      api.registerService({ id: "worldscribe", start: () => api.logger.warn(`worldscribe: disabled until configured (${message})`) });
      return;
    }
    registerTools(api, {
      cfg: rt.cfg,
      client: () => rt.client,
      backendError: () => rt.backendError,
      schemas: () => rt.schemas,
      logger: api.logger,
    });
    registerHooks(api, { cfg: rt.cfg, onActivity: (at) => rt.diary.noteActivity(at), hint: rt.hint });
    registerCli(api, rt);
    api.registerService({
      id: "worldscribe",
      start: () => rt.start(),
      stop: () => rt.stop(),
    });
  },
});
