import os
import asyncio
import websockets
import json
import requests
from dotenv import load_dotenv, set_key, dotenv_values

load_dotenv()

PORT = int(os.getenv("PORT", 8080))
TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID")
TWITCH_CLIENT_SECRET = os.getenv("TWITCH_CLIENT_SECRET")
BROADCASTER_ID = os.getenv("TWITCH_BROADCASTER_ID")
TWITCH_OAUTH_TOKEN = os.getenv("TWITCH_OAUTH_TOKEN") 
TOKEN_FILE = "oauth_token.txt"

clients = set()
twitch_socket = None
session_id = None
follow_event_id = None

def save_token(acctoken, refrtok):
    env_values = dotenv_values(".env")
    set_key(".env", "TWITCH_ACC_TOKEN", f"{acctoken}")
    set_key(".env", "TWITCH_REFRESH_TOKEN", f"{refrtok}")
    print("✅ keys updated")

def validate_oauth_token():
    global TWITCH_OAUTH_TOKEN
    url = "https://id.twitch.tv/oauth2/validate"
    headers = {"Authorization": f"OAuth {TWITCH_OAUTH_TOKEN}"}
    response = requests.get(url, headers=headers)
    if response.status_code == 200:
        print("OAuth token is valid")
        print(json.dumps(response.json(), indent=2))
        return True
    print("OAuth token invalid. Refreshing...")
    return refresh_oauth_token()

def refresh_oauth_token(): # DOES NOT WORK FOR SOME REASON
    global TWITCH_OAUTH_TOKEN
    url = f"https://id.twitch.tv/oauth2/token?client_id={TWITCH_CLIENT_ID}&client_secret={TWITCH_CLIENT_SECRET}&code={TWITCH_OAUTH_TOKEN}&grant_type=authorization_code&redirect_uri=http://localhost"
    response = requests.post(url)
    if response.status_code == 200:
        accesstok = response.json()["access_token"]
        refreshtok = response.json()["refresh_token"]
        save_token(accesstok, refreshtok)
        print("✅ OAuth token refreshed.")
        return True
    print("❌ Failed to refresh OAuth token.")
    print(json.dumps(response.json(), indent=2))
    return False

async def delete_subscription():
    url = f"https://api.twitch.tv/helix/eventsub/subscriptions?id={follow_event_id}"
    headers = {
        "Client-ID": TWITCH_CLIENT_ID,
        "Authorization": f"Bearer {TWITCH_OAUTH_TOKEN}"
    }
    response = requests.delete(url, headers=headers)
    if response.status_code != 204:
        print(f"❌ Error deleting event: {follow_event_id}")
    else:
        print(f"✅ Successfully deleted: {follow_event_id}")

async def list_subscriptions():
    url = "https://api.twitch.tv/helix/eventsub/subscriptions"
    headers = {
        "Client-ID": TWITCH_CLIENT_ID,
        "Authorization": f"Bearer {TWITCH_OAUTH_TOKEN}"
    }
    response = requests.get(url, headers=headers)
    print(json.dumps(response.json(), indent=2))

async def subscribe_to_followers(session_id, access_token):
    url = "https://api.twitch.tv/helix/eventsub/subscriptions"
    headers = {
        "Client-ID": TWITCH_CLIENT_ID,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json"
    }
    body = {
        "type": "channel.follow",
        "version": "2",
        "condition": {
            "broadcaster_user_id": BROADCASTER_ID,
            "moderator_user_id": BROADCASTER_ID
        },
        "transport": {
            "method": "websocket",
            "session_id": session_id
        }
    }
    response = requests.post(url, headers=headers, json=body)
    data = response.json()
    print(json.dumps(data, indent=4))
    if response.status_code != 202:
        print(f"❌ Error subscribing: {data}")
    else:
        print("✅ Subscribed to follow events!")
    return data.get("data", [{}])[0].get("id")

async def connect_to_twitch():
    global twitch_socket, session_id, follow_event_id
    uri = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30"
    async with websockets.connect(uri) as ws:
        twitch_socket = ws
        print("Connected to Twitch WebSocket")

        async for message in ws:
            data = json.loads(message)
            print(json.dumps(data, indent=4))
            
            if data["metadata"]["message_type"] == "session_welcome":
                session_id = data["payload"]["session"]["id"]
                print("Session ID:", session_id)
                await list_subscriptions()
                follow_event_id = await subscribe_to_followers(session_id, TWITCH_OAUTH_TOKEN)
                
            elif data["metadata"]["message_type"] == "notification":
                if data["payload"]["subscription"]["type"] == "channel.follow":
                    follower = data["payload"]["event"]["user_name"]
                    print(f"{follower} just followed!")
                    await broadcast_to_clients({"type": "follow", "user": follower})
                    
            elif data["metadata"]["message_type"] == "session_keepalive":
                print("✅ session_keepalive received")

async def broadcast_to_clients(data):
    if clients:
        message = json.dumps(data, indent=4)
        await asyncio.gather(*(client.send(message) for client in clients))

async def handle_client(websocket, path):
    print("New WebSocket client connected")
    clients.add(websocket)
    try:
        async for message in websocket:
            pass
    finally:
        print("Client disconnected")
        clients.remove(websocket)

async def shutdown():
    await delete_subscription()
    print("✅ Shutting down server...")
    os._exit(0)

async def main():
    global TWITCH_OAUTH_TOKEN
    TWITCH_OAUTH_TOKEN = TWITCH_OAUTH_TOKEN
    
    if not validate_oauth_token():
        return
    
    server = await websockets.serve(handle_client, "", PORT)
    print(f"WebSocket server running on ws://localhost:{PORT}")
    await connect_to_twitch()
    await server.wait_closed()

if __name__ == "__main__":
    loop = asyncio.get_event_loop()
    loop.create_task(main())
    loop.run_in_executor(None, lambda: input("Type 'stop' to shut down the server: ") and asyncio.run(shutdown()))
    loop.run_forever()
