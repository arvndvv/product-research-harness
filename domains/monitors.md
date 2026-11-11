# Domain guide: monitors

Aliases: monitor, gaming monitor, computer monitor, pc monitor

Scales are rules of thumb for late 2026. RTINGS methodology changes between test versions;
compare scores from the same version.

## Decision factors

- **Main use**: office work, coding, photo/video editing, competitive gaming, console gaming, a mix.
- **Size and resolution**: 24" 1080p, 27" 1440p, 27-32" 4K are the usual balances; text sharpness matters for coding.
- **Refresh rate and response time**: 60-75 Hz for work; 144 Hz+ with fast response for gaming.
- **Panel type**: IPS (colours, angles), VA (contrast, slower dark transitions), OLED (best contrast and speed, burn-in risk with static content).
- **Colour accuracy and gamut**: important for photo/video work.
- **Connectivity**: USB-C with power delivery for laptops (one cable), DisplayPort/HDMI versions, built-in KVM or USB hub.
- **Ergonomics**: height, tilt, swivel, pivot; VESA mount.
- **Brightness and HDR**: only matters for bright rooms or real HDR (most cheap "HDR400" monitors don't do HDR well).
- **Warranty and dead-pixel policy** in the person's country.

## What actually matters

- **For a laptop user, USB-C with enough power delivery** (65 W+) is a big convenience.
- **Pixel density decides text sharpness**: 27" at 1080p looks soft for coding.
- **Measured response time and overshoot** decide gaming motion clarity, not the "1 ms" claim.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| rtings_monitor_office | RTINGS office usage score | score | higher | 6.5 | 9 | rtings.com | - |
| rtings_monitor_pc_gaming | RTINGS PC gaming score | score | higher | 6.5 | 9 | rtings.com | - |
| monitor_response_time_ms | Total response time, measured | ms | lower | 12 | 3 | rtings.com | - |
| monitor_input_lag_ms | Input lag at native refresh, measured | ms | lower | 15 | 3 | rtings.com | - |

## Sources

- RTINGS and Monitors Unboxed / Hardware Unboxed for measured response time, input lag, colour and brightness.
- TFTCentral for in-depth panel testing.
- Owner communities (Reddit r/Monitors, r/OLED_Gaming) for QC issues, firmware and burn-in reports.

## Pitfalls

- **"1 ms" response claims** are best-case figures with heavy overshoot; check measurements.
- **Panel lottery**: backlight bleed and dead pixels vary by unit; check the return policy.
- **Same model, revisions**: firmware or panel revisions can change behaviour.
