import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// --- Setup .env path (assuming this file is in a 'scripts' folder) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });

// --- Load Credentials ---
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Error: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set in your .env file."
  );
  process.exit(1);
}

/**
 * Gets a server-to-server App Access Token.
 */
async function getAppAccessToken() {
  console.log("Requesting App Access Token...");
  try {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get token: ${response.status}`);
    }
    const data = await response.json();
    return data.access_token;
  } catch (err) {
    console.error("❌ Error getting App Access Token:", err.message);
    return null;
  }
}

/**
 * Fetches a list of all active EventSub subscriptions.
 */
async function listSubscriptions(token) {
  console.log("Fetching all active subscriptions...");
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
    if (!response.ok) {
      throw new Error(`Failed to list subs: ${response.status}`);
    }
    const data = await response.json();
    return data.data;
  } catch (err) {
    console.error("❌ Error listing subscriptions:", err.message);
    return null;
  }
}

/**
 * Deletes a specific EventSub subscription by its ID.
 */
async function deleteSubscription(token, id) {
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
      console.log(`✅ Successfully deleted subscription: ${id}`);
    } else {
      console.warn(`⚠️ Failed to delete ${id}. Status: ${response.status}`);
    }
  } catch (err) {
    console.error(`❌ Network error deleting ${id}:`, err.message);
  }
}

/**
 * Main function to run the cleanup process.
 */
async function cleanupAllSubscriptions() {
  console.log("--- Starting Subscription Cleanup ---");
  
  // 1. Get Token
  const token = await getAppAccessToken();
  if (!token) {
    console.error("Cleanup failed: Could not get App Access Token.");
    return;
  }
  console.log("✅ App Access Token obtained.");

  // 2. Get Subscriptions
  const subscriptions = await listSubscriptions(token);
  if (!subscriptions) {
    console.error("Cleanup failed: Could not retrieve subscription list.");
    return;
  }

  if (subscriptions.length === 0) {
    console.log("✨ No active subscriptions found. All clean!");
    return;
  }

  console.log(
    `Found ${subscriptions.length} active subscriptions. Deleting them now...`
  );

  // 3. Delete All Subscriptions
  const deletePromises = subscriptions.map((sub) =>
    deleteSubscription(token, sub.id)
  );

  await Promise.all(deletePromises);

  console.log("--- ✅ Cleanup Complete ---");
}

// --- Run the script ---
cleanupAllSubscriptions();
