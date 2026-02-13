import { startHealthServer } from "./src/web/health.js";
import { createDiscordClient } from "./src/discord/client.js";
import { registerWtbFeature } from "./src/features/wtb/index.js";

// ✅ IMPORTANT: startHealthServer must return the express app
const app = startHealthServer();

const client = createDiscordClient();

// ✅ pass app so the feature can register webhook endpoints
registerWtbFeature(client, app);

client.login(process.env.DISCORD_BOT_TOKEN);
