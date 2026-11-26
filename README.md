# MedChat

A medical chat interface that removes patient identifiers **in the browser, before a message leaves the user's device**. It's built on [LibreChat](https://github.com/LibreChat-AI/LibreChat) and aimed at two uses:

- **Privacy-focused medical chatbots**, where what people type about themselves or their patients shouldn't reach a server, a database or a model provider with names, dates and record numbers attached.
- **Teaching medical AI best practices.** Every safeguard here is visible and testable, so students and teams can see what a careful medical AI interface does, and where its limits are.

> **Status: research prototype.** MedChat's de-identification has been tested on made-up notes only. It is not a HIPAA, GDPR or medical-device certification, and it does not catch every identifier. Read [What MedChat doesn't do](#what-medchat-doesnt-do) before putting it in front of patients.

## What happens to a message

```text
You type:   Patient Sarah Thompson, DOB 04/12/1958, called 415-555-0182 about her metformin.
Sent:       Patient [PATIENT_1], DOB [DATE_1], called [PHONE_1] about her metformin.
```

1. A de-identification model runs **inside the browser**, in a Web Worker. It's a token-classification model ([obi/deid_roberta_i2b2](https://huggingface.co/obi/deid_roberta_i2b2), quantized to ONNX), served by your own deployment. Pattern rules run alongside it for structured identifiers.
2. Each identifier becomes a placeholder such as `[PATIENT_1]`. The same value keeps the same number throughout a chat.
3. The chat shows the cleaned text, and a notice says how many identifiers were removed, so the user can spot anything that was missed.
4. The link between placeholders and real values stays **in browser memory only**. It's never stored or sent, and it's gone when the page reloads.
5. Only the cleaned text goes to the server, the database and the model.

Medical codes in standard forms are kept, so `SNOMED:44054006`, `E11.9` and `4548-4` reach the model intact.

### What gets replaced

| Placeholder | Examples |
|---|---|
| `[PATIENT_n]`, `[CLINICIAN_n]` | People's names |
| `[FACILITY_n]`, `[ORG_n]`, `[LOCATION_n]` | Hospitals, organizations, towns, addresses |
| `[DATE_n]`, `[AGE_n]` | Dates in English, Spanish and Italian formats; ages |
| `[PHONE_n]`, `[EMAIL_n]`, `[URL_n]`, `[IP_n]` | Contact details and addresses |
| `[ID_n]` | Record numbers (MRN, historia clínica, cartella clinica), US SSN, Italian codice fiscale, Spanish DNI and NIE |
| `[OTHER_n]` | Other identifying details the model flags |

## Text, images and voice

| Input | What MedChat does |
|---|---|
| Typed messages, edits, regenerations, queued messages | De-identified in the browser before sending |
| Images and file uploads | **Refused** in the browser. They can't be de-identified yet, so they never leave the device |
| Voice input | **Refused** in the browser, for the same reason |

Image and document de-identification, including DICOM, is the first item on the [roadmap](#roadmap).

## Medical AI best practices, built in

Each practice below is enforced in code. The requirement numbers refer to the draft standard in [docs/BROWSER_DEID_STANDARD.md](docs/BROWSER_DEID_STANDARD.md).

| Practice | How MedChat applies it |
|---|---|
| **Minimize data at the source** | Identifiers are removed before text enters chat state, so history, titles and model requests never see them (R1) |
| **Fail closed** | If de-identification can't run, the message isn't sent. The text stays in the box and the user is told why. There's no fallback to raw text (R2) |
| **No hidden third parties** | The model, tokenizer and runtime are served by your deployment. Using a chat makes no requests to other hosts. That includes icons: upstream LibreChat asks Google for source favicons, which reveals what's being looked up (R3) |
| **Close what you can't protect** | Uploads and voice are refused at the network layer, so no feature can get around it (R4) |
| **Show the user what was sent** | The chat displays the cleaned text, not the original (R7) |
| **Measure and publish accuracy** | Results per language are published, with their limits (R8) |
| **Keep the clinical meaning** | Codes and medical terms survive de-identification (R9) |
| **Ground answers, cite sources** | The example deployment answers from a terminology database and lists every concept it used, instead of answering from the model's memory |
| **Stay in scope** | The example model is labelled "terminology reference, not clinical advice". Interface features that could carry identifiers (agents, memories, file search, web search, shared links) are switched off |
| **Keep a human responsible** | The interface tells users to check for missed identifiers. No automated method catches everything |

### Defense in depth

Text is cleaned twice. The composer cleans it before submission. A network gate, installed before the app renders, then checks every outgoing `fetch` and `XMLHttpRequest`. Text sent through other routes, such as edits, regenerations and queued messages, is cleaned there as well, and uploads and voice are refused there.

```text
client/src/deid/
├── core.ts          # patterns, protected code forms, span merging, placeholder map
├── detect.ts        # model inference, shared by the browser worker and the eval script
├── deid.worker.ts   # loads the model from /models/deid/ and the runtime from /wasm/; remote models off
├── index.ts         # deidentify(), per-chat placeholder maps, fail-closed errors
├── gate.ts          # network gate for fetch and XMLHttpRequest
└── guard.ts         # the error type for blocked input
```

## Measured results

These come from 18 made-up notes in [tools/deid-eval/notes.json](tools/deid-eval/notes.json), tested 2026-11-05. **No real clinical notes were used.** These numbers say nothing about accuracy on real notes.

| Language | Identifiers removed |
|---|---|
| English | 26 / 26 |
| Spanish | 17 / 17 |
| Italian | 17 / 17 |

Medical terms that had to survive: 26 / 26 kept, across all three languages.

An automated browser test, [tools/deid-eval/browser-test.mjs](tools/deid-eval/browser-test.mjs), records every request from sign-in onward. It also checks the database afterwards. All 20 checks passed. The full record is in [docs/BROWSER_DEID_RESULTS.md](docs/BROWSER_DEID_RESULTS.md).

The model was trained on English clinical notes. Spanish and Italian rely more on the pattern rules, and the 34 test identifiers in those languages are far too few to judge them by.

## What MedChat doesn't do

- **It doesn't catch everything.** Unusual names, misspellings and identifiers written in unexpected ways can get through. Users remain responsible for what they send.
- **It doesn't stop identification by context.** A rare condition together with a small town can identify someone with no name attached.
- **It doesn't make a deployment compliant.** HIPAA, GDPR and local health-data laws apply to the whole system: hosting, logging, access control, agreements with any model provider, and consent. MedChat covers one part of that.
- **It doesn't cover images, files or voice.** It refuses them instead.
- **It doesn't cover the whole application.** Only chat text is de-identified. Admin settings and other surfaces aren't, which is why the example deployment turns them off.

### Before putting it in front of patients

MedChat provides the privacy layer. A patient-facing deployment still needs:

- clear wording that the bot isn't a clinician, and what to do in an emergency
- a decision about what the model may and may not answer, tested before launch
- a review by your privacy officer or legal counsel, and patient consent where required
- testing on text that looks like what your patients will actually write, in their languages, measured the same way as above
- accessibility review, and a way for patients to reach a person

## Using it for teaching

MedChat is meant to be taken apart. Some exercises:

1. Open the browser's developer tools on the Network tab. Send a message containing a made-up patient, then confirm that no request contains the name.
2. Block `/models/deid/` in the browser, then try to send. You'll see the interface fail closed.
3. Try to upload a file and watch the request get refused before it leaves the page.
4. Run `tools/deid-eval/eval.ts` on the test notes, then write harder notes and find what gets missed.
5. Read [docs/BROWSER_DEID_STANDARD.md](docs/BROWSER_DEID_STANDARD.md) and argue which requirements are missing.

## Running it

MedChat runs like LibreChat, with two additions:

1. **The de-identification model.** Serve an ONNX export of [obi/deid_roberta_i2b2](https://huggingface.co/obi/deid_roberta_i2b2) with q8 weights, in the transformers.js folder layout, at `/models/deid/`. In Docker, mount it at `/app/client/dist/models/deid`. Without it, every message is blocked, which is the fail-closed behaviour.
2. **The browser runtime.** The client build copies ONNX Runtime's WASM files into `dist/wasm/` on its own.

[deploy/medonto/](deploy/medonto/) is the example deployment. It runs LibreChat and MongoDB with registration, social login, shared links and search off. It has one model, which goes through an OpenAI-compatible gateway to a medical terminology service. The gateway isn't included in this repository. Point `baseURL` in [deploy/medonto/librechat.yaml](deploy/medonto/librechat.yaml) at any OpenAI-compatible endpoint you trust. The compose file and `setup.sh` contain addresses for the original server, so change them to yours.

```bash
cd deploy/medonto
./setup.sh                      # writes .env with generated secrets
docker compose up -d --build
```

For everything else, such as configuration, authentication and endpoints, LibreChat's documentation applies: https://www.librechat.ai/docs

## Roadmap

- De-identify images and documents in the browser, including DICOM, so uploads can be allowed instead of refused
- A setting to turn de-identification on per deployment, instead of building it in unconditionally
- Unit tests for `client/src/deid` in the client test suite
- Evaluation on larger, realistic test sets, with results per identifier type
- Move to a current LibreChat release. MedChat is based on v0.8.8, and upstream has since rewritten the chat composer that the de-identification hooks into

## Credits and license

MedChat is a fork of [LibreChat](https://github.com/LibreChat-AI/LibreChat) by Danny Avila and contributors, released under the [MIT License](LICENSE), which also covers MedChat's changes. The de-identification model is [obi/deid_roberta_i2b2](https://huggingface.co/obi/deid_roberta_i2b2) from the `obi` organization on Hugging Face, under its own license. Check it before redistributing the weights.
