import WebSocket from "ws";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

// --- Import the refreshToken function correctly ---
import { refreshToken } from "../server/server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TOKEN_PATH = path.resolve(__dirname, "../server/tokens.json");
const ENV_PATH = path.resolve(__dirname, "../.env");

// Load .env variables for Client ID
import dotenv from "dotenv";
dotenv.config({ path: ENV_PATH });
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;

let keepaliveTimeout;

async function getUserId(accessToken) {
  try {
    const response = await fetch("https://api.twitch.tv/helix/users", {
      headers: {
        "Client-ID": CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const data = await response.json();
    if (!data.data || data.data.length === 0) {
      throw new Error("User not found with the provided access token.");
    }
    return data.data[0].id;
  } catch (err) {
    console.error("❌ Error fetching user ID:", err.message);
    console.log("Refreshing token due to user fetch error...");
    const newAccessToken = await refreshToken();
    return getUserId(newAccessToken); // Retry with the new token
  }
}

function connectToTwitch() {
  const ws = new WebSocket("wss://eventsub.wss.twitch.tv/ws");

  ws.on("open", () => {
    console.log("✅ WebSocket connection established.");
  });

  ws.on("message", async (message) => {
    const data = JSON.parse(message.toString());
    const messageType = data.metadata.message_type;
    
    // Reset keepalive timer on any message from Twitch
    clearTimeout(keepaliveTimeout);
    if(data.payload.session) {
      const timeout = data.payload.session.keepalive_timeout_seconds;
      keepaliveTimeout = setTimeout(() => {
        console.warn("⏰ Keepalive timeout! No message received from Twitch. Reconnecting...");
        ws.terminate();
      }, (timeout + 2) * 1000);
    }

    switch (messageType) {
      case "session_welcome":
        console.log("🎉 Received session_welcome. Subscribing via HTTP API...");
        const sessionId = data.payload.session.id;
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
        const accessToken = tokens.access_token;
        const userId = await getUserId(accessToken);
        console.log(`Authenticated as user ID: ${userId}`);
        
        // Subscribe to events using the correct HTTP method
        await subscribeToEvent(accessToken, "channel.follow", "2", { broadcaster_user_id: userId, moderator_user_id: userId }, sessionId);
        await subscribeToEvent(accessToken, "channel.subscribe", "1", { broadcaster_user_id: userId }, sessionId);
        break;

      case "session_keepalive":
        console.log("💓 Keepalive received. Connection is healthy.");
        break;

      case "notification":
        console.log("🔥 Event Received! 🔥");
        console.log(JSON.stringify(data.payload.event, null, 2));
        break;
      
      case "session_reconnect":
        console.log("🔄 Twitch requested a reconnect. Closing and reconnecting...");
        ws.terminate();
        break;

      default:
        console.log(`Received unknown message type: ${messageType}`);
        console.log(JSON.stringify(data, null, 2));
    }
  });

  ws.on("close", (code) => {
    clearTimeout(keepaliveTimeout);
    console.warn(`⚠️ WebSocket closed with code ${code}. Reconnecting in 5 seconds...`);
    setTimeout(connectToTwitch, 5000);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });
}

// --- THIS FUNCTION IS REWRITTEN TO USE THE HTTP API ---
async function subscribeToEvent(accessToken, type, version, condition, sessionId) {
  const body = {
    type,
    version,
    condition,
    transport: {
      method: "websocket",
      session_id: sessionId,
    },
  };

  try {
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
      method: "POST",
      headers: {
        "Client-ID": CLIENT_ID,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 202) {
      console.log(`✅ Successfully subscribed to ${type} (v${version})`);
    } else {
      const errorData = await response.json();
      console.error(`❌ Failed to subscribe to ${type}. Status: ${response.status}`, errorData);
    }
  } catch (error) {
    console.error(`❌ Network error while subscribing to ${type}:`, error);
  }
}

// --- Start the client ---
if (!fs.existsSync(TOKEN_PATH)) {
  console.error("❌ tokens.json not found! Please run the server and authenticate first.");
} else {
  connectToTwitch();
}