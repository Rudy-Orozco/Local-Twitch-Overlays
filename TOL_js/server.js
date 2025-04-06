require("dotenv").config();
const WebSocket = require("ws");
const fetch = require("node-fetch");

const PORT = process.env.PORT || 8080;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const BROADCASTER_ID = process.env.TWITCH_BROADCASTER_ID;
let TWITCH_OAUTH_TOKEN = process.env.TWITCH_OAUTH_TOKEN;    // WILL CHANGE IF OAUTH IS NOT VALID
//const REDIRECT_URI = "http://localhost:3000";
//const SCOPES = "moderator:read:followers"

let twitchSocket;
let sessionId;
let followEventID;

const clients = new Set(); // Store connected clients

// FUNCTIONS ===============================================================================

/*
async function getAccessUSERToken(authcode) { // OAUTH TOKEN
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&code=${authcode}&grant_type=authorization_code&redirect_uri=http://localhost:3000`
    });
    const data = await response.json();
    return data.access_token;
}

async function getAccessToken() { // APP TOKEN
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`
    });
    const data = await response.json();
    return data.access_token;
}
*/

async function shutdown() {
    console.log("Shutting down server...");

    await deletesubscription();

    // Close Twitch WebSocket if open
    if (twitchSocket) {
        twitchSocket.close();
    }

    // Close WebSocket server
    server.close(() => {
        console.log("Client WebSocket closed.");
    });

    // Force exit if something is stuck
    setTimeout(() => {
        console.error("Something went wrong. Forcing shutdown...");
        process.exit(1);
    }, 5000);
}

async function deletesubscription() {
    const response = await fetch(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${followEventID}`, {
        method: "DELETE",
        headers: {
            "Client-ID": `${TWITCH_CLIENT_ID}`,
            "Authorization": `Bearer ${TWITCH_OAUTH_TOKEN}`
        }
    });

    const data = await response;
    console.log(data);

    if (response.status !== 204) {
        console.error("❌ Error deleting events:", followEventID);
    } else {
        console.log("✅ Successfully deleted", followEventID);
    }
}

async function listsubscription() {
    console.log("LIST OF SUBSCRIPTIONS")
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
        method: "GET",
        headers: {
            "Client-ID": `${TWITCH_CLIENT_ID}`,
            "Authorization": `Bearer ${TWITCH_OAUTH_TOKEN}`
        }
    });
    console.log(await response.json());
}

async function subscribeToFollowers(sessionId, accessToken) {
    const response = await fetch("https://api.twitch.tv/helix/eventsub/subscriptions", {
        method: "POST",
        headers: {
            "Client-ID": TWITCH_CLIENT_ID,
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            type: "channel.follow",
            version: "2",
            condition: { 
                broadcaster_user_id: BROADCASTER_ID, 
                moderator_user_id: BROADCASTER_ID},
            transport: { 
                method: "websocket", 
                session_id: sessionId }
        }),
    });

    const data = await response.json();
    console.log("Subscription Response:", data); // Log Twitch's response

    if (response.status !== 202) {
        console.error("❌ Error subscribing to follow events:", data);
    } else {
        console.log("✅ Successfully subscribed to follow events!");
    }

    return data.data[0].id;
}

async function connectToTwitch() {
    //const accessToken = await getAccessToken(); // ACCESS TOKEN FOR APP TO WS, NEED TO GET OAUTH
    //console.log("access Token", accessToken);
    //const oauthToken = await getAccessUSERToken(accessToken);
    //console.log("oauthtoken", oauthToken)
    
    twitchSocket = new WebSocket("wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30");
    twitchSocket.on("open", () => console.log("Connected to Twitch WebSocket"));

    // Handle Twitch Ping frames
    twitchSocket.on("ping", () => {
        console.log("Received Ping from Twitch, sending Pong...");
        twitchSocket.pong(); // Respond to Ping with Pong
        }); 

    twitchSocket.on("message", async (data) => {
        const message = JSON.parse(data);
        console.log(message);
        if (message.metadata.message_type === "session_welcome") {
            sessionId = message.payload.session.id;
            console.log("Session ID:", sessionId);
            await listsubscription();
            //await deletesubscription();
            followEventID = await subscribeToFollowers(sessionId, TWITCH_OAUTH_TOKEN); // NEED TO GET AUTHENTICATION TOKEN FROM API
        }

        if (message.metadata.message_type === "notification") {
            if (message.payload.subscription.type === "channel.follow") {
                const follower = message.payload.event.user_name;
                console.log(`${follower} just followed!`);
                broadcastToClients({ type: "follow", user: follower });
            }
        }

        if (message.metadata.message_type === "session_keepalive") {
            console.log("✅ session_keepalive Notification Recieved");
        }
    });

    twitchSocket.on("close", (code, reason) => {
        console.log(`Twitch WebSocket closed. Code: ${code}, Reason: ${reason}`);

        if (code === 1000) {
            console.log("✅ Session terminated successfully!");
            process.exit(0);
        }

        setTimeout(connectToTwitch, 5000); // Reconnect after 5 seconds
  });
  
    twitchSocket.on("error", (error) => console.error("Twitch WebSocket error:", error));
}

function broadcastToClients(data) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// MAIN ====================================================================================

const server = new WebSocket.Server({ port: PORT });
server.on("connection", (socket) => {
    console.log("New WebSocket client connected");
    clients.add(socket);

    socket.on("close", () => {
        console.log("Client disconnected");
        clients.delete(socket);
    });
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);

connectToTwitch();

const readline = require("readline");

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.on("line", (input) => {
    if (input.trim().toLowerCase() === "stop") {
        shutdown();
    }
});

/* 
TODO:
- Implement Oauth check and see if token is still valid, if not prompt user to open authenticator
- Store keys locally in a file (maybe encrypted) and able to edit files
- (maybe) migrate over to a different language to handle backend
*/