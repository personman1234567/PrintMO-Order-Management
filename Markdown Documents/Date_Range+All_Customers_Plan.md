# Storage Browser: Date Ranges & All Customers View Implementation Plan

## Goal Description
Enhance the existing Storage Browser to support viewing items across a date range (ordered newest to oldest) and introduce a dedicated "All Customers" view that lazily loads all customer data. The application must maintain a snappy and smooth feel even when handling large amounts of data, requiring the implementation of virtualized rendering and efficient API fetching strategies.

## User Review Required
No major architectural changes are required that break existing functionality. The changes primarily revolve around replacing single-date variables with date-range states and adding a virtual rendering mechanism. We will also need to slightly redesign the controls UI to fit the new filters organically.

## Proposed Changes

### 1. State and Data Model Updates
Replace the single [date](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/web-shim.js#125-132) string in the application state with a more complex filter object to robustly handle both date ranges and the "All Customers" view.

#### [MODIFY] [storage-browser.js](e:\PrintMO\PrintMO-Order-Management\order-manager-web\storage-browser.js)
- Update `state`: Replace `date: ''` with `dateRange: { start: '', end: '' }`, `viewMode: 'date' | 'all'`, and `allCustomersCursor: null`.
- Update `cacheKey` generation to handle ranges and the [all](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/storage-browser.js#1062-1072) mode.
- Introduce an `IntersectionObserver` array or similar mechanism specifically for tracking visibility of customer groups/rows to implement lazy loading for the "All Customers" dateless view.

### 2. Multi-Date Fetching Logic
The Cloudflare R2 structure naturally groups data by date prefixes (e.g., `previews/2026-03-22/`). To fetch a range, we must iterate through the days and fetch their respective prefixes.

#### [MODIFY] [storage-browser.js](e:\PrintMO\PrintMO-Order-Management\order-manager-web\storage-browser.js)
- Create `getDateRangeArray(start, end)` to generate an array of YYYY-MM-DD strings.
- Modify [loadPreviews](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/storage-browser.js#622-658) and [loadPrompts](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/storage-browser.js#659-736):
  - If `viewMode === 'date'`, map over the date array. Fetch data for each date sequentially or in controlled parallel batches using the existing `promptListLimiter`/`metadataLimiter`, ensuring we order results from most recent date to oldest.
  - If `viewMode === 'all'`, hit the root `prompts/` prefix to get all identity folders (using the existing delimiter logic), then lazily load individual identity folders as they are scrolled into view.

### 3. UI and Controls Refresh
We need intuitive controls for selecting ranges and toggling the "All Customers" view.

#### [MODIFY] [index.html](e:\PrintMO\PrintMO-Order-Management\order-manager-web\index.html)
- Replace the single `<input type="date">` with a dual-input range picker or a dropdown of presets (e.g., "Today", "Last 3 Days", "Last 7 Days", "Custom Range").
- Add a toggle or button group for "Date View" vs "All Customers View".
- Maintain the existing text filter input.

#### [MODIFY] [desktop.css](e:\PrintMO\PrintMO-Order-Management\order-manager-web\desktop.css) & [mobile.css](e:\PrintMO\PrintMO-Order-Management\order-manager-web\mobile.css)
- Style the new date range inputs and view toggles to blend seamlessly with the existing `.storage-controls` layout.
- Ensure the controls remain compact and visually accessible.

### 4. Virtualized / Lazy DOM Rendering
To ensure the app feels snappy when viewing a wide date range or the "All Customers" list, we cannot append thousands of DOM nodes at once.

#### [MODIFY] [storage-browser.js](e:\PrintMO\PrintMO-Order-Management\order-manager-web\storage-browser.js)
- Implement a lightweight virtual list or chunked rendering system.
- Instead of rendering all `filteredItems` at once in [renderStorageResults](file:///e:/PrintMO/PrintMO-Order-Management/order-manager-web/storage-browser.js#737-771), render only a chunk (e.g., 20 customer groups).
- Add a `Sentinel` DOM element at the bottom of the list observed by an `IntersectionObserver`. When the sentinel intersects, render the next chunk from memory into the DOM context.
- Keep the existing `IntersectionObserver` for lazy-loading images (via `dataset.src`).

### 5. "All Customers" Lazy Fetching
The dateless "All Customers" view needs to display identities without fetching their massive content payload immediately.

#### [MODIFY] [storage-browser.js](e:\PrintMO\PrintMO-Order-Management\order-manager-web\storage-browser.js)
- When switching to "All Customers", perform a delimiter list on `prompts/` to get all customer identity prefixes.
- Render skeleton groups or placeholder cards for each customer.
- Use an `IntersectionObserver` on the group row to trigger the API fetch for that specific identity prefix (`prompts/{identity}/`) when the user scrolls near it, loading results newest to oldest based on parsed metadata or folder structure.

## Verification Plan

### Manual Verification
1. **Date Ranges:** Select "Last 3 Days". Verify network requests accurately map to the 3 distinct R2 prefixes and results combine successfully, ordered newest to oldest.
2. **All Customers View:** Toggle to "All Customers". Verify the initial load is snappy and only fetches prefixes. Scroll down and verify individual customer assets load interactively.
3. **Performance:** Open a wide date range (e.g., 30 days) and ensure the browser thread remains unblocked and scrolling is smooth using the chunked DOM rendering.
4. **Filtering:** Type in the search box while in a date range and ensure the results filter instantly across the loaded memory array.
