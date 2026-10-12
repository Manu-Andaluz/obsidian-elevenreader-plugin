# ElevenLabs Reader

Local Obsidian plugin that narrates the open note. Audio is played from memory and is not written into the vault.

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
2. Run **Narrate current note** from the command palette, or open the player with **Open player** (`⌘⇧L`) and press play.
3. The player shows `…` while ElevenLabs generates, then plays. Drag the bar to move it. Play, pause, and the slider seek within the current narration.
4. Run **Stop narration** to cancel generation or discard the current audio.

A failed request shows the ElevenLabs error in a notice. Cancelling shows `Narration cancelled.` The note itself is left unchanged.

Voice and model are chosen in plugin settings, not on the player. The choice is saved and used on the next narration.

A matching narration is reused when the note text, voice, model, and audio format are the same as a generation this plugin already completed. The local record is the ElevenLabs history item id plus a hash of that request. The audio file and the note text are not stored in the vault. Reuse downloads the audio again from [Get audio from history item](https://elevenlabs.io/docs/api-reference/history/get-audio), and only after that download succeeds. If the remote audio is gone, the player says so; narrate once more to generate a replacement. The old record stays. Narrations created outside this plugin are not imported.

**Remove saved narration** drops the saved reference for the open note, using the current voice and model. The next narration generates a replacement. Other saved narrations stay.

While audio plays, the current word is highlighted in the editor. The highlight follows pause and seek. The editor does not scroll to it, and you can keep editing. A new narration stores word timing from [Create speech with timing](https://elevenlabs.io/docs/api-reference/text-to-speech/convert-with-timestamps). Older saved narrations estimate the word from the playback position.

Speech is requested from [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert): `POST /v1/text-to-speech/{voice_id}`.
