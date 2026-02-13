import { Events } from "discord.js";
import { postWtbEmbedToChannel } from "./postEmbed.js";
import { registerSinglePairModal } from "./singlePairModal.js";
import { registerCsvDropHandler } from "./csvDrop.js";
import { registerMemberWtbQuickDealCreate } from "./quickDealCreate.js";
import { registerMemberWtbClaimFlow } from "./memberWtbClaimFlow.js"; // ✅ ADD

export function registerWtbFeature(client, app) {
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await postWtbEmbedToChannel(client);
  });

  registerSinglePairModal(client);
  registerCsvDropHandler(client);

  // Listing create endpoint
  if (app) {
    registerMemberWtbQuickDealCreate(app, client);
  }

  // ✅ Claim flow (buttons/modals/messages)
  registerMemberWtbClaimFlow(client);
}
