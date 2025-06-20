# PrintMO Order Management

> **Streamline Shopify → S&S Activewear fulfillment with a seamless UI**

---

## Overview

PrintMO Order Management is a cross-platform desktop app (Electron + Node.js) I created in order to automate the entire workflow from a paid Shopify order to a batched blank-apparel order at S&S Activewear, and allows us to keep track of, and manage the statuses of all of our orders.

1. **Shopify Webhook Intake**  
   - Listens to real-time **`orders/paid`** webhooks.  
   - Securely verifies HMAC, then stores each order in a Redis queue.

2. **Resilient Queue & API Layer**  
   - Express.js server decouples webhook capture from the UI.  
   - Redis guarantees 24 / 7 order retention—even if the desktop app is closed.  
   - Fetches live S&S pricing and submits consolidated orders via REST.

3. **Drag-and-Drop Kanban UI**  
   - Three-column board (`Payment Received` → `Blanks Ordered` → `Ready to Print`).  
   - Perfect-square cards with shimmer animation, live “time-ago” badges, and delete controls.  
   - **Detail modal** shows variant info, line-item quantities, per-item cost, discounts, and totals.

    **This here is a visualization of what the dashboard looks like**
   
   ![image](https://github.com/user-attachments/assets/942b1fcf-a8f6-468c-8548-21eb77c0dfeb)

   **Upon clicking an order card, it will open a detail modal to show all of the details about the order**
   
    ![image](https://github.com/user-attachments/assets/1b5cd760-2705-4146-af0a-f46a76148553)


4. **Order Management Enhancements**
   - Bundle cards together for batching related jobs.
   - Attach art files by dragging them onto an order card.
   - Edit customer notes inline to capture special instructions.
   - Check off blanks readiness and track print progress visually. Cards change colors to indicate the materials for the order that are ready.
  
   **Art files are centralized to each order, and accessible to each of us in the business**
   ![image](https://github.com/user-attachments/assets/600ccb99-ccf4-4c7d-8b91-1cc3d75a718b)

   **A progress bar indicates how far along we are on an order, to help us prioritize what needs to be done**
   ![image](https://github.com/user-attachments/assets/b558a0cf-7d17-4835-b04f-9795d7894ec3)

   **Orders can be bundled together to help prevent clutter on the dashboard**
   ![image](https://github.com/user-attachments/assets/9722cabb-41a2-4f40-97c7-18e20373577b)


6. **Batch & Submit in One Click**
   - Drag multiple cards into the **Create Blanks Order** zone.
   - Real-time totals update instantly.  
   - Press **Submit to S&S** → app aggregates SKUs, calls S&S API, then advances cards to `Blanks Ordered`.

   ![image](https://github.com/user-attachments/assets/3d6ff0d2-0593-4f06-916f-ec7640c0457e)

   **When you click Submit, the app aggregates every SKU in the selected cards and fires a single request to the S&S Activewear API—placing one consolidated blank-apparel order.**
   
   ![image](https://github.com/user-attachments/assets/80ef7c13-d935-4767-84ef-135fb3a80fcc)


---

## Key Features

| Feature | Tech | Benefit |
|---------|------|---------|
| Shopify `orders/paid` webhook listener | Node.js / Express | Instant order ingestion |
| Redis queue | Redis 4 | Fault-tolerant, decoupled processing |
| Cross-platform desktop UI | Electron 26 | Runs natively on macOS & Windows |
| Kanban drag-and-drop | Vanilla JS + HTML/CSS | Visual, intuitive workflow |
| Real-time pricing & batching | S&S Activewear REST API | Eliminates manual ordering |
| Detail modal & time-ago badges | JS & CSS animations | Quick insight, faster decisions |
| Bundle orders for batching | Electron + Redis | Move multiple orders through statuses together |
| Attach and manage art files | Drag-and-drop File API | Centralize artwork with each order |
| Editable customer notes | Modal editor + Redis | Capture special instructions per order |
| Ready status checkboxes | Node.js IPC + UI | Track blanks and prints readiness visually |
| Print progress tracking | Progress bars in UI | Monitor percentage of items printed |

---
