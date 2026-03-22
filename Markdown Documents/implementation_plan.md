# Implementation Plan: Order Manager Web UI Optimizations

## Goal Description
The objective is to overhaul the Order Manager Web application's UI formatting and Storage Browser's fetching logic. Currently, the Storage Browser is artificially capped at 150 items, prompting layout bugs when users view larger catalogs. The CSS layout is rigid, causing visual squeezing across different displays. This plan implements recursive pagination to guarantee complete asset fetching, fluid CSS Grid/flexbox layouts to ensure graceful degradation, and optimizes image presentation.

## User Review Required
None of these changes touch backend database structures. The primary changes are JS/CSS updates within `order-manager-web`.

## Proposed Changes
---
### order-manager-web
These components control the main dashboard and storage browser functionalities.

#### [MODIFY] [storage-browser.js](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/storage-browser.js)
- Update [loadPreviews()](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/storage-browser.js#462-494) and [loadPrompts()](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/storage-browser.js#519-602) to automatically loop through pagination cursors (`hasMore` and `cursor`) until all data for a specific date is returned.
- Eliminate the JS-side `imageLimiter` mechanism blocking render streams and rely entirely on native browser `<img loading="lazy" decoding="async">` paired with the Intersection Observer.
- Enhance the creation of thumbnail text elements to leverage native `title` attributes for tooltips on truncated filenames.

#### [MODIFY] [desktop.css](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/desktop.css)
- Switch rigid `.container` sizing (`minmax(320px, 1fr)`) to fluid wrappers (`grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`).
- Update `.storage-thumbnail-grid` and `.storage-prompt-grid` to utilize smaller, auto-filling column tracks.
- Fix `.storage-thumb img` aspect ratio issues by applying `aspect-ratio: 1 / 1` and `object-fit: contain` instead of hard-coded heights and `cover`.
- Adjust `.storage-detail-body` layout using `@media (max-width: 1024px)` to collapse into a vertical stack instead of horizontally squishing the metadata column on tall designs.

## Verification Plan

### Automated Tests
Currently, there are no Jest or Mocha tests available for the DOM interactions in this project. Verification will rely on visual inspection and functional validation through a browser.

### Manual Verification
1. Launch the `order-manager-web` application locally (e.g., using a local fileserver or Cloudflare proxy depending on how the user normally launches [index.html](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/index.html)).
2. Navigate to the **Storage Browser** tab.
3. Select a generic date known to contain more than 150 objects.
4. Verify that the UI spins/loads and ultimately presents *all* items matching that date without requiring a manual refresh or "Load More" click.
5. Resize the desktop browser window down to smaller dimensions (e.g. from 1920px width down to 1000px width).
6. Verify the 3-column `Pipeline / Create Orders / Fulfillment` layout gracefully shrinks and recalculates widths rather than overlapping.
7. Open any portrait-oriented print preview and verify that the metadata displays legibly and doesn't get clipped or squished by the image.
8. Hover over any long filename in the grid to verify the browser-native tooltip appears.
