# Domain guide: smartphones

Aliases: smartphones, phone, mobile phone, mobile, iphone, android phone

Expert guidance used in every prompt when the category mentions smartphones. Edit freely. The
"Decision factors" list drives the interview; the "Measurements" table seeds the benchmarks and
scales every phone run uses. Scales are rules of thumb for late 2026.

## Decision factors

- **Performance**: everyday smoothness vs heavy gaming; judge by the chipset's benchmarks and sustained performance, not core count or GHz.
- **Camera**: which matters (main, ultrawide, zoom, selfie, video, low light); judge by tests and samples, not megapixels.
- **Battery life**: measured endurance, not mAh alone.
- **Charging**: wired speed, charger in the box, wireless charging.
- **Display**: brightness outdoors, refresh rate (120 Hz is now common), size, panel type (OLED vs LCD).
- **Software and updates**: OS (Android or iOS), years of OS and security updates promised, bloatware or ads.
- **Size and weight**: one-handed use, pocketability.
- **Build and durability**: water/dust rating (IP67/68), glass protection, frame material.
- **Storage**: base storage and whether there's a microSD slot.
- **Connectivity**: 5G bands for the person's carrier, eSIM, NFC for payments.
- **After-sales service**: service centres and parts availability in the person's country.

## What actually matters

- **Chipset generation decides speed and efficiency**; a last-year flagship chip often beats a new mid-range one. Sustained performance (throttling) matters for gaming.
- **Battery life depends on chipset efficiency and software**, not only capacity; measured tests separate them.
- **Update policy is part of the price**: 6-7 years (Google, Samsung flagships, Apple) vs 2-3 years on many budget phones.
- **Camera quality comes from sensor size and processing**, which megapixel counts don't show. Lab scores and sample comparisons are the evidence.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| geekbench_6_multi_core_phone | Geekbench 6 multi-core | score | higher | 2500 | 9500 | browser.geekbench.com | chipset |
| gsmarena_active_use_hours | GSMArena Active Use Score | hours | higher | 9 | 16 | gsmarena.com | - |
| dxomark_camera_score | DXOMARK camera score | score | higher | 110 | 160 | dxomark.com | - |
| peak_brightness_nits | Peak brightness, measured | nits | higher | 600 | 1800 | gsmarena.com | - |
| phone_weight_g | Weight | grams | lower | 230 | 165 | gsmarena.com | - |

## Sources

- GSMArena: specs, measured battery (Active Use Score), brightness and charging tests.
- DXOMARK: camera, display and battery lab scores (not every phone is tested, especially budget models).
- Geekbench Browser for chipset benchmarks (use typical results, not the best one).
- Owner communities (Reddit r/Android, r/iphone, r/IndianGaming, brand forums) for long-term issues: software bugs, green-line display faults, update delays.
- Local retailers and brand stores for current prices and the exact variant sold in the person's country.

## Pitfalls

- **Regional variants** can differ in chipset (e.g. Exynos vs Snapdragon), bands and features. Confirm the variant sold in the person's country.
- **Model names**: "Pro", "Plus", "Ultra", "FE", "5G" variants differ in cameras, chipset and battery.
- **Megapixels and "100x zoom"** are marketing; most long zoom is digital.
- **Charging claims** ("120 W") mean little if the phone heats and slows charging, or the charger isn't in the box.
- **Budget phones may show ads** in system apps; owner reports reveal this.
