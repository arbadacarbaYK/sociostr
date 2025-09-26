# Sociostr

A real-time visualization of Nostr users on a world map, showing their activity (profile updates, posts, and zaps) with different colored markers.

## Features

- 🌍 Interactive world map with dark theme
- 👥 Real-time Nostr user visualization
- 🎯 Activity-based color coding (purple: profiles, orange: posts, yellow: zaps)
- 🔄 Auto-update every 2 minutes
- 📍 Geolocation-based user positioning
- 🎨 Dark mode UI optimized for Bitcoiners

## Live Demo

Visit: https://arbadacarbaYK.github.io/sociostr

## How it Works

1. Fetches user data from Nostr relays (kind 0, 1, and 9735 events)
2. Resolves user locations from profile data, NIP-05 domains, and IP geolocation
3. Displays users on an interactive map with activity-based markers
4. Auto-updates every 2 minutes to show new activity
5. Cleans up inactive users after 5 minutes

## Development

```bash
npm install
npm start
```

## Deployment

The app is automatically deployed to GitHub Pages when changes are pushed to the main branch.

```bash
npm run deploy
```

## Backend

This frontend connects to a Node.js backend that handles:
- Nostr relay connections
- User data fetching and processing
- Geolocation resolution
- WebSocket updates

## Built with

- React + TypeScript
- Leaflet + React-Leaflet
- Axios for API calls
- Bech32 for Nostr key encoding

## License

MIT

Built by Bitcoiners with 💜