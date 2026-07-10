---
"@gmode/core": patch
---

`serializeError` now honors `ApiError.expose: false` — internal errors no longer leak their message or details to clients (code becomes `INTERNAL_ERROR`; real message/stack only with `includeStack`).
