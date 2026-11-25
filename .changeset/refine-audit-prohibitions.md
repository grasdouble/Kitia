---
"@grasdouble/kitia": patch
---

Improve resource audit accuracy and failure details
  - **User-Facing**
    - Do not flag references to existing ignore rules or explicit prohibitions against disclosing secrets as requests to override instructions or expose secrets.
    - Audited installs still block when rules detect a finding or coverage is incomplete.
    - Read coverage details and findings in the dashboard's installation failure popup, with paging for longer reports.
