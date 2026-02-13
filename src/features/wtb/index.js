import { Events } from "discord.js";
import { postWtbEmbedToChannel } from "./postEmbed.js";
import { registerSinglePairModal } from "./singlePairModal.js";
import { registerCsvDropHandler } from "./csvDrop.js";
import { registerMemberWtbQuickDealCreate } from "./quickDealCreate.js"; // your existing endpoint
import { registerMemberWtbClaimFlow } from "./memberWtbClaimFlow.js";    // ✅ NEW

export function registerWtbFeature(client, app) {
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await postWtbEmbedToChannel(client);
  });

  registerSinglePairModal(client);
  registerCsvDropHandler(client);

  // ✅ API endpoint that Make calls to post listing embeds
  if (app) registerMemberWtbQuickDealCreate(app, client);

  // ✅ Claim flow (buttons/modals/channels/photos/admin confirm)
  registerMemberWtbClaimFlow(client);
}
