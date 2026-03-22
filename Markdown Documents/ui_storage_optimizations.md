# PrintMO Order Manager: UI & Storage Browser Optimization Plan

## 1. Storage Browser Pagination Issue

### The Problem
Currently, when viewing a specific date in the Storage Browser, only a subset of designs (up to 150 previews) loads initially. Because cloud storage APIs (like Cloudflare R2 and AWS S3) paginate large sets of objects, `storage-browser.js` artificially limits the page size (`PREVIEW_PAGE_LIMIT = 150`). When you view a past date with more than 150 items, the remaining items are withheld under a cursor. You either have to rely on the "Load More" button or constantly refresh the page to pull in the next chunk. 

### The Solution: Automatic Recursive Fetching
To ensure **all** designs for a selected date are displayed instantly without manual refreshing:
- Update `loadPreviews()` and `loadPrompts()` in `storage-browser.js` to automatically follow the pagination cursor (`hasMore`) in a `while` / `do` loop until all assets for that specific date are fetched.

## 2. Rendering & Visual UI Improvements

The issue where "the visual formatting is all off" primarily stems from hard-coded sizing boundaries mapped to a rigid column architecture across Desktop viewing modes. The interface squeezes awkwardly on window resizes.

### 2a. Rigid Grid Containers
- **Issue**: Your `.container` layout in `desktop.css` utilizes rigid `minmax(320px, 1fr)` columns.
- **Optimization**: Use fluid Flexbox wrappers or a more relaxed CSS Grid approach (e.g., `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`).

### 2b. Storage Browser Gallery Sizing
- **Issue**: The `.storage-thumbnail-grid` uses sizing and aspect-ratios that contort the image. Specifically, `.storage-thumb img` forces a `height: 120px` with `object-fit: cover`. 
- **Optimization**: Adjust the Grid columns to use fractional spacing (`grid-template-columns: repeat(auto-fill, minmax(140px, 1fr))`) and swap to `aspect-ratio: 1 / 1` in combination with `object-fit: contain` on the images.

### 2c. Image Metadata Truncation
- **Issue**: `.storage-thumb span` crops filenames aggressively using inline `text-overflow: ellipsis`.
- **Optimization**: Replace the aggressive single-line ellipsis with a multi-line `-webkit-line-clamp: 2` setup, or implement a native `title="item.filename"` standard tooltip.

### 2d. Modal & Overlay Constraints 
- **Issue**: The `.storage-detail-overlay` has an aggressive structure, splitting the modal body into a forced `minmax(0, 1.2fr) minmax(0, 0.8fr)`.
- **Optimization**: The interior wrapper (`.storage-detail-body`) should employ Media Queries (`@media max-width: 1024px`) to switch to a vertical `flex-direction: column`.

## 3. Asynchronous Image Check Bottlenecks

- **Issue**: Currently, `IMAGE_CONCURRENCY` is statically set to `6`. While this creates an organized waterfall, manually limiting images inside pure Javascript while scrolling through hundreds of previews creates heavy background memory queueing as the `imageLimiter` tries to resolve everything sequentially. Visual loading falls behind mouse-scroll.
- **Optimization**: Let the native browser engine manage it. Keep `Intersection Observer` for lazy-logic, but remove the JS Promise Limiter and allow `<img loading="lazy" decoding="async">` to function natively.

## 4. AI Prompt Slow Loading (N+1 Head Requests)

### The Problem
The "AI Prompts" section takes significantly longer to load than the "Designer Studio Previews" (up to 10 seconds). This is because the application requires `customMetadata` to visualize prompt data (e.g., the prompt string, style, audience). Cloudflare R2's `list()` command allows you to optionally include custom metadata directly in the list response by specifying `include: ['customMetadata']`. Currently, the worker proxy *does not* ask for this. Consequently, `storage-browser.js` is forced to find any object missing metadata and fire an independent `HEAD /order-manager/storage/head?key=...` request for *every single item* (the "N+1 query problem").

### The Solution: Include Metadata in the List API
We can eliminate the 10-second delay completely by modifying the upstream Cloudflare Worker proxy (`worker.js`).
- **Proxy Modification**: Update the R2 `list()` parameters in `worker.js` to include the `include: ['customMetadata', 'httpMetadata']` option.
  ```javascript
  const page = await env.PREVIEWS.list({
      prefix,
      cursor,
      limit,
      delimiter,
      include: ['customMetadata', 'httpMetadata'] // <-- Add this
  });
  ```
- **Return Formatting**: Modify the `handleStorageList` mapping to pass `customMetadata` back to the frontend.
- **Frontend Benefit**: The `storage-browser.js` will instantly receive all necessary data in one standard payload (`data.objects[x].customMetadata`), thereby bypassing the `hydrateMetadata()` bottleneck loop entirely.
