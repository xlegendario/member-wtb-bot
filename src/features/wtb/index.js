import { Events } from "discord.js";
import { postWtbEmbedToChannel } from "./postEmbed.js";
import { registerSinglePairModal } from "./singlePairModal.js";
import { registerCsvDropHandler } from "./csvDrop.js";
import { registerMemberWtbQuickDealCreate } from "./quickDealCreate.js"; // ✅ CORRECT FILE

export function registerWtbFeature(client, app) {
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await postWtbEmbedToChannel(client);
  });

  registerSinglePairModal(client);
  registerCsvDropHandler(client);

  // Airtable → Discord Quick Deal posting
  if (app) {
    registerMemberWtbQuickDealCreate(app, client);
  }
}
