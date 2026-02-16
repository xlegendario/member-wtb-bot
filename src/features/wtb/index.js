import { Events } from "discord.js";
import { postWtbEmbedToChannel } from "./postEmbed.js";
import { registerSinglePairModal } from "./singlePairModal.js";
import { registerCsvDropHandler } from "./csvDrop.js";
import { registerMemberWtbQuickDealCreate } from "./quickDealCreate.js";
import { registerMemberWtbClaimFlow } from "./memberWtbClaimFlow.js";
import { registerMemberWtbQuickDealUpdate } from "./quickDealUpdate.js";
import { registerCancelWtbs } from "./cancelWtbs.js"; // ✅ NEW
import { registerMemberWtbGuideMessage } from "./src/features/wtb/memberWtbGuideMessage.js";

export function registerWtbFeature(client, app) {
  client.once(Events.ClientReady, async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await postWtbEmbedToChannel(client);
  });

  registerSinglePairModal(client);
  registerCsvDropHandler(client);
  registerCancelWtbs(client); // ✅ NEW
  registerMemberWtbGuideMessage(client);

  if (app) {
    registerMemberWtbQuickDealCreate(app, client);
    registerMemberWtbQuickDealUpdate(app, client);
  }

  registerMemberWtbClaimFlow(client);
}
