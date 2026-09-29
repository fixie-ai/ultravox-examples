# Pronunciation dictionary example

A pronunciation dictionary tells Inworld TTS 2 how to say specific words:
names, brands, and place names the model would otherwise mispronounce. You
store the dictionary once in your Inworld workspace and then refer to it by
name in Ultravox.

This example manages a dictionary through the Inworld API (create it, look at
it, update it, delete it, and synthesize a preview MP3 to hear it in use), then
adds an Ultravox voice that uses it.

## What you need

- **Node.js 20+**.
- **An Inworld API key with write access**, from the [Inworld Portal](https://platform.inworld.ai),
  and the **ID of the workspace** that will own the dictionary.
- **Access to the pronunciation dictionary API.** If requests fail with HTTP
  403, ask your Inworld contact to enable it for your workspace.
- **For the Ultravox voice:** an [Ultravox API key](https://app.ultravox.ai/settings).

## Setup

```bash
npm install
cp .env.example .env   # then set INWORLD_API_KEY and INWORLD_WORKSPACE (and ULTRAVOX_API_KEY)
```

## Inworld commands

```bash
npm run inworld -- create             # create the dictionary from src/dictionary.ts
npm run inworld -- get                # show it and its entries
npm run inworld -- list               # list every dictionary in the workspace
npm run inworld -- update             # replace its entries with src/dictionary.ts
npm run inworld -- preview            # synthesize preview.mp3 using the dictionary
npm run inworld -- preview "Siobhan loves her Vyta"   # ...with your own text
npm run inworld -- delete             # delete it
npm run typecheck
```

- **Include the `--`.** It passes the command through npm to the script.
- **Which dictionary.** The commands find the example's dictionary by its
  display name, `INWORLD_DICTIONARY_DISPLAY_NAME` (default
  `Pronunciation dictionary example`).
- **Preview settings.** `preview` uses the voice, model, and language from
  `INWORLD_VOICE_ID` (default `Sarah`), `INWORLD_MODEL_ID` (default
  `inworld-tts-2`), and `INWORLD_LANGUAGE` (default `en-US`). It writes
  `preview.mp3` in this folder.
- **Typical loop.** Edit `src/dictionary.ts`, run `update`, run `preview`,
  listen, repeat.

## Add the voice to Ultravox

```bash
npm run ultravox -- create-voice                          # uses this example's dictionary
npm run ultravox -- create-voice --dictionary <id>        # uses a specific dictionary
npm run ultravox -- create-voice -d <id1> -d <id2> --name my-voice
```

`create-voice` adds an Ultravox voice that speaks with the Inworld voice and
model from `INWORLD_VOICE_ID` and `INWORLD_MODEL_ID` (default `Sarah` on
`inworld-tts-2`) and applies your pronunciation dictionaries. It prints the new
voice's ID for use in an agent or call.

- **Choosing dictionaries.** With no `--dictionary`, it uses this example's
  dictionary (found by display name). If your workspace has several, run
  `npm run inworld -- list` and pass the one you want with `--dictionary`. The
  ID is the UUID at the end of the dictionary's name; the full
  `workspaces/{ws}/pronunciationDictionaries/{uuid}` name works too. Repeat
  `--dictionary` for up to three, in priority order (the first one defining a
  word wins).
- **Voice name.** `--name` or `ULTRAVOX_VOICE_NAME` (default
  `sarah-pronunciation-example`): letters, digits, `_` and `-` only. Running
  again with the same name updates that voice instead of adding another.
- **Inworld key on your Ultravox account.** The voice runs on the Inworld key
  saved in your Ultravox account (Settings, TTS API keys), and that key must be
  able to read the dictionaries. The command checks this first. Set
  `ULTRAVOX_SET_INWORLD_KEY=true` to have it save `INWORLD_API_KEY` there for you.

## Files

```
pronunciation-dictionary/
├── .env.example          # copy to .env
├── package.json
├── tsconfig.json
└── src/
    ├── dictionary.ts     # the dictionary entries and preview text: edit these
    ├── inworld/
    │   ├── cli.ts        # the Inworld commands
    │   ├── client.ts     # small Inworld API client (dictionaries + TTS)
    │   ├── settings.ts   # reads .env
    │   └── types.ts      # request/response types
    ├── ultravox/
    │   ├── cli.ts        # npm run ultravox -- create-voice
    │   └── types.ts      # Ultravox voice types
    ├── env.ts
    └── http.ts
```

`src/inworld/client.ts` has no dependencies beyond `fetch`, so you can copy it
and `types.ts` into your own code.

## Writing dictionary entries

```ts
{ displayHeadword: "Vyta", languageCode: "en-US", phoneSymbols: ["ˈ", "v", "a", "ɪ", "t", "ə"] }
```

- **`displayHeadword`**: one word, up to 128 characters. Phrases are rejected.
- **`languageCode`**: exact BCP-47 code such as `en-US`. `en-us`, `en`, and `auto` are rejected.
- **`phoneSymbols`**: 1-64 IPA phones, **one phone per element**.
  `["k","æ","t"]` is right; `"kæt"` and `"/kæt/"` are wrong. Use IPA, not ARPAbet.
  - **Diphthongs are two tokens** in `en-US`: `"a", "ɪ"` and `"e", "ɪ"`, not `"aɪ"` or `"eɪ"`.
  - **Stress and length.** Stress marks `ˈ` and `ˌ` are accepted as their own
    tokens, and the long vowel `iː` as one token.
- **How phones are used.** At synthesis the phones are joined back into one IPA
  string, e.g. `/ˈvaɪtə/`, so splitting a diphthong doesn't change how it sounds.
- **Uniqueness**: each language + headword pair may appear once per dictionary.
- **Size**: at most 1,000 entries and 512 KiB per dictionary.
- **Errors**: every entry is validated, and one invalid entry fails the whole
  request with HTTP 400, so nothing is saved. The error names the field, e.g.
  `pronunciation_dictionary.pronunciations[1].phone_symbols[3]` is the fourth
  phone of the second entry (counting from 0). Fix it and run the command
  again. The error may name only one problem at a time.

## API reference

Base URL: `https://api.inworld.ai`. Auth: `Authorization: Basic <Base64 credential from the Portal>`.

| Operation | Request | Notes |
|---|---|---|
| Create | `POST /pronunciations/v1/workspaces/{ws}/pronunciationDictionaries` | Body is the dictionary: `{displayName, pronunciations}`. The service assigns `name`. No idempotency key |
| Get | `GET /pronunciations/v1/{name}` | |
| List | `GET /pronunciations/v1/workspaces/{ws}/pronunciationDictionaries?pageSize=5&pageToken=…` | Page size is capped at 5 |
| Update | `PATCH /pronunciations/v1/{name}?updateMask=displayName,pronunciations` | Body needs the current `etag`. `pronunciations` **replaces all entries** |
| Delete | `DELETE /pronunciations/v1/{name}?etag=…&allowMissing=true` | `etag` is required |

`{name}` is the full resource name the service returns, e.g.
`workspaces/{ws}/pronunciationDictionaries/{uuid}`.

- **No per-entry endpoints.** To add, change, or remove one entry, get the
  dictionary, edit the list, and send the whole list back with
  `updateMask=pronunciations`.
- **Stale etag.** An update or delete with an out-of-date `etag` returns HTTP
  409. Get the dictionary again and retry. `update` does this once automatically.
- **Failed creates.** Create has no idempotency key. If a create fails without
  a response, list the dictionaries before retrying: the create may have
  succeeded, and a blind retry can make a duplicate. `client.ts` does this check.

### Using a dictionary in TTS

```json
POST /tts/v1/voice
{
  "text": "Your Vyta headset ships from our Worcester warehouse today.",
  "voiceId": "Sarah",
  "modelId": "inworld-tts-2",
  "language": "en-US",
  "pronunciationDictionarySettings": {
    "dictionaries": [{ "dictionary": "workspaces/{ws}/pronunciationDictionaries/{uuid}" }]
  }
}
```

- **TTS 2 models only.** TTS 1.x ignores dictionaries.
- **Up to three dictionaries**, in priority order. If two define the same word, the first wins.
- **Named or default, not both.** Don't send `enableCustomPronunciation` (the
  workspace default dictionary from the Portal) alongside
  `pronunciationDictionarySettings`, even set to `false`.
- **Set `language`.** Entries are matched by language, so pass it explicitly
  rather than relying on automatic language detection.
- **Other endpoints.** The same fields work on `/tts/v1/voice:stream`,
  `:synthesizeAsync`, `:synthesizeBatch`, and the bidirectional WebSocket.
