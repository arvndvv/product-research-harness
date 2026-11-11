# Domain guide: TVs

Aliases: tv, television, smart tv, oled tv, qled tv

Scales are rules of thumb for late 2026. RTINGS changes its test methodology between "test bench"
versions; compare scores from the same version only.

## Decision factors

- **Size and viewing distance**: bigger is usually better for the distance; check wall or stand space.
- **Panel type**: OLED (perfect blacks, best for dark rooms) vs LED/QLED/Mini-LED (brighter, better for bright rooms, no burn-in risk).
- **Room brightness**: bright rooms need high brightness and good reflection handling.
- **Content**: movies and HDR, sports (motion handling), gaming (low input lag, 120 Hz, VRR, HDMI 2.1 ports), regular TV and streaming.
- **Smart platform**: Google TV/Android TV, webOS, Tizen, Fire TV; apps the person uses; speed of the interface.
- **Sound**: built-in speakers are weak on most thin TVs; budget for a soundbar if sound matters.
- **Ports**: number of HDMI 2.1 ports for consoles, eARC for a soundbar.
- **Picture processing**: upscaling of lower-quality content (TV channels, YouTube).
- **Warranty and service**: panel warranty and service network in the person's country.

## What actually matters

- **Contrast and brightness decide picture quality** far more than resolution (almost all are 4K now).
- **Same model name, different panels**: sizes in one series can use different panel types (e.g. VA vs IPS); check the exact size.
- **Budget TVs advertise HDR they can't show**; measured HDR brightness reveals it.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| rtings_tv_mixed_usage | RTINGS mixed usage score | score | higher | 6.5 | 9 | rtings.com | - |
| tv_hdr_brightness_10pct | HDR brightness, 10% window, measured | nits | higher | 400 | 1500 | rtings.com | - |
| tv_input_lag_4k60_ms | Input lag at 4K 60 Hz, measured | ms | lower | 30 | 10 | rtings.com | - |

## Sources

- RTINGS: lab measurements of brightness, contrast, reflections, motion and input lag for most mainstream models.
- HDTVTest and specialist reviewers for picture accuracy and processing.
- Owner communities (Reddit r/4kTV, r/OLED, regional forums) for software bugs, panel issues and service experience.

## Pitfalls

- **Regional model numbers** differ (a US model and an Indian model with similar names may have different panels or features).
- **"120 Hz" claims** may be motion interpolation on a 60 Hz panel.
- **Brightness and HDR claims** ("HDR10+", "Dolby Vision") don't say how bright it actually gets.
