# Resource text audit

`kitia preview <kind> <id> --audit` and `kitia install <kind> <id> --audit` opt in to deterministic checks of the resource's pinned text before preview or installation. Auditing is opt-in so existing installs and previews keep their current behavior. The checks are local pattern matches; the audit does not execute resource content, contact a scanning service, or make an exhaustive security assessment.

For skills, the audited text is the resource's `SKILL.md` entrypoint. For agents and instructions, it is the pinned Markdown resource file. Auxiliary skill files are not included in this initial audit. Findings identify a rule, file and line, and are warnings rather than a claim that malicious intent has been proven. Any finding blocks an audited install. Incomplete coverage also blocks installation; preview reports findings and coverage without blocking the preview.

The initial rules flag instruction-override language, requests to disclose hidden prompts or secrets, common credential collection or transfer patterns, destructive shell commands, and download-to-shell execution. Pattern matching can miss malicious behavior and can flag benign text; review the reported source before acting.

The scanner processes at most 500 UTF-8 text files, each at most 1 MiB. Invalid UTF-8 and over-limit files are explicitly reported as skipped. Coverage reports discovered and analyzed files, skipped paths and reasons, and whether coverage is complete. A complete report with no matches means only that no configured rule matched the analyzed text; it is not a safety guarantee. No resource content is described as safe by this audit.
