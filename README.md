> **⚠️ Project Moved — No Further Updates Here**
>
> This repository is no longer maintained.  
> Development has moved to **[Ampdeck+](https://github.com/DreadHeadHippy/AmpdeckPlus)**.
>
> Please update your bookmarks and switch to the new repo:  
> **https://github.com/DreadHeadHippy/AmpdeckPlus**

---

# Ampdeck

**The unofficial Plexamp plugin for Stream Deck**

![Ampdeck on Stream Deck+](her0.png)

![Release](https://img.shields.io/github/v/release/DreadHeadHippy/ampdeck)
![Status](https://img.shields.io/badge/status-actively%20maintained-brightgreen)
![Downloads](https://img.shields.io/github/downloads/DreadHeadHippy/ampdeck/total)
![Last Commit](https://img.shields.io/github/last-commit/DreadHeadHippy/ampdeck)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/rackemrack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

Ampdeck brings Plexamp to your Stream Deck. See your album art, track info, and playback time on the LCD keys. All updated in real time. Stream Deck+ users get the full experience with a smooth animated progress bar spanning the touch strip and configurable dial controls.

## Features

- **Album Art** — Live album art on any LCD key with a pause overlay. Tap to play/pause.
- **Now Playing Strip** — Artist, album, track, or elapsed time on each touch strip panel with auto-scrolling for long text.
- **Dial Controls** — Configurable dial actions: rotate to skip tracks, adjust volume, or rate tracks. Press to play/pause, toggle shuffle, or cycle repeat.
- **Star Ratings** — Rate your tracks with half-star or full-star increments using the dial or dedicated rating button. Visual feedback shows the rating with stars.
- **Rating Button** — Dedicated button showing the current track's star rating. Tap to cycle through ratings with configurable font size and increment mode.
- **Touch Strip Controls** — Tap to play/pause with visual feedback overlays showing the action taken.
- **Spanning Progress Bar** — A single progress bar that flows across all 4 dials, with colors extracted from album art.
- **Play / Pause** — Dedicated button with instant visual feedback.
- **Previous / Next** — Tap to skip tracks. Hold to seek forward or backward.
- **Shuffle** — Toggle shuffle on/off with visual state indicator.
- **Repeat** — Cycle through repeat modes: Off → All → One.
- **Track Info** — Audio codec, bitrate, and track number at a glance.
- **Time Elapsed** — Large elapsed/total time display with its own progress bar.
- **Dynamic Colors** — Progress bar and accent colors adapt to the current album art, or lock to orange if you prefer.
- **Configurable Text Colors** — Choose from White, Light Gray, Orange, Amber, or Black to match your setup.
- **Direct Player Communication** — Commands go straight to Plexamp's local API for fast, reliable playback control with automatic server fallback.

## Compatibility

Ampdeck works on **any Stream Deck model** — the button actions (Album Art, Play/Pause, Previous, Next, Shuffle, Repeat, Track Info, Time Elapsed) work on every device with LCD keys. The Now Playing Strip with dials and progress bar is exclusive to the **Stream Deck+**.

| Feature | Stream Deck / XL / MK.2 / Mini / Neo | Stream Deck+ |
|---------|:-------------------------------------:|:------------:|
| Album Art | ✓ | ✓ |
| Play / Pause | ✓ | ✓ |
| Previous / Next | ✓ | ✓ |
| Shuffle | ✓ | ✓ |
| Repeat | ✓ | ✓ |
| Track Info | ✓ | ✓ |
| Time Elapsed | ✓ | ✓ |
| Rating | ✓ | ✓ |
| Now Playing Strip | — | ✓ |
| Dial Controls | — | ✓ |
| Spanning Progress Bar | — | ✓ |

## Requirements

- Any [Stream Deck](https://www.elgato.com/stream-deck) model (Stream Deck+ recommended for the full experience)
- [Plexamp](https://www.plex.tv/plexamp/) running on the same network
- A [Plex Media Server](https://www.plex.tv/media-server-downloads/) with your music library

## Installation

1. Download **`com.dreadheadhippy.ampdeck.streamDeckPlugin`** from the [Releases](https://github.com/DreadHeadHippy/ampdeck/releases/tag/v1.3.1) page
2. Double-click the file

That's it. Stream Deck handles the rest.

## Updating

1. Download the latest **`install.bat`** from the [Releases](https://github.com/DreadHeadHippy/ampdeck/releases/tag/v1.3.1) page
2. Double-click the file

Stream Deck automatically replaces the old version. Your settings are preserved.

## Setup

1. Find **Ampdeck** in the actions list on the right side of the Stream Deck app
2. Drag **Album Art** to any button
3. Drag **Now Playing Strip** to all 4 dials
4. Optionally drag **Play/Pause**, **Previous**, **Next**, **Shuffle**, **Repeat**, **Track Info**, **Time Elapsed**, or **Rating** to buttons
5. Click any Ampdeck action and configure:

### Connection Settings

Ampdeck connects to both your local Plexamp player and your Plex server:

| Setting | Description |
|---------|-------------|
| **Player URL** | Your Plexamp player address. Defaults to `http://localhost:32500` for headless Plexamp. Desktop users may need a different port — check Plexamp's settings. |
| **Server URL** | Your Plex server address (e.g. `http://192.168.1.100:32400`) |
| **Plex Token** | See [Finding Your Plex Token](#finding-your-plex-token) below |
| **Client Name** | Your computer's name as it appears in the Plex dashboard (used for server fallback) |

Use the **Test Player** button to verify the Plexamp connection and **Test Server** to verify the Plex server connection.

### Strip Configuration

Each dial panel can be configured independently:

| Setting | Options |
|---------|---------|
| **Display Mode** | Artist, Album, Track Title, or Time |
| **Font Size** | Small (12) through XX-Large (28) |
| **Dial Action** | None, Next/Previous (rotate), Volume (rotate), or Star Rating (rotate) |
| **Rating Mode** | Half Star (0.5 increment) or Full Star (1.0 increment) — only appears when Dial Action is set to Star Rating |
| **Dial Press** | Play/Pause, Toggle Shuffle, or Cycle Repeat |
| **Total Panels** | How many panels share the progress bar (1–4) |
| **Panel Position** | This panel's position in the progress bar sequence, or None to disable |
| **Text Color** | White, Light Gray, Orange, Amber, or Black |
| **Dynamic Colors** | When enabled, accent colors are extracted from album art. When disabled, they stay orange. |

For example, to have the progress bar span all 4 dials: set each panel to "4 panels" and positions 1, 2, 3, 4 from left to right.

### Advanced Settings

| Setting | Description |
|---------|-------------|
| **Time Offset** | Compensates for network latency between the player and the display. Defaults to 0ms. Only needed if the time display feels ahead or behind. |
| **Debug Logging** | When enabled, logs detailed API requests and connection state to the browser console. Plex tokens are automatically sanitized in log output for safe sharing. |

## Finding Your Plex Token

1. Open Plex Web (app.plex.tv) in your browser
2. Play any media
3. Press **F12** to open developer tools
4. Go to the **Network** tab
5. Look for any request and find `X-Plex-Token` in the URL
6. Copy the token value

For more details, see the [Plex support article](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/).

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Plugin not showing in actions list | Make sure Stream Deck was fully closed before running `install.bat` or `install.sh` |
| Player test fails | Verify Plexamp is running and the Player URL is correct. Headless Plexamp defaults to port 32500. Desktop Plexamp may use a different port. |
| Server test fails | Verify your server URL includes the port (`:32400`) and your token is correct |
| Buttons not working | This is usually a connection issue. Enable debug logging and check the browser console (`http://localhost:23654`) for errors. |
| Nothing displays | Confirm Plexamp is actively playing. Check both Player and Server test buttons. |
| Time display is off | Adjust the Time Offset in Advanced settings (try small values like 500–1000) |
| Progress bar not aligned | Check that all strip panels have matching Total Panels values |

### Debug Logging

If something isn't working, enable **Debug Logging** in the Advanced section of any Ampdeck action's settings. Then open the Stream Deck remote debugger at `http://localhost:23654` in your browser to see detailed logs. Plex tokens are automatically masked in log output, so it's safe to share logs when reporting issues.

## Manual Installation

Copy the `com.dreadheadhippy.ampdeck.sdPlugin` folder to:

**Windows:**
```
%APPDATA%\Elgato\StreamDeck\Plugins\
```

**macOS:**
```
~/Library/Application Support/com.elgato.StreamDeck/Plugins/
```

Then restart Stream Deck.

## Support

If Ampdeck is useful to you, consider [buying me a coffee](https://ko-fi.com/rackemrack). It's totally optional; The plugin is free and always will be.

## License

[MIT](LICENSE)
