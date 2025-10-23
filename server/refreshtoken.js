import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// --- Robust path for .env file ---
// This assumes your .env file is one directory up (e.g., in the project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const TOKEN_PATH = path.resolve(__dirname, "./tokens.json");

// Helper function to read tokens
export function getTokens() {
  if (!fs.existsSync(TOKEN_PATH)) return null;
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf-8"));
  return tokens;
}

// Helper function to save tokens
export function saveTokens(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log("✅ Tokens saved successfully.");
}

// --- Exported function to refresh the token ---
export async function refreshToken() {
  console.log("Attempting to refresh token...");
  const currentTokens = getTokens();
  if (!currentTokens) throw new Error("No tokens file found.");

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("[ERROR] Missing CLIENT_ID or CLIENT_SECRET in .env file");
    throw new Error("[ERROR] Missing client credentials");
  }
 
  try {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: currentTokens.refresh_token,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
      }),
    });

    const newTokens = await response.json();
    if (!response.ok) {
      throw new Error(`[ERROR] Refresh failed: ${JSON.stringify(newTokens)}`);
    }

    // The refresh token might not always be returned, so merge them
    const updatedTokens = { ...currentTokens, ...newTokens };
    saveTokens(updatedTokens);
    return updatedTokens.access_token;
  } catch (err) {
    console.error("[ERROR] Could not refresh token:", err);
    throw err; // Rethrow to be handled by the caller
  }
}
