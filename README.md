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

    **This here is a visualization of what the dashboard looks like. It was just deployed, but when more orders come in, the cards auto layout to fit cleanly**
   
   ![image](https://github.com/user-attachments/assets/f68fadc7-8d32-4482-a87e-7a544896651f)

   **Upon clicking an order card, it will open a detail modal to show all of the details about the order**
   
    ![image](https://github.com/user-attachments/assets/f5bdb4a5-2296-40c1-9bdd-21eddce4fdad)



5. **Batch & Submit in One Click**  
   - Drag multiple cards into the **Create Blanks Order** zone.  
   - Real-time totals update instantly.  
   - Press **Submit to S&S** → app aggregates SKUs, calls S&S API, then advances cards to `Blanks Ordered`.

   ![image](https://github.com/user-attachments/assets/75bbf7a5-de5d-4dc4-a0ab-8db940081937)

   **When you click Submit, the app aggregates every SKU in the selected cards and fires a single request to the S&S Activewear API—placing one consolidated blank-apparel order.**
   
   ![image](https://github.com/user-attachments/assets/80ef7c13-d935-4767-84ef-135fb3a80fcc)
   
   *Note: The SKU for one of the items were not put in at the time of this screenshot, so it is missing the sweatpants in this order. This issue has since been fixed*



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

---
