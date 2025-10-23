import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { saveTokens } from "./refreshtoken.js"; // Import helper

// --- Robust path for .env file ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = 3000;

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/auth/callback";

// --- Step 1: Redirect user to Twitch for authorization ---
app.get("/auth/twitch", (req, res) => {
  console.log("Redirecting to Twitch for authorization...");
  const scopes = ["moderator:read:followers", "channel:read:subscriptions"];
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
    REDIRECT_URI
  )}&response_type=code&scope=${scopes.join("+")}`;
  res.redirect(authUrl);
});

// --- Step 2: Handle the callback from Twitch ---
app.get("/auth/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send("[ERROR] No authorization code provided.");
  }
  console.log("Received authorization code, exchanging for token...");

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("[ERROR] Missing CLIENT_ID or CLIENT_SECRET in .env file");
    return res.status(500).send("Server configuration error.");
  }

  try {
    const tokenResponse = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${JSON.stringify(tokenData)}`);
    }

    saveTokens(tokenData); // Use the imported helper function
    res.send(
      `<h2>Success!</h2><p>Tokens have been saved. You may now start your alerts script.</p>`
    );
  } catch (err) {
    console.error("[ERROR] Error exchanging code for token:", err);
    res.status(500).send("[ERROR] Error getting the token. Check the server console.");
  }
});

app.listen(PORT, () => {
  console.log(`Authentication server running on http://localhost:${PORT}`);
  console.log(`Go to [ http://localhost:3000/auth/twitch ] to get your token.`);
});
