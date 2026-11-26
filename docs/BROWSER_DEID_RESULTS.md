# Conformance record: LibreChat v0.8.8, branch `deid-mcp`

Tested 2026-11-05 on made-up data only. This says nothing about accuracy on real clinical notes.

The de-identification code is the same as in the Open WebUI fork, so its accuracy on the 18 made-up notes carries over: English 26/26, Spanish 17/17, Italian 17/17 identifiers removed, and 26/26 medical terms kept. It wasn't re-measured here.

`tools/deid-eval/browser-test.mjs`, in Chromium on the server, recording every request from sign-in onward: 20 of 20 checks passed.

| Requirement | Checked by |
|---|---|
| R1, R7 | No identifier in any request; the chat shows placeholders; the original name isn't on screen; none of the identifiers were in MongoDB afterwards |
| R1 | A message sent while a reply was being written was cleaned too |
| R2 | With the model blocked: nothing sent, text kept in the box, user told |
| R3 | No requests to any other host, including the sign-in page |
| R4 | File upload (fetch and XHR) and voice refused, and never left the browser |

Not tested in a browser: editing a message, regenerating, and the composer's other routes beyond those above. Text from those paths goes through the same network gate, which was checked with a direct request. Not tested in the user's own Chrome.
