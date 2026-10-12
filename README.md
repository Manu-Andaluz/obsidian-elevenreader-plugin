# ElevenLabs Reader

Local Obsidian plugin that narrates the open note. Playback stays in memory. An exported MP3 is written only when you run **Export audio**.

## Install in this test vault

From `plugin/`:

```bash
npm install
npm test
npm run build
```

The build writes `main.js` and `manifest.json` to `.obsidian/plugins/elevenlabs-reader/`. Reload Obsidian, then enable **ElevenLabs Reader** under Settings → Community plugins.

Put the API key in the plugin settings. Obsidian keeps it in this vault's secret storage (`elevenlabs-api-key`), not in the plugin source.

## Use

1. Open a note.
2. Run **Open actions** (`⌘⇧A`) and pick narrate, open player, stop, remove saved narration, or export audio. The same commands remain in the command palette. **Open player** is also `⌘⇧L`.
3. The player shows `…` while ElevenLabs generates, then plays. Drag the bar to move it. Play, pause, and the slider seek within the current narration. Skip backward and skip forward jump by the interval in plugin settings (5, 10, or 15 seconds; 10 by default). They are available while audio is playing or paused. The bar fades in when it opens and fades out when you hide it. Play and pause swap with a short mark. A reduced-motion preference turns that motion off.
4. Run **Stop narration** to cancel generation or discard the current audio.

A failed request shows the ElevenLabs error in a notice. Cancelling shows `Narration cancelled.` The note itself is left unchanged.

Voice and model are chosen in plugin settings, not on the player. The choice is saved and used on the next narration.

A matching narration is reused when the note text, voice, model, and audio format are the same as a generation this plugin already completed. The local record is the ElevenLabs history item id plus a hash of that request. The audio file and the note text are not stored in the vault. Reuse downloads the audio again from [Get audio from history item](https://elevenlabs.io/docs/api-reference/history/get-audio), and only after that download succeeds. If the remote audio is gone, the player says so; narrate once more to generate a replacement. The old record stays. Narrations created outside this plugin are not imported.

**Remove saved narration** drops the saved reference for the open note, using the current voice and model. The next narration generates a replacement. Other saved narrations stay. An MP3 already exported for that note stays in the export folder.

**Export audio** downloads the saved ElevenLabs history item for the open note and writes an MP3. It does not generate speech. If this note has no reusable generation, narrate it first, then export. The destination is a vault folder, **audios** by default, set under plugin settings as **Export folder**. The installed plugin lives at `.obsidian/plugins/elevenlabs-reader/`, so that default folder is `../../../audios/` from the built plugin and `<vault>/audios/` from the notes. The folder is created on export. The filename comes from the note title. If that file already exists, the next export uses a numeric suffix (`Note 2.mp3`) and leaves the earlier file in place.

To check iCloud later, put this vault in iCloud yourself and export a dummy note. On the iPhone, look for `audios` at the vault root in the Files app after sync. This plugin does not read or write an iCloud folder on its own.

While audio plays, the current word is highlighted in the editor and in reading view. The highlight follows pause and seek. The note does not scroll to it, and you can keep editing or moving around. The highlight color is chosen in plugin settings, so it can stay visible when a theme or CSS snippet paints the editor. A new narration stores word timing from [Create speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps). Older saved narrations estimate the word from the playback position.

Speech is requested from [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert): `POST /v1/text-to-speech/{voice_id}`.
