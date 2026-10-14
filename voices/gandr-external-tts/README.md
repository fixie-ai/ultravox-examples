# Gandr External TTS Voice

Use [Gandr](https://gandr.ai) TTS voices in Ultravox calls through the generic external voice API. Gandr serves an OpenAI compatible speech endpoint at `https://tts.gandr.ai/v1/audio/speech`, and its pcm output is s16le mono 24000 Hz, which maps directly to Ultravox `audio/l16` at `responseSampleRate` 24000 with no transcoding.

## Prerequisites

- An Ultravox API key
- A Gandr API key (keys at [gandr.ai](https://gandr.ai); the free tier is 50,000 tokens, and one million tokens a month is $10)

## 1. Create the voice

Edit `gandr-voice.json` in this folder and replace `YOUR_GANDR_API_KEY` with your key. Ultravox substitutes `{text}` with the text to speak on each request. Then create the voice:

```bash
curl -X POST https://api.ultravox.ai/api/voices \
  -H "X-API-Key: $ULTRAVOX_API_KEY" \
  -H "Content-Type: application/json" \
  -d @gandr-voice.json
```

## 2. Use it in a call

```json
{
  "systemPrompt": "You are a helpful assistant.",
  "voice": "Gandr-Mia"
}
```

## Voices

Gandr has six voices: `gandr-mia`, `gandr-ava`, `gandr-jenny`, `gandr-dane`, `gandr-leo`, `gandr-lewis`. Create one Ultravox voice per Gandr voice you want, changing `name` and the `voice` field in the body.

## Notes

- 23 languages, and every render is watermarked.
- First audio byte in 146 ms over the open internet, 116 ms p50 first audio, server side warm.
- The endpoint also serves mp3 and wav (default mp3); keep `pcm` for Ultravox so audio streams without a decode step.
