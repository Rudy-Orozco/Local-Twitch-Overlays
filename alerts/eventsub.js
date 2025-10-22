import WebSocket from "ws";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline"; // Import readline for terminal input

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
let twitchSocket; // Make WebSocket instance global to be accessible by shutdown
let userAccessToken; // Store the User Access Token for cleanup

// --- Helper Functions for cleanup ---

/**
 * Deletes a specific EventSub subscription by its ID and type.
 * USES THE USER ACCESS TOKEN.
 */
async function deleteSubscription(token, id, type) {
  try {
    const response = await fetch(
      `https://api.twitch.tv/helix/eventsub/subscriptions?id=${id}`,
      {
        method: "DELETE",
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (response.status === 204) {
      console.log(`   ✅ Successfully deleted subscription: ${type} (${id})`);
    } else {
      console.warn(
        `   ⚠️ Failed to delete ${type} (${id}). Status: ${response.status}`
      );
    }
  } catch (err) {
    console.error(`   ❌ Network error deleting ${type} (${id}):`, err.message);
  }
}

/**
 * Fetches a list of all active EventSub subscriptions.
 * USES THE USER ACCESS TOKEN.
 */
async function listSubscriptions(token) {
  console.log("Fetching all active subscriptions for cleanup...");
  try {
    const response = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (!response.ok)
      throw new Error(`Failed to list subs: ${response.status}`);
    const data = await response.json();
    return data.data; // This is an array of subscription objects
  } catch (err) {
    console.error("❌ Error listing subscriptions:", err.message);
    return null;
  }
}

// --- Main WebSocket Logic ---

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
  // Assign to the global variable
  twitchSocket = new WebSocket("wss://eventsub.wss.twitch.tv/ws");

  twitchSocket.on("open", () => {
    console.log("✅ WebSocket connection established.");
  });

  twitchSocket.on("message", async (message) => {
    const data = JSON.parse(message.toString());
    const messageType = data.metadata.message_type;

    // Reset keepalive timer on any message from Twitch
    clearTimeout(keepaliveTimeout);
    if (data.payload.session) {
      const timeout = data.payload.session.keepalive_timeout_seconds;
      keepaliveTimeout = setTimeout(() => {
        console.warn(
          "⏰ Keepalive timeout! No message received from Twitch. Reconnecting..."
        );
        twitchSocket.terminate();
      }, (timeout + 2) * 1000);
    }

    switch (messageType) {
      case "session_welcome":
        console.log("🎉 Received session_welcome. Subscribing via HTTP API...");
        const sessionId = data.payload.session.id;
        const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
        userAccessToken = tokens.access_token; // Store the token globally for cleanup
        const userId = await getUserId(userAccessToken);
        console.log(`Authenticated as user ID: ${userId}`);

        // Subscribe to events using the correct HTTP method
        await subscribeToEvent(
          userAccessToken,
          "channel.follow",
          "2",
          { broadcaster_user_id: userId, moderator_user_id: userId },
          sessionId
        );
        await subscribeToEvent(
          userAccessToken,
          "channel.subscribe",
          "1",
          { broadcaster_user_id: userId },
          sessionId
        );
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
        twitchSocket.terminate();
        break;

      default:
        console.log(`Received unknown message type: ${messageType}`);
        console.log(JSON.stringify(data, null, 2));
    }
  });

  twitchSocket.on("close", (code) => {
    clearTimeout(keepaliveTimeout);
    console.warn(
      `⚠️ WebSocket closed with code ${code}. Reconnecting in 5 seconds...`
    );
    // Don't reconnect if we are shutting down
    if (code !== 1000) {
      setTimeout(connectToTwitch, 5000);
    }
  });

  twitchSocket.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });
}

// --- HTTP Subscription Function ---
async function subscribeToEvent(
  accessToken,
  type,
  version,
  condition,
  sessionId
) {
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
    const response = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        headers: {
          "Client-ID": CLIENT_ID,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const responseData = await response.json(); // Get JSON response

    if (response.status === 202) {
      const sub = responseData.data[0];
      console.log(`✅ Successfully subscribed to ${type} (v${version})`);
      console.log(`   - ID: ${sub.id}`);
      console.log(`   - Status: ${sub.status}`);
    } else {
      console.error(
        `❌ Failed to subscribe to ${type}. Status: ${response.status}`,
        responseData // Log the full error response
      );
    }
  } catch (error) {
    console.error(`❌ Network error while subscribing to ${type}:`, error);
  }
}

// --- Graceful Shutdown Logic ---
async function shutdown() {
  console.log("\n--- Starting Graceful Shutdown ---");

  // 1. Check if we have the User Access Token
  if (!userAccessToken) {
    console.error(
      "Cleanup failed: User Access Token not available. (Session may not have started)."
    );
  } else {
    // 2. Get all subscriptions using the User Access Token
    const subscriptions = await listSubscriptions(userAccessToken);
    if (subscriptions && subscriptions.length > 0) {
      console.log(`Found ${subscriptions.length} subscriptions to delete:`);

      // 3. Delete all sequentially for clearer logging
      for (const sub of subscriptions) {
        console.log(`\nDeleting ${sub.type} (ID: ${sub.id})...`);
        await deleteSubscription(userAccessToken, sub.id, sub.type);
      }

      console.log("\n--- ✅ Subscription Cleanup Complete ---");
    } else if (subscriptions) {
      console.log("✨ No active subscriptions found to clean up.");
    }
  }

  // 4. Close WebSocket
  if (twitchSocket) {
    console.log("Closing WebSocket connection...");
    twitchSocket.close(1000, "Server shutting down");
  }

  // 5. Exit process
  console.log("Shutdown complete. Exiting.");
  process.exit(0);
}

// --- Start the client and listen for "stop" ---
if (!fs.existsSync(TOKEN_PATH)) {
  console.error(
    "❌ tokens.json not found! Please run the server and authenticate first."
  );
} else {
  // Start the WebSocket client
  connectToTwitch();

  // Start listening for terminal input
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('\nType "stop" and press Enter to gracefully shut down.\n');

  rl.on("line", (input) => {
    if (input.trim().toLowerCase() === "stop") {
      rl.close();
      shutdown();
    }
  });

  // Also trigger shutdown on Ctrl+C
  rl.on("SIGINT", () => {
    shutdown();
  });
}

