# Browser De-Identification Standard (draft 0.1)

Status: draft, written for this fork. It hasn't been reviewed by anyone outside this project and it isn't a legal or regulatory certification. Passing it does not mean an interface meets HIPAA Safe Harbor, Expert Determination, or GDPR anonymization.

## Purpose

A chat interface that conforms to this standard removes identifiers from what the user types **inside the browser, before the text reaches any server**, including the server that hosts the interface.

## Requirements

**R1. Entry point.** De-identification runs on the input before it enters any chat state. Nothing downstream, such as history, titles, tags, search queries or model requests, can see the original text.

**R2. Fail closed.** If de-identification can't run (model not loaded, runtime error, timeout), the message isn't sent and the user is told why. There is no bypass and no fallback to raw text.

**R3. Local processing.** The model, tokenizer and runtime are served by the deployment itself. Text being de-identified is never sent over the network, and using a chat makes no third-party requests. That includes icons and previews: upstream LibreChat fetches source icons from Google using the source's domain, which would reveal what's being looked up, so this fork doesn't.

**R4. Uncleanable channels are closed.** Any input the implementation can't de-identify is refused in the browser. In this fork that means file and image uploads and voice, refused at the network layer so no feature can get around it.

**R5. Placeholders.** Each identifier becomes `[TYPE_n]`, with `n` stable for the same value within one chat: `[PATIENT_1]`, `[CLINICIAN_1]`, `[FACILITY_1]`, `[LOCATION_1]`, `[DATE_1]`, `[AGE_1]`, `[PHONE_1]`, `[EMAIL_1]`, `[ID_1]`, `[URL_1]`, `[IP_1]`, `[ORG_1]`, `[OTHER_1]`.

**R6. The mapping stays local.** The link between placeholders and original values is kept in browser memory only. It is never stored or sent, and is lost on reload.

**R7. The user sees what was sent.** The chat shows the de-identified text, not the original, so that the user can spot a missed identifier. The user is told how many identifiers were replaced.

**R8. Measured, published accuracy.** A conforming implementation publishes recall per identifier type and per supported language on a named test set, and those limits are stated to users. "Conforming" never means "catches everything".

**R9. Medical codes survive.** Concept IDs and clinical codes in standard forms (such as `SNOMED:44054006` or `E11.9`) are not treated as identifiers.

## What this doesn't cover

- Identifiers the model misses. No automated method catches everything; the user remains responsible for what they send.
- Identification by context, such as a rare condition together with a small town.
- Other parts of the application: admin settings, notes, channels and workspace content. Deployments should disable those they don't need.
- Attachments, because R4 refuses them.

## Conformance record for this fork

See [BROWSER_DEID_RESULTS.md](BROWSER_DEID_RESULTS.md).
