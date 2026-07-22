# Desktop and Mobile Style Decoupling Report

## Summary
- Desktop and mobile layouts now load from separate stylesheets with non-overlapping media queries.
- Desktop styling lives in order-manager-web/desktop.css and is only applied at widths >= 901px.
- Mobile styling lives in order-manager-web/mobile.css and is only applied at widths <= 900px.

## How the decoupling works
1. order-manager-web/index.html loads desktop.css with media="(min-width: 901px)" and mobile.css with media="(max-width: 900px)".
2. order-manager-web/desktop.css contains the full desktop presentation and hides mobile-only UI elements.
3. order-manager-web/mobile.css contains a full base style snapshot plus mobile overrides so it does not depend on desktop.css.
4. order-manager-web/renderer.js uses MOBILE_TAB_BREAKPOINT = 900 for behavior only; keep it aligned with the CSS media queries.

## Desktop detail layout (restored)
- #detail-content now stacks the mockup strip above the main columns.
- #detail-main-column uses a two-column grid (main stack on the left, design panel on the right).
- #detail-design-panel has its own scrollable body so design files stay visible without collapsing the main column.

## Where to make changes
- Desktop visual changes: order-manager-web/desktop.css.
- Mobile visual changes: order-manager-web/mobile.css.
- Shared behavior (tabs, bottom sheet logic, selection mode): order-manager-web/renderer.js.

## Maintenance notes
- If a new shared HTML element is added, style it in both CSS files to keep layouts independent.
- Avoid adding mobile tweaks inside desktop.css or desktop tweaks inside mobile.css.
- JSDoc headers in both stylesheets explain the separation and point to the right file for edits.
