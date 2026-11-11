# Domain guide: tablets

Aliases: tablet, ipad, android tablet

Scales in the Measurements table are rules of thumb for late 2026; edit them as chips improve.

## Decision factors

- **Main use**: media, note-taking with a stylus, drawing, studying, light work with a keyboard, games, a child's device.
- **Performance**: chipset benchmarks and how long it gets updates; judge by benchmarks, not core count.
- **Display**: size (8-13"), brightness, refresh rate (90-120 Hz feels smoother), panel type (LCD vs OLED), anti-glare options.
- **Stylus and keyboard support**: which pen and keyboard work, whether they're included, pen latency for drawing.
- **Battery life**: measured hours of use.
- **Software and updates**: iPadOS vs Android; years of updates; app quality for tablets (Android tablet apps are weaker).
- **Storage**: base storage and microSD support.
- **Connectivity**: Wi-Fi only vs cellular (LTE/5G), USB-C speed for external displays and drives.
- **Weight and size**: holding it one-handed vs on a desk.
- **Audio and cameras**: speakers for media; front camera placement for video calls.

## What actually matters

- **The use decides the tablet**: a drawing tablet needs a low-latency pen and good palm rejection; a media tablet needs a good screen and speakers; a study tablet needs a pen and long battery.
- **iPads have the largest tablet app ecosystem and long update support**; Android tablets vary a lot by brand in updates and app quality.
- **Accessories add a lot to the price** (pen, keyboard case); compare the total cost of what the person will actually use.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| geekbench_6_multi_core_tablet | Geekbench 6 multi-core | score | higher | 2500 | 12000 | browser.geekbench.com | chipset |
| tablet_wifi_battery_hours | Battery life, Wi-Fi browsing test | hours | higher | 7 | 15 | notebookcheck.net | - |
| tablet_brightness_nits | Display brightness, measured | nits | higher | 350 | 900 | notebookcheck.net | - |
| tablet_weight_g | Weight | grams | lower | 700 | 450 | gsmarena.com | - |

## Sources

- NotebookCheck and GSMArena for measured battery, brightness and specs.
- Geekbench Browser for chipset benchmarks.
- Owner communities (Reddit r/ipad, r/androidtablets, brand forums) for update delays, pen issues and app problems.

## Pitfalls

- **Generations and chips change under the same name** (e.g. "iPad Air" across several chips); confirm the exact model year and chip.
- **Pens and keyboards are generation-specific**: an older pen may not work with a newer tablet.
- **Budget Android tablets may stop getting updates quickly**; check the promised years.
