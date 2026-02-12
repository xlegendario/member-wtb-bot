import { startHealthServer } from "./src/web/health.js";
import { createDiscordClient } from "./src/discord/client.js";
import { registerWtbFeature } from "./src/features/wtb/index.js";

startHealthServer();

const client = createDiscordClient();
registerWtbFeature(client);

client.login(process.env.DISCORD_BOT_TOKEN);
