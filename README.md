# Look here! — Photo sounds

A small, dependency-free website for playing attention sounds while taking a photo of a dog, cat, or baby.

## Use it

Open https://hasntbeenused.github.io/Pet-camera-focus-/ in your phone's browser.

1. Tap a sound icon to hear it once. The highlighted icon is the current sound, remembered on this device.
2. Tap **Open floating player** and switch to your camera app. The floating player displays a light card with the sound icon and **Press ▶ to play**. Tap the player to reveal its native controls.
3. In the floating player, **Play** plays the highlighted sound; **Next** selects the next sound and plays it. **Pause** stops playback.
4. Open **Advanced** for **Loop in player**, 0.5–30-second pauses, volume, and single/double/burst patterns. Sound-icon previews always play just once, regardless of these settings. With Loop enabled, opening the floating player starts repeating; its Play button also respects the loop setting.
5. Open **Recording**, record up to ten seconds, and choose **Save & use**. The recording plays once and appears as a microphone icon. The recording menu then closes. One custom recording is kept in this browser; saving another replaces it. **Delete** removes it. Closing the menu while recording ends the recording and releases the microphone.

Built-ins: soft chime (🔔), squeaky toy (🦆), clicker (👆), kissy noise (💋), bird chirp (🐦), gentle trill (🎵), and whistle (📣). These are synthesized sounds. Icon buttons have accessible names and tooltips. Recording and Advanced start collapsed. There are no standalone playback controls on the main page.

Recordings never leave the device. They are stored in IndexedDB and can disappear if browser/site data is cleared. Existing recordings and settings from the earlier version are retained. Microphone recording needs HTTPS or localhost.

## Compatibility

Floating video uses canvas capture, Web Audio, the video Picture-in-Picture API, and Media Session. Browsers decide which floating/system buttons to show. Next is not guaranteed to appear. On phones, the OS or camera app can interrupt audio or close the floating player. Physical-device testing with your camera app is still necessary; desktop browser checks cannot establish Android or iOS compatibility.

If floating video is unavailable, tapping sound icons still works. The Fullscreen fallback option in Advanced can also be tried with the Android Home button; enable Loop in player first if you want it to keep playing while switching apps. This fallback is browser-dependent. No claim is made that every sound attracts every subject; use a familiar voice or soft chime for a baby and stop if unwelcome.

Loop audio and silence are combined into a looping AudioBuffer, avoiding JavaScript timer delays between repeats. Output goes through the video only when supported, avoiding double playback. Stop cancels the active source immediately. No silent background watchdog restarts stopped playback.

## Development and hosting

Serve the repository root with `python -m http.server 8765`, then visit `http://localhost:8765`. No build step or dependencies. GitHub Pages deploys from the main branch/root using the repository's existing configuration.

- `index.html`: responsive controls
- `app.js`: synthesized audio, recording, playback, floating video
- `sw.js`: offline cache scoped to this app
- `manifest.webmanifest`, icons: home-screen installation

After a connected visit, the app caches its files for offline use. The service worker prefers network responses so subsequent online visits receive updates.
