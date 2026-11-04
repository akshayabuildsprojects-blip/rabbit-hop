# Prior data: archetype shopping histories

SYNTHETIC, ILLUSTRATIVE DATA. Not real sales or customer data.

Each file is 100 purchases typical of shoppers in one persona archetype, written to give Muse a
realistic "what people like me have bought before". Real brands and products, approximate US prices.
Later versions replace these with an identified shopper's own history in the same format.

Origins in scope for the demo: US, UK, French, K-beauty, J-beauty, Thai, Indian.

Files
- trend-driven-history.csv
- luxury-history.csv

Columns
- date: purchase date (Nov 2024 to Oct 2026)
- store: where it was bought (Sephora, Ulta, Olive Young US, Amazon, Target, YesStyle, Nordstrom, Saks, Neiman Marcus, Bergdorf Goodman, brand boutique, brand site)
- brand, product
- category: cleanser, serum, moisturizer, sunscreen, lip, complexion, cheek, eyes, body (toners, essences and pads are filed under serum; masks under moisturizer)
- price_usd: approximate price paid
- origin: brand origin
- tier: value, mid, prestige, luxury
- main_driver: trend, reviews, ingredients, price, brand_prestige, dupe (same values the app records for basket decisions)
- discovered_via: tiktok, instagram, youtube, friend, store display, beauty advisor, makeup artist, editorial, brand launch, dermatologist, retailer email
- rating_given: 1 to 5
- repurchased: yes if bought again
- returned: yes if returned
- note: one line in the shopper's voice
