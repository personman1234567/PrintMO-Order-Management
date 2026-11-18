// Legacy deductions are preserved; new orders require versioned garment-plus-print pricing.
// Dated pilot overrides preserve the previously confirmed report; they do not price future sales.
export const DEFAULT_STOREFRONT_REPORT_PROFILE = {
  "version": "versioned-fulfillment-and-protected-legacy-2026-11-16-v3",
  "owners": [
    {
      "id": "dr-dallas",
      "name": "The Dr. Dallas Show",
      "partnerId": "gid://shopify/Metaobject/241830428920",
      "collectionId": "gid://shopify/Collection/481089487096",
      "logoUrl": "./report-assets/dr-dallas-logo.png",
      "rates": [
        {
          "variantId": "gid://shopify/ProductVariant/48882493096184",
          "sku": "B00660437",
          "effectiveFrom": "2026-06-10",
          "effectiveTo": "2026-11-05",
          "unitBaseCents": 856,
          "approved": true,
          "source": "Owner-confirmed finalized Dr_Dallas_Storefront_Earnings_2026-11-05.pdf: classic tee earnings $13 per item; historical 2XL sale $21.56 less $13 gives base $8.56. Original reporting period only."
        },
        {
          "variantId": "gid://shopify/ProductVariant/48882474418424",
          "sku": "B00660807",
          "effectiveFrom": "2026-06-10",
          "effectiveTo": "2026-11-05",
          "unitBaseCents": 856,
          "approved": true,
          "source": "Owner-confirmed finalized Dr_Dallas_Storefront_Earnings_2026-11-05.pdf: classic tee earnings $13 per item; historical 2XL sale $21.56 less $13 gives base $8.56. Original reporting period only."
        }
      ]
    }
  ],
  "catalogPricing": {
    "approved": true,
    "source": "Print-MO owner instruction 2026-11-11: use the normal catalog item's price once; no additional printing charge.",
    "printingCents": 0,
    "productLinks": {
      "gid://shopify/Product/9874498224376": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874482331896": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874502353144": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874493636856": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/15427582918904": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/15427582558456": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874500288760": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874495996152": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874491670776": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874488852728": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874486427896": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874484396280": "gid://shopify/Product/8249250021624",
      "gid://shopify/Product/9874482921720": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874486952184": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/15427582951672": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/15427582623992": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874502811896": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874500813048": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874498748664": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874496618744": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874494193912": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874492195064": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874489966840": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/9874484953336": "gid://shopify/Product/8249292947704",
      "gid://shopify/Product/10240633929976": "gid://shopify/Product/9014783672568",
      "gid://shopify/Product/9874497667320": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874488099064": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/15427583049976": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/15427582853368": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874503893240": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874501828856": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874499862776": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874495406328": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874493178104": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874491146488": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874485969144": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/9874483937528": "gid://shopify/Product/9485485965560",
      "gid://shopify/Product/15427583017208": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/15427582787832": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874503434488": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874501435640": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874499272952": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874497241336": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874494816504": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874492784888": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874490687736": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874487476472": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874485510392": "gid://shopify/Product/9485486096632",
      "gid://shopify/Product/9874483478776": "gid://shopify/Product/9485486096632"
    }
  },
  "reportBasisNote": "New orders use the saved fulfillment price effective when placed, including printing. Earlier orders retain their previous deductions. The dated November 5 pilot exceptions remain limited to that original reporting period."
};
