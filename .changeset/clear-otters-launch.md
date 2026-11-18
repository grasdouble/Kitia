---
"@grasdouble/kitia": major
---

Move the packaged Kitia executable to `terminal/dist/kitia.js`.
  - **User-Facing**
    - Update direct calls to `terminal/bin/kitia.js` to use `terminal/dist/kitia.js`, or invoke the installed `kitia` command instead.
    - Replace direct calls to `terminal/migrations/run.js` with `kitia migrate`.
    - Installed `kitia` commands and migration options keep the same syntax and behavior.
