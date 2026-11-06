---
"@grasdouble/kitia": minor
---

- Refresh the dashboard header with a pixel-style KITIA wordmark and a seated ASCII cat. Both share an animated cyan/violet/pink gradient; the cat occasionally licks its paw, scratches its ear, or winks. Show the version before the screen name and use a compact text title on narrow terminals.
- Fix overlapping panel headings and counters, account for the taller header when sizing lists, and label the NEEDS REVIEW summary count as "warning(s)" instead of "attention".
- Notify users when a newer npm release is available, with a popup showing installed and available versions and a changelog link.
- Add an interactive first-run dashboard tour that can be reopened with `kitia onboarding` or `?`. Ensure onboarding scans the current project directory and restore the dashboard as the default when running `kitia` without arguments.
