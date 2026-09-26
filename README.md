# Look here! — Photo sounds

A small, dependency-free website for playing attention sounds while taking a photo of a dog, cat, or baby.

## Use it

Open https://hasntbeenused.github.io/Pet-camera-focus-/ in your phone's browser.

1. Choose a sound and start with a low volume.
2. Tap **Play once**, or **Float over camera** and switch to your camera app.
3. In the floating player, **Play** plays the selected sound once; **Next** selects the next sound and plays it. **Pause** stops playback.
4. **Start loop** repeats the chosen pattern with 0.5–30 seconds of silence after it. **Float + loop** opens the floating player and starts repeating.
5. Record up to ten seconds, preview it, and choose **Save & use**. One custom recording is kept in this browser; saving another replaces it. **Delete recording** removes it.

Built-ins: soft chime, squeaky toy, clicker, kissy noise, bird chirp, gentle trill, and whistle. These are synthesized sounds. Single, double, burst, and random-per-trigger patterns are available. Random chooses a sound when playback is triggered; a loop repeats that chosen sound until restarted.

Recordings never leave the device. They are stored in IndexedDB and can disappear if browser/site data is cleared. Existing recordings and settings from the earlier version are retained. Microphone recording needs HTTPS or localhost.

## Compatibility

Floating video uses canvas capture, Web Audio, the video Picture-in-Picture API, and Media Session. Browsers decide which floating/system buttons to show. Next is not guaranteed to appear. On phones, the OS or camera app can interrupt audio or close the floating player. Physical-device testing with your camera app is still necessary; desktop browser checks cannot establish Android or iOS compatibility.

If floating video is unavailable, the main-page player still works. The Fullscreen video option in Help can also be tried with the Android Home button; it starts a loop so there is active media when switching apps. This fallback is browser-dependent. No claim is made that every sound attracts every subject; use a familiar voice or soft chime for a baby and stop if unwelcome.

Loop audio and silence are combined into a looping AudioBuffer, avoiding JavaScript timer delays between repeats. Output goes through the video only when supported, avoiding double playback. Stop cancels the active source immediately. No silent background watchdog restarts stopped playback.

## Development and hosting

Serve the repository root with `python -m http.server 8765`, then visit `http://localhost:8765`. No build step or dependencies. GitHub Pages deploys from the main branch/root using the repository's existing configuration.

- `index.html`: responsive controls
- `app.js`: synthesized audio, recording, playback, floating video
- `sw.js`: offline cache scoped to this app
- `manifest.webmanifest`, icons: home-screen installation

After a connected visit, the app caches its files for offline use. The service worker prefers network responses so subsequent online visits receive updates.

Keyboard shortcuts outside form controls: Space = play; N = next; L = loop; S = stop; P = float; F = fullscreen.
