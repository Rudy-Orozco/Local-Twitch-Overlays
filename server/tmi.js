import tmi from "tmi.js";
import fs from "fs";

const tokens = JSON.parse(fs.readFileSync("./tokens.json", "utf8"));
const ACCESS_TOKEN = tokens.access_token;
const CHANNEL_NAME = "your_channel_name"; // broadcaster’s channel

const client = new tmi.Client({
  options: { debug: true },
  identity: {
    username: CHANNEL_NAME,
    password: `oauth:${ACCESS_TOKEN}`,
  },
  channels: [CHANNEL_NAME],
});

client.connect();

client.on("message", (channel, tags, message, self) => {
  if (self) return; // Ignore messages from the bot itself
  console.log(`[${tags['display-name']}] ${message}`);
});
