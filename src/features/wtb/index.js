import { Events } from "discord.js";
import { postWtbEmbedToChannel } from "./postEmbed.js";
import { registerSinglePairModal } from "./singlePairModal.js";
import { registerCsvDropHandler } from "./csvDrop.js";
import { registerMemberWtbQuickDealCreate } from "./quickDealsApi.js"; // ✅ NEW

export function registerWtbFeature(client, app) {
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await postWtbEmbedToChannel(client);
  });

  registerSinglePairModal(client);
  registerCsvDropHandler(client);

  // ✅ NEW: Airtable → Discord posting endpoint
  // This lets Airtable call your Render URL and the bot posts the Quick Deal embed.
  if (app) {
    registerMemberWtbQuickDealCreate(app, client);
  }
}
