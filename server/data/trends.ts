import type { TrendSignal } from "../../shared/types.js";

// Curated, simulated social signals. Creator handles are fictional.
// Every agent receives this same feed so differences come from persona alone.
export const TRENDS: TrendSignal[] = [
  { id: "t1", platform: "TikTok", creator: "@glossdiaries", headline: "One dot of Soft Pinch and you look like you slept 10 hours. Still the blush of the year.", productIds: ["k1"], sentiment: "hype", engagement: "4.1M views" },
  { id: "t2", platform: "TikTok", creator: "@dupe.daily", headline: "Sephora Collection Cheek Flush vs Soft Pinch side by side. Can you tell which is which?", productIds: ["k2", "k1"], sentiment: "positive", engagement: "1.8M views" },
  { id: "t3", platform: "Instagram", creator: "@ateliervanity", headline: "Dior Lip Glow Oil is the only gloss I carry this fall. Worth it for the packaging alone.", productIds: ["l2"], sentiment: "hype", engagement: "312K likes" },
  { id: "t4", platform: "TikTok", creator: "@dupe.daily", headline: "The $12 Sephora lip oil that feels identical to the $40 Dior one.", productIds: ["l3", "l2"], sentiment: "positive", engagement: "2.6M views" },
  { id: "t5", platform: "YouTube", creator: "Dr. Lena Okafor (derm)", headline: "Skip the $200 cream. Ceramides and oat do more for your barrier than any miracle broth.", productIds: ["m3", "m1"], sentiment: "skeptical", engagement: "890K views" },
  { id: "t6", platform: "Reddit", creator: "r/SkincareAddiction", headline: "Megathread: Unseen Sunscreen is still the most recommended daily SPF for makeup wearers.", productIds: ["u1"], sentiment: "positive", engagement: "2.3K upvotes" },
  { id: "t7", platform: "TikTok", creator: "@clockoutglow", headline: "Glass skin in 30 seconds: Niacinamide Dew Drops under Hollywood Flawless Filter.", productIds: ["s5", "f2"], sentiment: "hype", engagement: "3.4M views" },
  { id: "t8", platform: "Reddit", creator: "r/MakeupAddiction", headline: "Hot take: Dew Drops is a highlighter pretending to be skincare. Check the ingredient list.", productIds: ["s5"], sentiment: "mixed", engagement: "1.1K upvotes" },
  { id: "t9", platform: "Instagram", creator: "@thequietshelf", headline: "My forever shelf: Tatcha Dewy Skin Cream, Pillow Talk lipstick, Miss Dior. Buy once, buy well.", productIds: ["m2", "l5", "b4"], sentiment: "positive", engagement: "148K likes" },
  { id: "t10", platform: "TikTok", creator: "@scentstack", headline: "Cheirosa 62 plus Bum Bum Cream layering is why strangers ask what you're wearing.", productIds: ["b2", "b1"], sentiment: "hype", engagement: "5.0M views" },
  { id: "t11", platform: "YouTube", creator: "Formula Files", headline: "Vitamin C showdown: C-Firma vs The Ordinary 12%. The cheap one is gentler, the pricey one works faster.", productIds: ["s2", "s3"], sentiment: "mixed", engagement: "420K views" },
  { id: "t12", platform: "Reddit", creator: "r/SkincareAddiction", headline: "Paula's Choice BHA remains the most effective blackhead treatment per dollar.", productIds: ["s7"], sentiment: "positive", engagement: "1.7K upvotes" },
];
