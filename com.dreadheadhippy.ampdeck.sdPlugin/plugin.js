// Ampdeck v1.3.1 - Stream Deck Plugin for Plexamp
// Local player API for commands + timeline poll for real-time playback position
// Server connection retained for metadata and album art

// File-based logging for debugging
var debugLogs = [];
var maxLogs = 500; // Keep last 500 log entries
function debugLog(tag, message, data) {
    var timestamp = new Date().toISOString().split('T')[1].slice(0, -1);
    var logEntry = `[${timestamp}] ${tag} ${message}`;
    if (data !== undefined) {
        logEntry += ' ' + JSON.stringify(data, null, 2);
    }
    debugLogs.push(logEntry);
    if (debugLogs.length > maxLogs) {
        debugLogs.shift(); // Remove oldest
    }
    console.log(tag, message, data); // Still log to console too
}

// Make logs accessible globally - you can call window.dumpLogs() in browser console
window.dumpLogs = function() {
    console.log("=== AMPDECK DEBUG LOGS ===");
    console.log(debugLogs.join('\n'));
    alert("Logs copied to console! See console tab (F12).\n\nTotal entries: " + debugLogs.length);
    return debugLogs.join('\n');
};

window.clearLogs = function() {
    debugLogs = [];
    console.log("Debug logs cleared");
};

var websocket = null;
var pluginUUID = null;
var globalSettings = {};
var actions = {};

// Plex state
var currentTrack = null;
var currentAlbumArt = null;
var dominantColor = "#E5A00D";
var playbackState = "stopped";
var trackDuration = 0;
var lastArtPath = null;
var albumTrackCount = null;
var lastParentRatingKey = null;

// Playback position (real-time from timeline poll)
var currentPosition = 0;
var displayProgress = 0;
var lastPositionTimestamp = 0;

// Layout state (avoid resending unchanged layouts)
var lastLayoutState = {};

// Button hold state for seek-on-hold
var buttonHoldState = {};
var HOLD_THRESHOLD = 400;
var SEEK_INTERVAL = 200;
var SEEK_AMOUNT = 10000;

// Volume state
var currentVolume = 50;
var VOLUME_STEP = 5;

// Shuffle/Repeat state
var currentShuffle = 0;
var currentRepeat = 0;

// Rating state
var currentRating = 0; // 0-10 (0 = unrated, 2 = 1 star, 4 = 2 stars, etc.)
var RATING_HALF_STAR = 1;
var RATING_FULL_STAR = 2;
var lastRatingChangeTime = 0; // Timestamp to prevent timeline from overwriting user changes
var ratingSaveTimer = null; // Timer for debounced rating save
var pendingRatingContext = null; // Context that has a pending rating save
var userSetRatings = {}; // Track user-set ratings by ratingKey to handle Plex cache delays

// Local player API command tracking
var localCommandID = 0;
var CLIENT_IDENTIFIER = "com.dreadheadhippy.ampdeck";

// Connection state tracking
var localPlayerConnected = false;
var serverConnected = false;
var lastTimelineRatingKey = null;

// Touch strip overlay state (per-context)
var stripOverlays = {};

// Workers
var pollWorker = null;
var renderWorker = null;

// ============================================
// LOGGING SYSTEM
// ============================================
var LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
var currentLogLevel = LOG_LEVELS.INFO;

function log(msg, data) { logAt("INFO", msg, data); }
function logDebug(msg, data) { logAt("DEBUG", msg, data); }
function logWarn(msg, data) { logAt("WARN", msg, data); }
function logError(msg, data) { logAt("ERROR", msg, data); }

function logAt(level, msg, data) {
    if (LOG_LEVELS[level] < currentLogLevel) return;
    var ts = new Date().toISOString().substr(11, 12);
    var prefix = "[Ampdeck " + ts + " " + level + "] ";
    var sanitized = sanitizeLog(msg);
    if (data !== undefined) console.log(prefix + sanitized, data);
    else console.log(prefix + sanitized);
}

function sanitizeLog(msg) {
    // Mask Plex tokens in log output
    return msg.replace(/X-Plex-Token=[^&\s"']+/gi, "X-Plex-Token=***");
}

function updateLogLevel() {
    currentLogLevel = globalSettings.debugMode ? LOG_LEVELS.DEBUG : LOG_LEVELS.INFO;
}

// ============================================
// SETTINGS HELPERS
// ============================================
function getTextColor() {
    return globalSettings.textColor || "#FFFFFF";
}

function getSecondaryTextColor() {
    var tc = getTextColor();
    if (tc === "#FFFFFF") return "#888888";
    if (tc === "#BBBBBB") return "#777777";
    if (tc === "#E5A00D") return "#B07A0A";
    if (tc === "#FFBF00") return "#B08600";
    if (tc === "#000000") return "#444444";
    return "#888888";
}

function getAccentColor() {
    if (globalSettings.dynamicColors === false) return "#E5A00D";
    return dominantColor;
}

function getPlayerUrl() {
    return globalSettings.playerUrl || "http://localhost:32500";
}

function getNextCommandID() {
    localCommandID++;
    return localCommandID;
}

// ============================================
// URL VALIDATION & SECURITY
// ============================================
function validateUrl(url, allowHttp) {
    if (!url || typeof url !== 'string') return { valid: false, error: "URL is required" };
    
    try {
        var parsed = new URL(url);
        
        // Only allow HTTP(S) protocols
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return { valid: false, error: "Only HTTP and HTTPS protocols are allowed" };
        }
        
        // Warn about HTTP if not explicitly allowed
        if (parsed.protocol === 'http:' && !allowHttp) {
            // Allow localhost/127.0.0.1 over HTTP (for local player)
            var isLocalhost = parsed.hostname === 'localhost' || 
                            parsed.hostname === '127.0.0.1' || 
                            parsed.hostname.startsWith('192.168.') ||
                            parsed.hostname.startsWith('10.') ||
                            parsed.hostname.startsWith('172.');
            
            if (!isLocalhost) {
                return { valid: false, error: "HTTPS required for remote servers. HTTP is only allowed for local network." };
            }
        }
        
        return { valid: true, url: parsed.href };
    } catch (e) {
        return { valid: false, error: "Invalid URL format: " + e.message };
    }
}

function createSecureHeaders(includeToken) {
    var headers = {
        "Accept": "application/json",
        "X-Plex-Client-Identifier": CLIENT_IDENTIFIER
    };
    
    if (includeToken && globalSettings.plexToken) {
        headers["X-Plex-Token"] = globalSettings.plexToken;
    }
    
    return headers;
}

// ============================================
// DISPLAY POSITION
// ============================================
function updateDisplayPosition() {
    if (playbackState === "playing" && lastPositionTimestamp > 0) {
        var elapsed = Date.now() - lastPositionTimestamp;
        currentPosition = Math.min(currentPosition + elapsed, trackDuration);
        lastPositionTimestamp = Date.now();
    }
    displayProgress = trackDuration > 0 ? (currentPosition / trackDuration) * 100 : 0;
}

function renderTick() {
    updateDisplayPosition();
    updateAllDisplays();
}

// ============================================
// WEB WORKERS
// ============================================
function createTimerWorker(intervalMs) {
    var code = 'var iv=null;self.onmessage=function(e){if(e.data==="start"){if(iv)clearInterval(iv);iv=setInterval(function(){self.postMessage("tick");},' + intervalMs + ');}else if(e.data==="stop"){if(iv){clearInterval(iv);iv=null;}}};';
    var blob = new Blob([code], { type: "application/javascript" });
    var url = URL.createObjectURL(blob);
    var worker = new Worker(url);
    worker._blobUrl = url;
    return worker;
}

function terminateWorker(worker) {
    if (!worker) return;
    worker.postMessage("stop");
    worker.terminate();
    if (worker._blobUrl) URL.revokeObjectURL(worker._blobUrl);
}

// ============================================
// COLOR EXTRACTION
// ============================================
function extractDominantColor(imageDataUrl) {
    return new Promise(function(resolve) {
        var img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function() {
            try {
                var canvas = document.createElement("canvas");
                var ctx = canvas.getContext("2d");
                canvas.width = 50; canvas.height = 50;
                ctx.drawImage(img, 0, 0, 50, 50);
                var pixels = ctx.getImageData(0, 0, 50, 50).data;
                var r = 0, g = 0, b = 0, count = 0;
                for (var i = 0; i < pixels.length; i += 4) {
                    var pr = pixels[i], pg = pixels[i + 1], pb = pixels[i + 2];
                    var brightness = (pr + pg + pb) / 3;
                    if (brightness > 30 && brightness < 220) {
                        var mx = Math.max(pr, pg, pb), mn = Math.min(pr, pg, pb);
                        if (mx > 0 && (mx - mn) / mx > 0.2) {
                            r += pr; g += pg; b += pb; count++;
                        }
                    }
                }
                if (count > 0) {
                    r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
                    var mn2 = Math.min(r, g, b);
                    r = Math.min(255, Math.round(r + (r - mn2) * 0.2));
                    g = Math.min(255, Math.round(g + (g - mn2) * 0.2));
                    b = Math.min(255, Math.round(b + (b - mn2) * 0.2));
                    var hex = "#" + r.toString(16).padStart(2, "0") + g.toString(16).padStart(2, "0") + b.toString(16).padStart(2, "0");
                    resolve(hex);
                } else { resolve("#E5A00D"); }
            } catch (e) { resolve("#E5A00D"); }
        };
        img.onerror = function() { resolve("#E5A00D"); };
        img.src = imageDataUrl;
    });
}

// ============================================
// STREAM DECK CONNECTION
// ============================================
function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    pluginUUID = inPluginUUID;
    websocket = new WebSocket("ws://127.0.0.1:" + inPort);

    websocket.onopen = function() {
        websocket.send(JSON.stringify({ event: inRegisterEvent, uuid: inPluginUUID }));
        websocket.send(JSON.stringify({ event: "getGlobalSettings", context: inPluginUUID }));
        console.log("==========================================");
        console.log("AMPDECK v1.3.1 - PLUGIN CONNECTED");
        console.log("Check console for [OVERLAY], [VOLUME], [RATING], [STRIP] messages");
        console.log("==========================================");
        log("Plugin connected - Ampdeck v1.3.1");
    };

    websocket.onmessage = function(evt) {
        var data = JSON.parse(evt.data);
        switch (data.event) {
            case "willAppear": onWillAppear(data); break;
            case "willDisappear": onWillDisappear(data); break;
            case "didReceiveGlobalSettings": onDidReceiveGlobalSettings(data); break;
            case "didReceiveSettings": onDidReceiveSettings(data); break;
            case "keyDown": onKeyDown(data); break;
            case "keyUp": onKeyUp(data); break;
            case "dialRotate": onDialRotate(data); break;
            case "dialDown": onDialDown(data); break;
            case "touchTap": onTouchTap(data); break;
        }
    };
}

function onWillAppear(data) {
    actions[data.context] = { action: data.action, settings: data.payload.settings || {} };
    applyGlobalFromSettings(data.payload.settings || {});
    startPolling();
}

function onWillDisappear(data) {
    delete actions[data.context];
    delete lastLayoutState[data.context];
    if (stripOverlays[data.context]) {
        if (stripOverlays[data.context].timer) clearTimeout(stripOverlays[data.context].timer);
        delete stripOverlays[data.context];
    }
    if (stripScrollState[data.context]) delete stripScrollState[data.context];
    if (buttonHoldState[data.context]) {
        clearInterval(buttonHoldState[data.context].seekInterval);
        delete buttonHoldState[data.context];
    }
    if (Object.keys(actions).length === 0) stopPolling();
}

function onDidReceiveGlobalSettings(data) {
    globalSettings = data.payload.settings || {};
    updateLogLevel();
    logDebug("Global settings received", globalSettings);
    if (globalSettings.plexToken && globalSettings.plexServerUrl) {
        pollTimeline();
    }
}

function onDidReceiveSettings(data) {
    if (actions[data.context]) actions[data.context].settings = data.payload.settings || {};
    applyGlobalFromSettings(data.payload.settings || {});
    saveGlobalSettings();
    lastLayoutState[data.context] = null;
    updateDisplayPosition();
    updateAllDisplays();
}

function applyGlobalFromSettings(s) {
    if (s.plexServerUrl) globalSettings.plexServerUrl = s.plexServerUrl;
    if (s.plexToken) globalSettings.plexToken = s.plexToken;
    if (s.clientName) globalSettings.clientName = s.clientName;
    if (s.playerUrl) globalSettings.playerUrl = s.playerUrl;
    if (s.syncOffset !== undefined) globalSettings.syncOffset = s.syncOffset;
    if (s.textColor) globalSettings.textColor = s.textColor;
    if (s.dynamicColors !== undefined) globalSettings.dynamicColors = s.dynamicColors;
    if (s.debugMode !== undefined) globalSettings.debugMode = s.debugMode;
    updateLogLevel();
}

// ============================================
// BUTTON PRESS HANDLING
// ============================================
function onKeyDown(data) {
    var ctx = data.context, action = data.action;
    buttonHoldState[ctx] = { pressTime: Date.now(), action: action, seekInterval: null, didSeek: false };

    if (action === "com.dreadheadhippy.ampdeck.previous" || action === "com.dreadheadhippy.ampdeck.next") {
        setTimeout(function() {
            if (buttonHoldState[ctx] && !buttonHoldState[ctx].didSeek) {
                buttonHoldState[ctx].didSeek = true;
                var dir = action.indexOf("previous") >= 0 ? -1 : 1;
                seekTrack(dir * SEEK_AMOUNT);
                buttonHoldState[ctx].seekInterval = setInterval(function() { seekTrack(dir * SEEK_AMOUNT); }, SEEK_INTERVAL);
            }
        }, HOLD_THRESHOLD);
    }
}

function onKeyUp(data) {
    var ctx = data.context, action = data.action, hs = buttonHoldState[ctx];
    if (hs && hs.seekInterval) clearInterval(hs.seekInterval);

    if (!hs || !hs.didSeek) {
        if (action === "com.dreadheadhippy.ampdeck.album-art" || action === "com.dreadheadhippy.ampdeck.play-pause") togglePlayPause();
        else if (action === "com.dreadheadhippy.ampdeck.previous") skipPrevious();
        else if (action === "com.dreadheadhippy.ampdeck.next") skipNext();
        else if (action === "com.dreadheadhippy.ampdeck.shuffle") toggleShuffle();
        else if (action === "com.dreadheadhippy.ampdeck.repeat") cycleRepeat();
        else if (action === "com.dreadheadhippy.ampdeck.rating") cycleRating(ctx);
    }
    delete buttonHoldState[ctx];
}

// ============================================
// DIAL HANDLING (Stream Deck+ encoders)
// ============================================
function onDialRotate(data) {
    var ctx = data.context;
    var settings = actions[ctx] ? actions[ctx].settings : {};
    var dialAction = settings.dialAction || "none";
    var ticks = data.payload.ticks || 0;

    if (dialAction === "skip") {
        if (ticks > 0) {
            skipNext();
            showStripOverlay(ctx, "NEXT", "▶▶");
        } else if (ticks < 0) {
            skipPrevious();
            showStripOverlay(ctx, "PREVIOUS", "◀◀");
        }
    } else if (dialAction === "volume") {
        var newVolume = Math.max(0, Math.min(100, currentVolume + (ticks * VOLUME_STEP)));
        debugLog("[VOLUME]", "Adjusting volume from " + currentVolume + " to " + newVolume);
        setVolume(newVolume);
        debugLog("[VOLUME]", "Calling showStripOverlay");
        showStripOverlay(ctx, "VOLUME", newVolume + "%");
    } else if (dialAction === "rating") {
        debugLog("[RATING]", "Rating dial action triggered");
        debugLog("[RATING]", "Ticks: " + ticks + " (direction: " + (ticks > 0 ? "clockwise" : "counter-clockwise") + ")");
        debugLog("[RATING]", "currentTrack:", currentTrack);
        debugLog("[RATING]", "currentRating before change: " + currentRating);
        if (!currentTrack) {
            debugLog("[RATING]", "ERROR: No current track!");
            return;
        }
        debugLog("[RATING]", "Track ratingKey: " + currentTrack.ratingKey);
        var ratingMode = settings.ratingMode || "half";
        var step = ratingMode === "half" ? RATING_HALF_STAR : RATING_FULL_STAR;
        debugLog("[RATING]", "Rating mode: " + ratingMode + ", step: " + step);
        var newRating = Math.max(0, Math.min(10, currentRating + (ticks * step)));
        debugLog("[RATING]", "Calculation: " + currentRating + " + (" + ticks + " * " + step + ") = " + (currentRating + (ticks * step)) + " -> clamped to " + newRating);
        
        // Update rating locally (don't save yet)
        currentRating = newRating;
        lastRatingChangeTime = Date.now();
        
        // Store this rating for this track to handle Plex cache delays
        if (currentTrack && currentTrack.ratingKey) {
            userSetRatings[currentTrack.ratingKey] = newRating;
        }
        
        // Show overlay immediately
        var stars = formatRating(newRating, ratingMode);
        debugLog("[RATING]", "Formatted stars: " + stars);
        showStripOverlay(ctx, "RATING", stars);
        
        // Cancel any existing save timer
        if (ratingSaveTimer) {
            clearTimeout(ratingSaveTimer);
            debugLog("[RATING]", "Cancelled previous save timer");
        }
        
        // Start new timer to save after 2 seconds of inactivity
        pendingRatingContext = ctx;
        ratingSaveTimer = setTimeout(function() {
            debugLog("[RATING]", "Save timer expired, saving rating now");
            setRating(currentRating, pendingRatingContext);
            ratingSaveTimer = null;
            pendingRatingContext = null;
        }, 2000);
        debugLog("[RATING]", "Started 2-second save timer");
    }
}

function onDialDown(data) {
    var ctx = data.context;
    var settings = actions[ctx] ? actions[ctx].settings : {};
    var dialAction = settings.dialAction || "none";
    var dialPressAction = settings.dialPressAction || "playpause";

    if (dialAction === "none") return;

    if (dialPressAction === "playpause") {
        togglePlayPause();
        showStripOverlay(ctx, playbackState === "playing" ? "PLAYING" : "PAUSED", "");
    } else if (dialPressAction === "shuffle") {
        toggleShuffle();
        showStripOverlay(ctx, "SHUFFLE", currentShuffle ? "ON" : "OFF");
    } else if (dialPressAction === "repeat") {
        cycleRepeat();
        var repeatLabels = { 0: "OFF", 1: "ONE", 2: "ALL" };
        showStripOverlay(ctx, "REPEAT", repeatLabels[currentRepeat] || "OFF");
    }
}

// ============================================
// TOUCH TAP (touch strip play/pause)
// ============================================
function onTouchTap(data) {
    var ctx = data.context;
    togglePlayPause();
    showStripOverlay(ctx, playbackState === "playing" ? "PLAYING" : "PAUSED", "");
}

// ============================================
// TOUCH STRIP OVERLAY
// ============================================
function showStripOverlay(ctx, text, subtext) {
    debugLog("[OVERLAY]", "showStripOverlay called - text: " + text + ", subtext: " + subtext);
    if (!stripOverlays[ctx]) stripOverlays[ctx] = { active: false, text: "", subtext: "", timer: null };
    var ov = stripOverlays[ctx];
    if (ov.timer) {
        debugLog("[OVERLAY]", "Clearing existing timer");
        clearTimeout(ov.timer);
    }
    ov.active = true;
    ov.text = text;
    ov.subtext = subtext;
    debugLog("[OVERLAY]", "State set, calling updateAllDisplays");
    updateAllDisplays();
    ov.timer = setTimeout(function() {
        debugLog("[OVERLAY]", "Timer fired - clearing overlay and reverting");
        ov.active = false;
        ov.timer = null;
        lastLayoutState[ctx] = null;
        updateAllDisplays();
    }, 1500);
}

// ============================================
// PLAYBACK COMMANDS (Local Player API)
// ============================================
function playerCommand(path, extraParams) {
    var playerUrl = getPlayerUrl();
    var cmdId = getNextCommandID();
    var url = playerUrl + path;

    var params = "commandID=" + cmdId;
    if (extraParams) params += "&" + extraParams;

    if (url.indexOf("?") >= 0) url += "&" + params;
    else url += "?" + params;

    logDebug("Player command: " + url);

    return fetch(url, {
        headers: { "X-Plex-Client-Identifier": CLIENT_IDENTIFIER }
    }).then(function(r) {
        if (!r.ok) {
            logError("Player command failed: HTTP " + r.status + " for " + path);
            return serverCommand(path, extraParams);
        }
        logDebug("Player command OK: " + path);
        localPlayerConnected = true;
        return r;
    }).catch(function(e) {
        logWarn("Player command error (" + path + "): " + e.message + ". Falling back to server.");
        localPlayerConnected = false;
        return serverCommand(path, extraParams);
    });
}

function serverCommand(path, extraParams) {
    var machineId = getClientId();
    if (!machineId || !globalSettings.plexServerUrl || !globalSettings.plexToken) {
        logError("Server command failed: missing machineId, server URL, or token");
        return Promise.reject(new Error("Missing server config"));
    }

    var url = globalSettings.plexServerUrl + path + "?commandID=1"
        + "&X-Plex-Target-Client-Identifier=" + machineId;

    if (extraParams) url += "&" + extraParams;

    logDebug("Server fallback command: " + url);

    return fetch(url, {
        headers: createSecureHeaders(true)
    }).then(function(r) {
        if (!r.ok) logError("Server command failed: HTTP " + r.status + " for " + path);
        else logDebug("Server command OK: " + path);
        return r;
    }).catch(function(e) {
        logError("Server command error (" + path + "): " + e.message);
    });
}

function getClientId() {
    if (currentTrack && currentTrack.Player) return currentTrack.Player.machineIdentifier;
    return null;
}

function togglePlayPause() {
    if (playbackState === "stopped") return;
    var cmd = playbackState === "playing" ? "pause" : "play";
    playerCommand("/player/playback/" + cmd);

    if (playbackState === "playing") {
        playbackState = "paused";
        lastPositionTimestamp = 0;
    } else {
        playbackState = "playing";
        lastPositionTimestamp = Date.now();
    }
    updateDisplayPosition();
    updateAllDisplays();
}

function skipNext() {
    playerCommand("/player/playback/skipNext");
}

function skipPrevious() {
    playerCommand("/player/playback/skipPrevious");
}

function seekTrack(offsetMs) {
    var newPos = Math.max(0, Math.min(currentPosition + offsetMs, trackDuration));
    playerCommand("/player/playback/seekTo", "offset=" + Math.round(newPos)).then(function() {
        currentPosition = newPos;
        lastPositionTimestamp = Date.now();
        updateDisplayPosition();
        updateAllDisplays();
    });
}

function setVolume(level) {
    currentVolume = Math.max(0, Math.min(100, level));
    playerCommand("/player/playback/setParameters", "volume=" + currentVolume).then(function() {
        logDebug("Volume set: " + currentVolume);
    });
}

function toggleShuffle() {
    currentShuffle = currentShuffle ? 0 : 1;
    playerCommand("/player/playback/setParameters", "shuffle=" + currentShuffle).then(function() {
        logDebug("Shuffle: " + (currentShuffle ? "ON" : "OFF"));
    });
    updateAllDisplays();
}

function cycleRepeat() {
    // Plex API: 0=Off, 1=One track, 2=All/Queue
    // Cycle: Off(0) → All(2) → One(1) → Off(0)
    if (currentRepeat === 0) currentRepeat = 2;
    else if (currentRepeat === 2) currentRepeat = 1;
    else currentRepeat = 0;
    playerCommand("/player/playback/setParameters", "repeat=" + currentRepeat).then(function() {
        var labels = { 0: "Off", 1: "One", 2: "All" };
        logDebug("Repeat: " + labels[currentRepeat]);
    });
    updateAllDisplays();
}

function cycleRating(ctx) {
    if (!currentTrack || !currentTrack.ratingKey) {
        logWarn("Cannot rate: No current track");
        return;
    }
    
    // Get rating mode from button settings
    var settings = actions[ctx] ? actions[ctx].settings : {};
    var ratingMode = settings.ratingMode || "half";
    var step = ratingMode === "half" ? RATING_HALF_STAR : RATING_FULL_STAR;
    
    // Cycle through ratings: 0 → step → 2*step → ... → 10 → 0
    var newRating = currentRating + step;
    if (newRating > 10) newRating = 0;
    
    currentRating = newRating;
    lastRatingChangeTime = Date.now();
    
    // Store this rating for this track to handle Plex cache delays
    if (currentTrack && currentTrack.ratingKey) {
        userSetRatings[currentTrack.ratingKey] = newRating;
    }
    
    logDebug("Rating cycled to: " + (newRating / 2).toFixed(1) + " stars (" + newRating + "/10) [mode: " + ratingMode + "]");
    
    // Update display immediately
    updateAllDisplays();
    
    // Cancel any existing save timer
    if (ratingSaveTimer) {
        clearTimeout(ratingSaveTimer);
        debugLog("[RATING]", "Cancelled previous save timer (button press)");
    }
    
    // Start new timer to save after 2 seconds of inactivity (same as dial)
    pendingRatingContext = ctx;
    ratingSaveTimer = setTimeout(function() {
        debugLog("[RATING]", "Save timer expired (button), saving rating now");
        setRating(currentRating, pendingRatingContext);
        ratingSaveTimer = null;
        pendingRatingContext = null;
    }, 2000);
    debugLog("[RATING]", "Started 2-second save timer (button)");
}

function setRating(rating, ctx) {
    debugLog("[RATING]", "setRating called with: " + rating);
    if (!currentTrack || !currentTrack.ratingKey) {
        debugLog("[RATING]", "ERROR: No track or ratingKey. currentTrack:", currentTrack);
        if (ctx) showStripOverlay(ctx, "ERROR", "No Track");
        return;
    }
    
    // Update local state
    currentRating = Math.max(0, Math.min(10, rating));
    lastRatingChangeTime = Date.now();  // Mark when we changed it
    debugLog("[RATING]", "Setting currentRating to: " + currentRating);
    
    var serverUrl = globalSettings.plexServerUrl;
    var token = globalSettings.plexToken;
    
    debugLog("[RATING]", "Server URL: " + (serverUrl || "MISSING"));
    debugLog("[RATING]", "Token: " + (token ? "present" : "MISSING"));
    
    if (!serverUrl || !token) {
        debugLog("[RATING]", "ERROR: Missing server URL or token!");
        if (ctx) showStripOverlay(ctx, "ERROR", "No Server");
        return;
    }
    
    var ratingKey = currentTrack.ratingKey;
    var url = serverUrl + "/:/rate?key=" + ratingKey + "&identifier=com.plexapp.plugins.library&rating=" + currentRating;
    
    debugLog("[RATING]", "Sending PUT request to: " + url);
    
    fetch(url, { 
        method: "PUT",
        headers: {
            "Accept": "application/json",
            "X-Plex-Token": token
        }
    })
        .then(function(r) {
            if (!r.ok) {
                debugLog("[RATING]", "ERROR: HTTP " + r.status);
                // Show error on strip display
                if (ctx) showStripOverlay(ctx, "ERROR", "HTTP " + r.status);
                return r.text().then(function(text) {
                    debugLog("[RATING]", "Response body: " + text);
                });
            } else {
                debugLog("[RATING]", "SUCCESS: HTTP " + r.status + ", Rating set to " + currentRating);
                // Update the track's userRating immediately so it's in sync
                if (currentTrack) {
                    currentTrack.userRating = currentRating;
                }
                // Note: Not polling timeline immediately as Plex cache may not be updated yet
                // The grace period mechanism will prevent stale data from overwriting our change
                // Success: no overlay shown, rating persists visibly on dial/button
            }
        })
        .catch(function(e) {
            debugLog("[RATING]", "ERROR: " + e.message);
            // Show fetch error on strip display
            if (ctx) showStripOverlay(ctx, "FETCH ERR", e.message.substring(0, 20));
        });
}

function formatRating(rating, mode) {
    // rating is 0-10, where 2 = 1 star, 10 = 5 stars
    if (rating === 0) return "☆☆☆☆☆";
    
    var fullStars = Math.floor(rating / 2);
    var hasHalfStar = mode === "half" && (rating % 2 === 1);
    var emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    
    var result = "";
    for (var j = 0; j < fullStars; j++) result += "★";
    if (hasHalfStar) result += "⯨";
    for (var k = 0; k < emptyStars; k++) result += "☆";
    
    return result;
}

function saveGlobalSettings() {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ event: "setGlobalSettings", context: pluginUUID, payload: globalSettings }));
    }
}

// ============================================
// TIMELINE POLL (Real-time playback data)
// ============================================
function pollTimeline() {
    var playerUrl = getPlayerUrl();
    var cmdId = getNextCommandID();
    var url = playerUrl + "/player/timeline/poll?wait=0&commandID=" + cmdId + "&includeMetadata=1";

    logDebug("Timeline poll: " + url);

    fetch(url, {
        headers: { "X-Plex-Client-Identifier": CLIENT_IDENTIFIER }
    })
    .then(function(r) {
        if (!r.ok) {
            logWarn("Timeline poll failed: HTTP " + r.status + ". Falling back to server poll.");
            localPlayerConnected = false;
            pollPlexServer();
            return null;
        }
        localPlayerConnected = true;
        return r.text();
    })
    .then(function(xmlText) {
        if (!xmlText) return;
        processTimeline(xmlText);
    })
    .catch(function(e) {
        logWarn("Timeline poll error: " + e.message + ". Falling back to server poll.");
        localPlayerConnected = false;
        pollPlexServer();
    });
}

function processTimeline(xmlText) {
    logDebug("Timeline XML received (" + xmlText.length + " chars)");

    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlText, "text/xml");

    var timelines = doc.querySelectorAll("Timeline");
    var musicTimeline = null;
    for (var i = 0; i < timelines.length; i++) {
        if (timelines[i].getAttribute("type") === "music") {
            musicTimeline = timelines[i];
            break;
        }
    }

    if (!musicTimeline) {
        logDebug("No music timeline found");
        handleNoSession();
        return;
    }

    var state = musicTimeline.getAttribute("state") || "stopped";

    if (state === "stopped") {
        logDebug("Music timeline state: stopped");
        handleNoSession();
        return;
    }

    var time = parseInt(musicTimeline.getAttribute("time")) || 0;
    var duration = parseInt(musicTimeline.getAttribute("duration")) || 0;
    var volume = parseInt(musicTimeline.getAttribute("volume"));
    var ratingKey = musicTimeline.getAttribute("ratingKey");
    var shuffle = musicTimeline.getAttribute("shuffle");
    var repeat = musicTimeline.getAttribute("repeat");

    var machineIdentifier = musicTimeline.getAttribute("machineIdentifier");
    var address = musicTimeline.getAttribute("address");
    var port = musicTimeline.getAttribute("port");
    var protocol = musicTimeline.getAttribute("protocol");
    var token = musicTimeline.getAttribute("token");

    var newState = state === "buffering" ? "playing" : state;
    playbackState = newState;
    currentPosition = time;
    trackDuration = duration;
    lastPositionTimestamp = (newState === "playing") ? Date.now() : 0;

    if (!isNaN(volume)) currentVolume = volume;
    if (shuffle !== null) currentShuffle = parseInt(shuffle) || 0;
    if (repeat !== null) currentRepeat = parseInt(repeat) || 0;

    var trackElements = doc.querySelectorAll("Track");
    var trackEl = trackElements.length > 0 ? trackElements[0] : null;

    var trackChanged = ratingKey !== lastTimelineRatingKey;
    
    // If track is changing and there's a pending rating save, flush it immediately
    if (trackChanged && ratingSaveTimer) {
        clearTimeout(ratingSaveTimer);
        debugLog("[RATING]", "Track changing, flushing pending rating save immediately");
        setRating(currentRating, pendingRatingContext);
        ratingSaveTimer = null;
        pendingRatingContext = null;
    }
    
    lastTimelineRatingKey = ratingKey;

    if (trackEl) {
        logDebug("Timeline includes metadata for track: " + (trackEl.getAttribute("title") || "unknown"));
        updateTrackFromTimelineMetadata(trackEl, machineIdentifier, address, port, protocol, token);
    } else if (trackChanged && ratingKey) {
        logDebug("Track changed (ratingKey: " + ratingKey + "), fetching metadata from server");
        fetchTrackMetadata(ratingKey, machineIdentifier, address, port, protocol, token);
    }

    updateDisplayPosition();
    updateAllDisplays();
}

function updateTrackFromTimelineMetadata(trackEl, machineId, address, port, protocol, token) {
    var track = {
        title: trackEl.getAttribute("title") || "Unknown",
        grandparentTitle: trackEl.getAttribute("grandparentTitle") || "Unknown",
        parentTitle: trackEl.getAttribute("parentTitle") || "Unknown",
        ratingKey: trackEl.getAttribute("ratingKey"),
        parentRatingKey: trackEl.getAttribute("parentRatingKey"),
        index: trackEl.getAttribute("index"),
        duration: parseInt(trackEl.getAttribute("duration")) || trackDuration,
        userRating: parseInt(trackEl.getAttribute("userRating")) || 0,
        type: "track",
        Player: {
            machineIdentifier: machineId,
            state: playbackState,
            product: "Plexamp"
        }
    };

    var mediaEl = trackEl.querySelector("Media");
    if (mediaEl) {
        track.Media = [{
            audioCodec: mediaEl.getAttribute("audioCodec") || "",
            bitrate: parseInt(mediaEl.getAttribute("bitrate")) || 0,
            audioChannels: parseInt(mediaEl.getAttribute("audioChannels")) || 0
        }];
        var partEl = mediaEl.querySelector("Part");
        if (partEl) {
            var streamEl = partEl.querySelector("Stream");
            if (streamEl) {
                track.Media[0].samplingRate = parseInt(streamEl.getAttribute("samplingRate")) || 0;
                track.Media[0].bitDepth = parseInt(streamEl.getAttribute("bitDepth")) || 0;
            }
        }
    }

    track.thumb = trackEl.getAttribute("thumb") || "";
    track.parentThumb = trackEl.getAttribute("parentThumb") || "";
    track.grandparentThumb = trackEl.getAttribute("grandparentThumb") || "";

    var trackChanged = !currentTrack || currentTrack.ratingKey !== track.ratingKey;
    
    // Clear old rating overrides when track changes to prevent memory buildup
    if (trackChanged && currentTrack && currentTrack.ratingKey && userSetRatings[currentTrack.ratingKey] !== undefined) {
        delete userSetRatings[currentTrack.ratingKey];
        debugLog("[RATING]", "Cleared old rating override for previous track");
    }
    
    currentTrack = track;
    
    // Update rating with smart caching to handle Plex delays
    var incomingRating = track.userRating || 0;
    var userSetRating = userSetRatings[track.ratingKey];
    
    if (userSetRating !== undefined) {
        // We recently set a rating for this track
        if (incomingRating >= userSetRating) {
            // Plex has updated (or user rated higher elsewhere), accept it
            currentRating = incomingRating;
            delete userSetRatings[track.ratingKey];
            debugLog("[RATING]", "Plex cache updated, accepting rating: " + currentRating);
        } else {
            // Plex cache still stale, keep our local value
            currentRating = userSetRating;
            debugLog("[RATING]", "Plex cache stale (" + incomingRating + "), keeping local rating: " + currentRating);
        }
    } else {
        // No local override, accept from Plex
        currentRating = incomingRating;
        debugLog("[RATING]", "Updated currentRating from track: " + currentRating);
    }

    if (trackChanged) {
        albumTrackCount = null;
        if (track.parentRatingKey) fetchAlbumTrackCount(track.parentRatingKey);

        var artPath = track.thumb || track.parentThumb || track.grandparentThumb;
        if (artPath && artPath !== lastArtPath) {
            lastArtPath = artPath;
            fetchAlbumArtFromTimeline(artPath, address, port, protocol, token);
        }
    }
}

function fetchTrackMetadata(ratingKey, machineId, address, port, protocol, token) {
    var serverUrl = globalSettings.plexServerUrl;
    var serverToken = globalSettings.plexToken;

    if (address && port && protocol && token) {
        serverUrl = protocol + "://" + address + ":" + port;
        serverToken = token;
    }

    if (!serverUrl || !serverToken) {
        logWarn("Cannot fetch metadata: no server connection info");
        return;
    }

    var url = serverUrl + "/library/metadata/" + ratingKey;
    logDebug("Fetching track metadata: " + url);

    fetch(url, { 
        headers: { 
            "Accept": "application/json",
            "X-Plex-Token": serverToken
        } 
    })
        .then(function(r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        })
        .then(function(data) {
            if (data && data.MediaContainer && data.MediaContainer.Metadata && data.MediaContainer.Metadata.length > 0) {
                var meta = data.MediaContainer.Metadata[0];
                meta.Player = {
                    machineIdentifier: machineId || getClientId(),
                    state: playbackState,
                    product: "Plexamp"
                };
                currentTrack = meta;
                
                // Update rating with smart caching to handle Plex delays
                var incomingRating = meta.userRating || 0;
                var userSetRating = userSetRatings[meta.ratingKey];
                
                if (userSetRating !== undefined) {
                    // We recently set a rating for this track
                    if (incomingRating >= userSetRating) {
                        // Plex has updated (or user rated higher elsewhere), accept it
                        currentRating = incomingRating;
                        delete userSetRatings[meta.ratingKey];
                        debugLog("[RATING]", "Plex cache updated from metadata, accepting: " + currentRating);
                    } else {
                        // Plex cache still stale, keep our local value
                        currentRating = userSetRating;
                        debugLog("[RATING]", "Plex metadata cache stale, keeping local: " + currentRating);
                    }
                } else {
                    // No local override, accept from Plex
                    currentRating = incomingRating;
                    debugLog("[RATING]", "Updated currentRating from metadata: " + currentRating);
                }
                
                serverConnected = true;

                albumTrackCount = null;
                if (meta.parentRatingKey) fetchAlbumTrackCount(meta.parentRatingKey);

                var artPath = meta.thumb || meta.parentThumb || meta.grandparentThumb;
                if (artPath && artPath !== lastArtPath) {
                    lastArtPath = artPath;
                    fetchAlbumArt(artPath);
                }

                updateAllDisplays();
            }
        })
        .catch(function(e) {
            logError("Metadata fetch error: " + e.message);
        });
}

function fetchAlbumArtFromTimeline(thumbPath, address, port, protocol, token) {
    var serverUrl = globalSettings.plexServerUrl;
    var serverToken = globalSettings.plexToken;

    if (address && port && protocol && token) {
        serverUrl = protocol + "://" + address + ":" + port;
        serverToken = token;
    }

    if (!serverUrl || !serverToken) {
        logWarn("Cannot fetch album art: no server connection info");
        return;
    }

    var url = serverUrl + thumbPath;
    logDebug("Fetching album art: " + url);

    fetch(url, {
        headers: {
            "X-Plex-Token": serverToken
        }
    })
        .then(function(r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.blob();
        })
        .then(function(blob) {
            var reader = new FileReader();
            reader.onloadend = function() {
                currentAlbumArt = reader.result;
                extractDominantColor(currentAlbumArt).then(function(color) {
                    dominantColor = color;
                    updateDisplayPosition();
                    updateAllDisplays();
                });
            };
            reader.readAsDataURL(blob);
        })
        .catch(function(e) {
            logError("Album art fetch error: " + e.message);
        });
}

function handleNoSession() {
    if (currentTrack !== null || playbackState !== "stopped") {
        currentTrack = null;
        playbackState = "stopped";
        currentPosition = 0;
        lastPositionTimestamp = 0;
        trackDuration = 0;
        albumTrackCount = null;
        lastParentRatingKey = null;
        lastTimelineRatingKey = null;
        lastArtPath = null;
        currentAlbumArt = null;
        dominantColor = "#E5A00D";
        currentShuffle = 0;
        currentRepeat = 0;
        currentRating = 0;
        userSetRatings = {}; // Clear all cached ratings when no session
        updateDisplayPosition();
        updateAllDisplays();
    }
}

// ============================================
// SERVER POLL FALLBACK
// ============================================
function pollPlexServer() {
    if (!globalSettings.plexToken || !globalSettings.plexServerUrl) {
        logDebug("Server poll skipped: missing token or URL");
        return;
    }

    logDebug("Falling back to server session poll");

    fetch(globalSettings.plexServerUrl + "/status/sessions", { 
        headers: { 
            "Accept": "application/json",
            "X-Plex-Token": globalSettings.plexToken
        } 
    })
        .then(function(r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            serverConnected = true;
            return r.json();
        })
        .then(function(data) {
            var track = findPlexampSession(data);

            if (track) {
                var newState = track.Player ? (track.Player.state || "playing") : "playing";
                var newDuration = track.duration || 0;
                var newPosition = track.viewOffset || 0;
                var trackChanged = !currentTrack || currentTrack.ratingKey !== track.ratingKey;

                // If track is changing and there's a pending rating save, flush it immediately
                if (trackChanged && ratingSaveTimer) {
                    clearTimeout(ratingSaveTimer);
                    debugLog("[RATING]", "Track changing (server poll), flushing pending rating save immediately");
                    setRating(currentRating, pendingRatingContext);
                    ratingSaveTimer = null;
                    pendingRatingContext = null;
                }

                // Clear old rating overrides when track changes
                if (trackChanged && currentTrack && currentTrack.ratingKey && userSetRatings[currentTrack.ratingKey] !== undefined) {
                    delete userSetRatings[currentTrack.ratingKey];
                    debugLog("[RATING]", "Cleared old rating override for previous track (server poll)");
                }

                var syncOffset = globalSettings.syncOffset !== undefined ? parseInt(globalSettings.syncOffset) : 0;
                currentPosition = newPosition + syncOffset;
                lastPositionTimestamp = (newState === "playing") ? Date.now() : 0;

                playbackState = newState;
                trackDuration = newDuration;
                currentTrack = track;
                
                // Update rating with smart caching to handle Plex delays
                var incomingRating = track.userRating || 0;
                var userSetRating = userSetRatings[track.ratingKey];
                
                if (userSetRating !== undefined) {
                    // We recently set a rating for this track
                    if (incomingRating >= userSetRating) {
                        // Plex has updated, accept it
                        currentRating = incomingRating;
                        delete userSetRatings[track.ratingKey];
                        debugLog("[RATING]", "Server poll: Plex updated, accepting: " + currentRating);
                    } else {
                        // Plex cache still stale, keep our local value
                        currentRating = userSetRating;
                        debugLog("[RATING]", "Server poll: keeping local rating: " + currentRating);
                    }
                } else {
                    currentRating = incomingRating;
                }

                if (trackChanged) {
                    albumTrackCount = null;
                    fetchAlbumTrackCount(track.parentRatingKey);
                    var artPath = track.thumb || track.parentThumb || track.grandparentThumb;
                    if (artPath && artPath !== lastArtPath) {
                        lastArtPath = artPath;
                        fetchAlbumArt(artPath);
                    }
                }
            } else {
                handleNoSession();
            }
        })
        .catch(function(e) {
            logError("Server poll error: " + e.message);
            serverConnected = false;
        });
}

function findPlexampSession(data) {
    if (!data || !data.MediaContainer || !data.MediaContainer.Metadata) return null;
    var clientName = globalSettings.clientName || "";
    var list = data.MediaContainer.Metadata;
    for (var i = 0; i < list.length; i++) {
        if (list[i].type === "track" && list[i].Player) {
            if (list[i].Player.title === clientName || list[i].Player.product === "Plexamp") {
                return list[i];
            }
        }
    }
    return null;
}

// ============================================
// PLEX SERVER API (metadata, art, track count)
// ============================================
function fetchAlbumTrackCount(parentRatingKey) {
    if (!parentRatingKey || !globalSettings.plexServerUrl || !globalSettings.plexToken) return;
    if (parentRatingKey === lastParentRatingKey && albumTrackCount !== null) return;

    lastParentRatingKey = parentRatingKey;
    albumTrackCount = null;

    var url = globalSettings.plexServerUrl + "/library/metadata/" + parentRatingKey + "/children";
    fetch(url, { 
        headers: { 
            "Accept": "application/json",
            "X-Plex-Token": globalSettings.plexToken
        } 
    })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data && data.MediaContainer && data.MediaContainer.size) {
                albumTrackCount = data.MediaContainer.size;
                logDebug("Album tracks: " + albumTrackCount);
            }
        })
        .catch(function(e) { logError("Track count error: " + e.message); });
}

function fetchAlbumArt(thumbPath) {
    if (!globalSettings.plexServerUrl || !globalSettings.plexToken) return;

    var url = globalSettings.plexServerUrl + thumbPath;
    logDebug("Fetching album art (server): " + url);

    fetch(url, {
        headers: {
            "X-Plex-Token": globalSettings.plexToken
        }
    })
        .then(function(r) {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.blob();
        })
        .then(function(blob) {
            var reader = new FileReader();
            reader.onloadend = function() {
                currentAlbumArt = reader.result;
                extractDominantColor(currentAlbumArt).then(function(color) {
                    dominantColor = color;
                    updateDisplayPosition();
                    updateAllDisplays();
                });
            };
            reader.readAsDataURL(blob);
        })
        .catch(function(e) { logError("Art error: " + e.message); });
}

// ============================================
// DISPLAY UPDATES
// ============================================
function updateAllDisplays() {
    for (var ctx in actions) {
        var action = actions[ctx].action;
        if (action === "com.dreadheadhippy.ampdeck.album-art") updateAlbumArtButton(ctx);
        else if (action === "com.dreadheadhippy.ampdeck.strip") updateStripDisplay(ctx);
        else if (action === "com.dreadheadhippy.ampdeck.play-pause") updatePlayPauseButton(ctx);
        else if (action === "com.dreadheadhippy.ampdeck.info") updateInfoButton(ctx);
        else if (action === "com.dreadheadhippy.ampdeck.time") updateTimeButton(ctx);
        else if (action === "com.dreadheadhippy.ampdeck.rating") updateRatingButton(ctx);
        else if (action === "com.dreadheadhippy.ampdeck.shuffle") updateShuffleButton(ctx);
        else if (action === "com.dreadheadhippy.ampdeck.repeat") updateRepeatButton(ctx);
    }
}

function updateAlbumArtButton(ctx) {
    var canvas = document.createElement("canvas");
    canvas.width = 144; canvas.height = 144;
    var c = canvas.getContext("2d");
    c.fillStyle = "#000000";
    c.fillRect(0, 0, 144, 144);

    if (!currentAlbumArt) {
        c.fillStyle = "#333333";
        c.textAlign = "center";
        c.font = "14px sans-serif";
        c.fillText("No Track", 72, 76);
        setImage(ctx, canvas.toDataURL("image/png"));
        return;
    }

    var img = new Image();
    img.onload = function() {
        c.drawImage(img, 0, 0, 144, 144);
        if (playbackState === "paused") {
            c.fillStyle = "rgba(0,0,0,0.4)";
            c.fillRect(0, 0, 144, 144);
            c.fillStyle = "#FFFFFF";
            c.fillRect(52, 47, 14, 50);
            c.fillRect(78, 47, 14, 50);
        }
        setImage(ctx, canvas.toDataURL("image/png"));
    };
    img.src = currentAlbumArt;
}

function updatePlayPauseButton(ctx) {
    var canvas = document.createElement("canvas");
    canvas.width = 144; canvas.height = 144;
    var c = canvas.getContext("2d");
    c.fillStyle = "#000000";
    c.fillRect(0, 0, 144, 144);

    var textColor = getTextColor();

    if (playbackState === "stopped") {
        c.fillStyle = "#333333";
        c.beginPath();
        c.moveTo(50, 42); c.lineTo(110, 72); c.lineTo(50, 102);
        c.closePath(); c.fill();
    } else if (playbackState === "playing") {
        c.fillStyle = textColor;
        c.fillRect(45, 42, 18, 60);
        c.fillRect(81, 42, 18, 60);
    } else {
        c.fillStyle = textColor;
        c.beginPath();
        c.moveTo(50, 42); c.lineTo(110, 72); c.lineTo(50, 102);
        c.closePath(); c.fill();
    }
    setImage(ctx, canvas.toDataURL("image/png"));
}

function updateInfoButton(ctx) {
    var canvas = document.createElement("canvas");
    canvas.width = 144; canvas.height = 144;
    var c = canvas.getContext("2d");
    c.fillStyle = "#000000";
    c.fillRect(0, 0, 144, 144);

    var textColor = getTextColor();
    var secondaryColor = getSecondaryTextColor();
    var accentColor = getAccentColor();

    if (currentTrack) {
        var media = currentTrack.Media && currentTrack.Media[0];
        var format = media && media.audioCodec ? media.audioCodec.toUpperCase() : "---";
        var bitrate = media && media.bitrate ? Math.round(media.bitrate) + " kbps" : "";
        var trackNum = currentTrack.index || "?";
        var totalTracks = albumTrackCount || "?";

        c.textAlign = "center";
        c.font = "bold 28px sans-serif";
        c.fillStyle = textColor;
        c.fillText(format, 72, 32);

        c.font = "bold 22px sans-serif";
        c.fillStyle = accentColor;
        c.fillText(bitrate, 72, 65);

        c.font = "bold 24px sans-serif";
        c.fillStyle = textColor;
        c.fillText("TRACK", 72, 95);

        c.font = "bold 32px sans-serif";
        c.fillStyle = accentColor;
        c.fillText(trackNum + "/" + totalTracks, 72, 132);
    } else {
        c.fillStyle = "#333333";
        c.textAlign = "center";
        c.font = "16px sans-serif";
        c.fillText("No Track", 72, 76);
    }
    setImage(ctx, canvas.toDataURL("image/png"));
}

function updateTimeButton(ctx) {
    var canvas = document.createElement("canvas");
    canvas.width = 144; canvas.height = 144;
    var c = canvas.getContext("2d");
    c.fillStyle = "#000000";
    c.fillRect(0, 0, 144, 144);

    var textColor = getTextColor();
    var secondaryColor = getSecondaryTextColor();
    var accentColor = getAccentColor();

    if (playbackState === "stopped") {
        c.textAlign = "center";
        c.font = "bold 36px sans-serif";
        c.fillStyle = "#333333";
        c.fillText("0:00", 72, 55);
        c.font = "20px sans-serif";
        c.fillText("/ 0:00", 72, 82);
        c.fillStyle = "#333333";
        c.fillRect(15, 113, 114, 10);
    } else {
        c.textAlign = "center";
        c.font = "bold 36px sans-serif";
        c.fillStyle = textColor;
        c.fillText(formatTime(currentPosition), 72, 55);

        c.font = "bold 36px sans-serif";
        c.fillStyle = accentColor;
        c.fillText("/ " + formatTime(trackDuration), 72, 98);

        c.fillStyle = "#333333";
        c.fillRect(15, 113, 114, 10);
        if (displayProgress > 0) {
            c.fillStyle = accentColor;
            c.fillRect(15, 113, (displayProgress / 100) * 114, 10);
        }
    }
    setImage(ctx, canvas.toDataURL("image/png"));
}

function updateRatingButton(ctx) {
    var canvas = document.createElement("canvas");
    canvas.width = 144; canvas.height = 144;
    var c = canvas.getContext("2d");
    c.fillStyle = "#000000";
    c.fillRect(0, 0, 144, 144);

    var settings = actions[ctx] ? actions[ctx].settings : {};
    var fontSize = parseInt(settings.ratingFontSize) || 48;
    var ratingMode = settings.ratingMode || "half";
    var displayStyle = settings.ratingDisplay || "stars";
    
    var textColor = getTextColor();
    var secondaryColor = getSecondaryTextColor();
    var accentColor = getAccentColor();

    if (currentTrack) {
        // Display "RATING" label at top
        c.textAlign = "center";
        c.font = "bold 26px sans-serif";
        c.fillStyle = textColor;
        c.fillText("RATING", 72, 32);

        // Display rating based on style preference
        var hasHalfStar = currentRating % 2 === 1;
        var numericRating;
        
        if (displayStyle === "stars") {
            // Stars only
            var stars = formatRating(currentRating, ratingMode);
            c.font = "bold " + fontSize + "px sans-serif";
            c.fillStyle = accentColor;
            c.fillText(stars, 72, 90);
        } else if (displayStyle === "numeric") {
            // Numeric only (e.g., "4.5" or "4")
            c.font = "bold " + fontSize + "px sans-serif";
            c.textBaseline = "middle";
            c.fillStyle = accentColor;
            if (currentRating === 0) {
                c.fillText("0", 72, 90);
            } else {
                numericRating = hasHalfStar ? (currentRating / 2).toFixed(1) : (currentRating / 2).toString();
                c.fillText(numericRating, 72, 90);
            }
        } else {
            // Both - numeric with scale (e.g., "4.5/5" or "4/5")
            c.font = "bold " + fontSize + "px sans-serif";
            c.textBaseline = "middle";
            c.fillStyle = accentColor;
            if (currentRating === 0) {
                c.fillText("0/5", 72, 90);
            } else {
                numericRating = hasHalfStar ? (currentRating / 2).toFixed(1) : (currentRating / 2).toString();
                c.fillText(numericRating + "/5", 72, 90);
            }
        }
    } else {
        c.fillStyle = "#333333";
        c.textAlign = "center";
        c.font = "16px sans-serif";
        c.fillText("No Track", 72, 76);
    }
    setImage(ctx, canvas.toDataURL("image/png"));
}

function updateShuffleButton(ctx) {
    var canvas = document.createElement("canvas");
    canvas.width = 144; canvas.height = 144;
    var c = canvas.getContext("2d");
    c.fillStyle = "#000000";
    c.fillRect(0, 0, 144, 144);

    var isOn = currentShuffle === 1;
    var iconColor = isOn ? "#FFFFFF" : "#333333";

    // Crossing arrows
    c.strokeStyle = iconColor;
    c.lineWidth = 6;
    c.lineCap = "round";

    c.beginPath();
    c.moveTo(30, 52);
    c.lineTo(65, 52);
    c.lineTo(85, 86);
    c.lineTo(110, 86);
    c.stroke();

    c.beginPath();
    c.moveTo(30, 86);
    c.lineTo(65, 86);
    c.lineTo(85, 52);
    c.lineTo(110, 52);
    c.stroke();

    // Arrowheads
    c.fillStyle = iconColor;
    c.beginPath();
    c.moveTo(105, 41);
    c.lineTo(120, 52);
    c.lineTo(105, 63);
    c.closePath();
    c.fill();

    c.beginPath();
    c.moveTo(105, 75);
    c.lineTo(120, 86);
    c.lineTo(105, 97);
    c.closePath();
    c.fill();

    // State label - dynamic color, larger text
    if (isOn) {
        c.fillStyle = getAccentColor();
        c.font = "bold 16px sans-serif";
        c.textAlign = "center";
        c.fillText("ON", 72, 130);
    }

    setImage(ctx, canvas.toDataURL("image/png"));
}

function updateRepeatButton(ctx) {
    var canvas = document.createElement("canvas");
    canvas.width = 144; canvas.height = 144;
    var c = canvas.getContext("2d");
    c.fillStyle = "#000000";
    c.fillRect(0, 0, 144, 144);

    var isOn = currentRepeat > 0;
    var iconColor = isOn ? "#FFFFFF" : "#333333";

    // Loop shape - shifted up to make room for label
    c.strokeStyle = iconColor;
    c.lineWidth = 6;

    c.beginPath();
    c.moveTo(35, 48);
    c.lineTo(105, 48);
    c.quadraticCurveTo(118, 48, 118, 61);
    c.lineTo(118, 75);
    c.quadraticCurveTo(118, 88, 105, 88);
    c.lineTo(35, 88);
    c.quadraticCurveTo(22, 88, 22, 75);
    c.lineTo(22, 61);
    c.quadraticCurveTo(22, 48, 35, 48);
    c.stroke();

    // Arrow
    c.fillStyle = iconColor;
    c.beginPath();
    c.moveTo(95, 33);
    c.lineTo(115, 48);
    c.lineTo(95, 63);
    c.closePath();
    c.fill();

    // "1" badge inside loop for repeat-one - secondary gray
    if (currentRepeat === 1) {
        c.fillStyle = getSecondaryTextColor();
        c.font = "bold 28px sans-serif";
        c.textAlign = "center";
        c.fillText("1", 70, 78);
    }

    // State label - dynamic color, bold 16px (same as TRACK on info button)
    // Plex API: 1=One, 2=All
    if (currentRepeat === 2) {
        c.fillStyle = getAccentColor();
        c.font = "bold 16px sans-serif";
        c.textAlign = "center";
        c.fillText("ALL", 72, 128);
    } else if (currentRepeat === 1) {
        c.fillStyle = getAccentColor();
        c.font = "bold 16px sans-serif";
        c.textAlign = "center";
        c.fillText("ONE", 72, 128);
    }

    setImage(ctx, canvas.toDataURL("image/png"));
}

function updateStripDisplay(ctx) {
    var settings = actions[ctx].settings || {};

    // If overlay is active for THIS context, show overlay instead of normal content
    var ov = stripOverlays[ctx];
    if (ov && ov.active) {
        debugLog("[STRIP]", "Rendering overlay - text: " + ov.text);
        renderStripOverlay(ctx, ov, settings);
        return;
    }
    debugLog("[STRIP]", "Rendering normal display - mode: " + (settings.displayMode || "artist"));

    var displayMode = settings.displayMode || "artist";
    var fontSize = parseInt(settings.fontSize) || 16;
    var totalPanels = parseInt(settings.progressTotalPanels) || 3;
    var position = parseInt(settings.progressPosition) || 1;

    var textColor = settings.textColor || getTextColor();
    var accentColor = getAccentColor();

    var stripSecondary;
    if (textColor === "#FFFFFF") stripSecondary = "#999999";
    else if (textColor === "#BBBBBB") stripSecondary = "#777777";
    else if (textColor === "#E5A00D") stripSecondary = "#B07A0A";
    else if (textColor === "#FFBF00") stripSecondary = "#B08600";
    else if (textColor === "#000000") stripSecondary = "#444444";
    else stripSecondary = "#999999";

    var label = "", text = "";
    if (currentTrack) {
        if (displayMode === "artist") { label = "ARTIST"; text = currentTrack.grandparentTitle || "Unknown"; }
        else if (displayMode === "album") { label = "ALBUM"; text = currentTrack.parentTitle || "Unknown"; }
        else if (displayMode === "track") { label = "TRACK"; text = currentTrack.title || "Unknown"; }
        else if (displayMode === "time") { label = "TIME"; text = formatTime(currentPosition) + " / " + formatTime(trackDuration); }
    } else {
        label = displayMode.toUpperCase();
        text = displayMode === "time" ? "0:00 / 0:00" : "Not Playing";
    }

    var labelSize = Math.max(14, Math.round(fontSize * 0.85));
    var progressBar = createProgressBarSegment(position, totalPanels, displayProgress, accentColor);

    var pausedDim = playbackState === "paused";
    var labelColor = pausedDim ? stripSecondary : textColor;
    var textDisplayColor = pausedDim ? stripSecondary : textColor;

    // Always use pixmap for displayText so font/position is consistent
    var textAreaH = fontSize + 8;
    var layoutKey = "px|" + labelColor + "|" + labelSize + "|" + textAreaH;
    if (lastLayoutState[ctx] !== layoutKey) {
        lastLayoutState[ctx] = layoutKey;
        setFeedbackLayout(ctx, {
            "id": "com.dreadheadhippy.ampdeck.layout",
            "items": [
                { "key": "label", "type": "text", "rect": [0, 10, 200, labelSize + 4],
                  "font": { "size": labelSize, "weight": 700 },
                  "color": labelColor, "alignment": "center" },
                { "key": "displayText", "type": "pixmap", "rect": [0, 10 + labelSize + 6, 200, textAreaH] },
                { "key": "progressBar", "type": "pixmap", "rect": [0, 86, 200, 4] }
            ]
        });
    }

    // Check if text needs scrolling
    var font = fontSize + "px sans-serif";
    var needsScroll = measureTextWidth(text, font) > 190;

    var textImage;
    if (needsScroll) {
        textImage = renderScrollingText(ctx, text, fontSize, textDisplayColor);
    } else {
        if (stripScrollState[ctx]) delete stripScrollState[ctx];
        textImage = renderStaticText(text, fontSize, textDisplayColor);
    }

    setFeedback(ctx, { label: label, displayText: textImage, progressBar: progressBar });
}

// ============================================
// SCROLLING TEXT
// ============================================
var stripScrollState = {};
var SCROLL_SPEED = 30; // pixels per second
var SCROLL_PAUSE_MS = 2000; // pause at start/end before scrolling
var SCROLL_GAP = 40; // gap between end and repeat

function measureTextWidth(text, font) {
    var canvas = document.createElement("canvas");
    var c = canvas.getContext("2d");
    c.font = font;
    return c.measureText(text).width;
}

function renderStaticText(text, fontSize, color) {
    var canvasW = 200;
    var canvasH = fontSize + 8;
    var font = fontSize + "px sans-serif";

    var canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    var c = canvas.getContext("2d");
    c.clearRect(0, 0, canvasW, canvasH);
    c.font = font;
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "top";
    c.fillText(text, canvasW / 2, 2);

    return canvas.toDataURL("image/png");
}

function renderScrollingText(ctx, text, fontSize, color) {
    var canvasW = 200;
    var canvasH = fontSize + 8;
    var font = fontSize + "px sans-serif";

    // Get or create scroll state for this context
    if (!stripScrollState[ctx]) {
        stripScrollState[ctx] = { offset: 0, paused: true, pauseStart: Date.now(), lastTick: Date.now(), text: text };
    }

    var ss = stripScrollState[ctx];

    // Reset scroll if text changed
    if (ss.text !== text) {
        ss.offset = 0;
        ss.paused = true;
        ss.pauseStart = Date.now();
        ss.text = text;
    }

    var textW = measureTextWidth(text, font);
    var maxOffset = textW - canvasW + SCROLL_GAP;

    // Update scroll position
    var now = Date.now();
    var dt = (now - ss.lastTick) / 1000;
    ss.lastTick = now;

    if (ss.paused) {
        if (now - ss.pauseStart >= SCROLL_PAUSE_MS) {
            ss.paused = false;
        }
    } else {
        ss.offset += SCROLL_SPEED * dt;
        if (ss.offset >= maxOffset) {
            ss.offset = 0;
            ss.paused = true;
            ss.pauseStart = now;
        }
    }

    // Render
    var canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    var c = canvas.getContext("2d");
    c.clearRect(0, 0, canvasW, canvasH);
    c.font = font;
    c.fillStyle = color;
    c.textBaseline = "top";
    c.fillText(text, -ss.offset, 2);

    return canvas.toDataURL("image/png");
}

// ============================================
// STRIP OVERLAY
// ============================================
function renderStripOverlay(ctx, ov, settings) {
    var accentColor = getAccentColor();
    var fontSize = parseInt(settings.fontSize) || 16;
    var labelSize = Math.max(14, Math.round(fontSize * 0.85));
    var isPlayPause = (ov.text === "PLAYING" || ov.text === "PAUSED");

    // Label uses accent color, same position/size as normal strip label
    // Subtext area is a pixmap for icon rendering on play/pause
    var overlayKey = "overlay|" + accentColor + "|" + labelSize + "|" + fontSize + "|" + (isPlayPause ? "pp" : "std");
    if (lastLayoutState[ctx] !== overlayKey) {
        lastLayoutState[ctx] = overlayKey;

        setFeedbackLayout(ctx, {
            "id": "com.dreadheadhippy.ampdeck.layout",
            "items": [
                { "key": "label", "type": "text", "rect": [0, 10, 200, labelSize + 4],
                  "font": { "size": labelSize, "weight": 700 },
                  "color": accentColor, "alignment": "center" },
                { "key": "displayText", "type": "pixmap", "rect": [0, 10 + labelSize + 6, 200, fontSize + 16] },
                { "key": "progressBar", "type": "pixmap", "rect": [0, 86, 200, 4] }
            ]
        });
    }

    // Render subtext area as canvas
    var subtextH = fontSize + 16;
    var subtextCanvas = document.createElement("canvas");
    subtextCanvas.width = 200;
    subtextCanvas.height = subtextH;
    var sc = subtextCanvas.getContext("2d");
    sc.clearRect(0, 0, 200, subtextH);

    if (isPlayPause) {
        // Draw play or pause icon centered
        var iconSize = Math.min(subtextH - 4, 24);
        var cx = 100;
        var cy = subtextH / 2;

        sc.fillStyle = "#FFFFFF";
        if (ov.text === "PLAYING") {
            // Pause icon (two bars)
            var barW = Math.round(iconSize * 0.25);
            var barH = iconSize;
            var gap = Math.round(iconSize * 0.2);
            sc.fillRect(cx - gap - barW, cy - barH / 2, barW, barH);
            sc.fillRect(cx + gap, cy - barH / 2, barW, barH);
        } else {
            // Play icon (triangle)
            var triH = iconSize;
            var triW = Math.round(iconSize * 0.8);
            sc.beginPath();
            sc.moveTo(cx - triW / 2, cy - triH / 2);
            sc.lineTo(cx + triW / 2, cy);
            sc.lineTo(cx - triW / 2, cy + triH / 2);
            sc.closePath();
            sc.fill();
        }
    } else {
        // Standard text subtext
        sc.font = "bold " + fontSize + "px sans-serif";
        sc.fillStyle = "#FFFFFF";
        sc.textAlign = "center";
        sc.textBaseline = "middle";
        sc.fillText(ov.subtext, 100, subtextH / 2);
    }

    // Progress/volume/rating bar
    var barCanvas = document.createElement("canvas");
    barCanvas.width = 200; barCanvas.height = 4;
    var bc = barCanvas.getContext("2d");
    bc.fillStyle = "#333333";
    bc.fillRect(0, 0, 200, 4);

    if (ov.text === "VOLUME") {
        var fillW = Math.round((currentVolume / 100) * 200);
        if (fillW > 0) {
            bc.fillStyle = accentColor;
            bc.fillRect(0, 0, fillW, 4);
        }
    } else if (ov.text === "RATING") {
        // Show 5 segments for 5 stars
        var ratingFillW = Math.round((currentRating / 10) * 200);
        if (ratingFillW > 0) {
            bc.fillStyle = accentColor;
            bc.fillRect(0, 0, ratingFillW, 4);
        }
    }

    setFeedback(ctx, {
        label: ov.text,
        displayText: subtextCanvas.toDataURL("image/png"),
        progressBar: barCanvas.toDataURL("image/png")
    });
}

// ============================================
// HELPERS
// ============================================
function formatTime(ms) {
    if (!ms || ms <= 0) return "0:00";
    var sec = Math.floor(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
}

function createProgressBarSegment(position, totalPanels, progress, color) {
    var canvas = document.createElement("canvas");
    canvas.width = 200; canvas.height = 4;
    var c = canvas.getContext("2d");
    c.fillStyle = "#333333";
    c.fillRect(0, 0, 200, 4);

    if (position > 0 && position <= totalPanels) {
        var segSize = 100 / totalPanels;
        var segStart = (position - 1) * segSize;
        var segEnd = position * segSize;
        if (progress > segStart) {
            var pInSeg = Math.min(progress, segEnd) - segStart;
            var fillW = Math.round((pInSeg / segSize) * 200);
            if (fillW > 0) { c.fillStyle = color; c.fillRect(0, 0, fillW, 4); }
        }
    }
    return canvas.toDataURL("image/png");
}

// ============================================
// STREAM DECK API
// ============================================
function setImage(ctx, img) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ event: "setImage", context: ctx, payload: { image: img, target: 0 } }));
    }
}

function setFeedback(ctx, payload) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        debugLog("[FEEDBACK]", "Sending feedback - label: " + (payload.label || "none"));
        websocket.send(JSON.stringify({ event: "setFeedback", context: ctx, payload: payload }));
    } else {
        debugLog("[FEEDBACK]", "ERROR: Websocket not open! State: " + (websocket ? websocket.readyState : "null"));
    }
}

function setFeedbackLayout(ctx, layout) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({ event: "setFeedbackLayout", context: ctx, payload: { layout: layout } }));
    }
}

// ============================================
// POLLING CONTROL
// ============================================
function startPolling() {
    if (pollWorker) return;

    pollWorker = createTimerWorker(1000);
    pollWorker.onmessage = function() { pollTimeline(); };
    pollWorker.postMessage("start");

    renderWorker = createTimerWorker(200);
    renderWorker.onmessage = function() { renderTick(); };
    renderWorker.postMessage("start");

    pollTimeline();
    log("Started: timeline poll@1s, render@200ms");
}

function stopPolling() {
    terminateWorker(pollWorker); pollWorker = null;
    terminateWorker(renderWorker); renderWorker = null;
    log("Stopped polling");
}

log("Ampdeck v1.3.1 loaded");
