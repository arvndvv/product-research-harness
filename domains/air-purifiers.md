# Domain guide: air purifiers

Aliases: air purifier, hepa purifier, room air purifier

Scales are rules of thumb. CADR is a standardised measured airflow of clean air; figures are
usually published by the maker from standard tests, so prefer independently verified ones.

## Decision factors

- **Room size**: CADR should be high enough to clean the room's air ~4-5 times an hour.
- **Main problem**: PM2.5 smog and dust, allergies and pollen, pets, smoke, odours/VOCs (needs real activated carbon, not a thin layer).
- **Filter type**: true HEPA (H13) for particles; avoid ionisers or ozone generators.
- **Running cost**: price and lifespan of replacement filters; power use when running all day.
- **Noise**: at the speed needed to clean the room, especially for bedrooms (sleep mode).
- **Sensors and smart features**: PM2.5 sensor accuracy, auto mode, app; nice to have.
- **Filter availability**: genuine filters easy to buy in the person's city.

## What actually matters

- **CADR for the room size** decides whether it actually cleans the air; many purifiers are too small for their marketing.
- **Filter cost over years** often exceeds the purchase price.
- **Real HEPA with a good seal** matters; leaks around the filter reduce performance.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| purifier_cadr_m3h | Clean Air Delivery Rate for smoke/PM2.5 | m³/h | higher | 150 | 450 | maker spec sheet or independent test | - |

## Sources

- Independent tests that measure particle reduction and noise (consumer testing organisations, specialist reviewers).
- The maker's spec sheet for CADR, filter grade and filter prices.
- Owner communities and regional reviews for filter availability and long-term sensor accuracy.

## Pitfalls

- **"Covers up to 600 sq ft"** claims assume fewer air changes per hour than you need.
- **"HEPA-type" or "HEPA-like"** filters are not true HEPA.
- **Ionisers and ozone** can be harmful; avoid purifiers that produce ozone.
