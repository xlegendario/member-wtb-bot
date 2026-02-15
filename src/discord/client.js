import { Client, GatewayIntentBits, Partials } from "discord.js";

export function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,  // ✅ needed to reliably receive msg payloads + attachments
      GatewayIntentBits.DirectMessages   // ✅ REQUIRED to receive DM messages (PDF upload)
    ],
    partials: [
      Partials.Channel, // ✅ REQUIRED for DMs (DM channel is partial unless cached)
      Partials.Message,
      Partials.User
    ]
  });

  // ✅ DM debug (remove later if you want)
  client.on("messageCreate", (m) => {
    if (!m.inGuild()) {
      console.log("[DM MESSAGE RECEIVED]", {
        authorId: m.author?.id,
        attachments: m.attachments?.size || 0,
        hasContent: !!m.content
      });
    }
  });

  return client;
}
