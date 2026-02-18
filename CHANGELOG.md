# Changelog

## v1.3.1

### Visual Improvements
- **Track Info tile styling**: Bitrate (kbps) now uses dynamic accent color (22px bold) for better visual hierarchy and matches the accent color scheme from rating tile
- **Time Elapsed tile styling**: Total track length now uses dynamic accent color (36px bold) matching the current time font size for improved visual balance
- **Rating tile**: Increased "RATING" label from 16px to 26px bold for better readability
- **Track Info tile uniformity**: Improved spacing and size consistency - codec/bitrate at 28px/22px, track label at 24px, track number at 32px

### Bug Fixes
- **Fixed touch strip text color**: Track/artist/album names now display in the user's chosen text color (matching labels) instead of always grey when playing. Previously, both the label and content text were incorrectly using the secondary grey color due to a copy-paste error.
- **Fixed rating button text positioning**: Numeric and "both" display modes now properly center text vertically regardless of font size. Previously, text would appear too high at larger font sizes.
- **Fixed rating loss on quick track changes**: Ratings now save immediately when switching tracks, even if you skip within the 2-second debounce window. Previously, ratings could be lost if you rated a track and switched songs too quickly.
- **Fixed rating button API spam**: Rating button now uses the same 2-second debounce as the dial to prevent multiple API calls when clicking rapidly. Display updates immediately, but saves are batched intelligently.

### Performance Notes
- Rating saves remain debounced (2 seconds) to prevent API spam while adjusting the dial on a single track
- On track change, pending ratings flush immediately (one API call per track)
- No additional polling overhead—efficient use of existing 1-second timeline poll

## v1.3.0

### New Features
- **Rating Button**: New dedicated button action that displays the current track's star rating. Tap to cycle through ratings with configurable half-star or full-star increments.
  - Three display styles: Stars Only (★★★★☆), Numeric Only (4.5), or Both (4.5 / 5)
  - Configurable font size (32px - 56px)
  - Works with the same rating modes as the dial (half-star or full-star)
  - Visual display updates immediately
  - Each Rating button can have its own display style, font size, and rating mode settings
  - Ratings persist correctly even with Plex's server-side caching delays

### Bug Fixes
- **Fixed rating persistence**: Implemented smart caching system to handle Plex's server-side cache delays. Ratings no longer revert to zero after being set. The plugin now tracks user-set ratings per track and only accepts server updates when they match or exceed the local value.
- **Removed redundant overlays**: "SAVED!" confirmation overlay removed from dial rating changes since ratings now persist visibly. Error overlays still shown when needed.
- **Fixed rating protection**: Rating updates are now protected across all three data sources (timeline polls, metadata fetches, and server polls) using track-specific caching instead of time-based grace periods.

### Technical Notes
- New `userSetRatings` cache tracks user-initiated rating changes by `ratingKey`
- Smart cache comparison: accepts incoming ratings from Plex only when they meet or exceed locally set values
- Automatic cleanup of old rating overrides when tracks change to prevent memory buildup
- Rating button uses per-button settings stored in action context
- Success responses from rating API are now silent (errors only shown)

## v1.2.0

### New Features
- **Star Rating dial action**: New "Rotate: Star Rating" option for the dial. Scroll to adjust the current track's rating (0-5 stars). Supports both half-star and full-star modes.
  - **Half Star mode**: Each scroll increments by 0.5 stars (★⯨☆☆☆)
  - **Full Star mode**: Each scroll increments by 1.0 stars (★★☆☆☆)
  - Visual overlay shows star rating with Unicode stars during adjustment
  - **Debounced saving**: Rating saves 2 seconds after you stop rotating, letting you adjust freely before committing
  - **Success confirmation**: "SAVED!" overlay appears when rating is successfully saved to Plex
  - Ratings are saved directly to Plex server and persist across library
  - Current track ratings are loaded and displayed when tracks change
- **Rating mode setting**: New dropdown to choose between half-star and full-star rating increments (only appears when rating dial action is selected)
- **Error feedback**: API errors (missing server config, authentication failures, etc.) are displayed directly on the strip

### Bug Fixes
- **Fixed overlay display reversion**: Strip overlays (volume, rating, next/prev) now properly clear and revert to the original display mode after 1.5 seconds. Corrected layout geometry that was causing element overlap errors.
- **Fixed layout overlap errors**: Adjusted touch strip layout positioning to prevent `progressBar` and `displayText` element conflicts

### Technical Notes
- Current track rating is extracted from timeline metadata (`userRating` attribute, 0-10 scale where 0=unrated, 2=1★, 10=5★)
- Rating updates use Plex's `/:/rate` API endpoint with the track's ratingKey
- Rating overlay uses Unicode characters: ★ (filled), ☆ (empty), ⯨ (half)
- Debounce timer prevents multiple API calls while user is adjusting rating
- Rating changes are protected from being overwritten by timeline polls for 3 seconds after user adjustment
- Plexamp UI may not immediately reflect rating changes due to caching; skip forward/back to refresh

## v1.1.0

### Major Changes
- **Local Player API for commands**: Playback controls (play, pause, skip, seek, volume) now go directly to Plexamp's local HTTP API instead of routing through the Plex server. This eliminates the most common cause of "buttons not working" reported by users. Commands are faster, more reliable, and don't require the server to relay them.
- **Timeline poll for real-time playback position**: Replaced the old `/status/sessions` server poll with Plexamp's `/player/timeline/poll` endpoint. The progress bar and time display now show actual playback position from the player instead of interpolated guesswork. Polling interval reduced from 2s to 1s for more responsive feedback.
- **Server fallback**: If the local player is unreachable, commands and polling automatically fall back to the original server relay method so nothing breaks.

### New Features
- **Shuffle button**: New action that toggles shuffle on/off. Button icon lights up with the accent color when shuffle is active.
- **Repeat button**: New action that cycles through repeat modes: Off → All → One. Icon shows the current mode with accent color and state label.
- **Dial press action selector**: The dial press on the Now Playing Strip can now be configured to Play/Pause, Toggle Shuffle, or Cycle Repeat via a dropdown in strip settings.
- **Touch strip visual feedback**: Tapping the touch strip or using dial controls now shows a brief overlay on the active strip panel for 1.5 seconds. Displays the action taken (PLAYING/PAUSED with play/pause icon, NEXT/PREVIOUS, VOLUME with fill bar, SHUFFLE ON/OFF, REPEAT OFF/ALL/ONE).
- **Touch strip play/pause**: Tapping the touch strip toggles play/pause.
- **Scrolling text**: Long artist names, album titles, and track names that don't fit on a strip panel now scroll automatically. Text pauses briefly, scrolls left, then resets. Each panel scrolls independently.
- **Player URL setting**: New "Plexamp Player" section in settings with a configurable Player URL. Defaults to `http://localhost:32500` for headless Plexamp. Desktop users can enter their Plexamp's port.
- **Debug logging**: New "Enable debug logging" checkbox in Advanced settings. When on, logs detailed API requests, responses, and connection state to the browser console. Tokens are automatically sanitized in log output.
- **Dual test buttons**: Separate "Test Player" and "Test Server" buttons in settings. Test Player checks the local Plexamp connection. Test Server checks the Plex server for metadata access.

### Changes
- Time sync offset now defaults to 0 (was 1500). With real-time position from the timeline poll, the offset is no longer needed in normal operation. Only applies when using server fallback mode.
- Shuffle and repeat state sync from the player's timeline on every poll.
- Volume state syncs from the player's reported volume on each poll.
- Settings UI reorganized: Player settings and Server settings are now separate sections for clarity.
- Plex tokens are masked in debug log output for safe sharing.

### Technical Notes
- Commands include `X-Plex-Client-Identifier` header and incrementing `commandID` per the Plex Remote Control API spec.
- Timeline poll uses `includeMetadata=1` parameter. If the player returns track metadata in the response, it's used directly. If not, metadata is fetched from the server as before.
- Album art is still fetched from the Plex server (requires token). The timeline provides server connection info (address, port, protocol, token) which is used to construct art URLs.
- Shuffle uses `/player/playback/setParameters?shuffle=0` or `shuffle=1`.
- Repeat uses `/player/playback/setParameters?repeat=0` (off), `repeat=1` (all), or `repeat=2` (one track).

## v1.0.1

### New Features
- **Dial controls**: Configurable dial actions for the Now Playing Strip. Choose between Next/Previous on rotate, Volume on rotate, or None. All modes support Play/Pause on dial press.
- **Configurable text color**: Choose from White, Light Gray, Orange, Amber, or Black for text on both buttons and the strip. Useful for matching lighter Stream Deck themes.
- **Dynamic color toggle**: Option to disable dynamic accent colors extracted from album art. When off, accents stay on the default orange.
- **macOS support**: Added install.sh for macOS and macOS platform entry in the manifest.

### Changes
- Appearance settings now appear on both button and strip property inspectors
- Layout refreshes immediately when appearance settings change
- Manifest TriggerDescription updated to reflect dial functionality

## v1.0.0

Initial release.

- Album art display with dominant color extraction
- Now Playing strip with configurable panels spanning all 4 dials
- Play/Pause, Previous, Next button actions
- Track Info button (codec, bitrate, track number)
- Time Elapsed button with progress bar
- Hold-to-seek on Previous/Next buttons
- Configurable sync offset for Plex reporting delay
- Interpolated progress (200ms render, 2s poll)
- Test Connection button in settings
