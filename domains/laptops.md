# Domain guide: laptops

Aliases: laptop, notebook, ultrabook, macbook, chromebook

Expert guidance used in every prompt when the category mentions laptops. Edit freely. The
"Decision factors" list drives the interview; the "Measurements" table seeds the benchmarks and
scales every laptop run uses. Scales are rules of thumb for late 2026: update them as chips improve.

## Decision factors

- **Processor performance**: what the work needs (browsing vs coding/Docker vs video editing vs games). Judge by benchmarks, never by core count, GHz or power rating.
- **Sustained performance and cooling**: thin and fanless designs slow down under long loads (builds, renders, games); fans keep speed but make noise.
- **RAM**: 16 GB is the practical minimum for coding, Docker or many browser tabs; check whether it's soldered (not upgradeable).
- **Storage**: 512 GB minimum for development work; check for a free M.2 slot.
- **Display**: brightness (300+ nits indoors, 400+ near windows), colour coverage for photo work, panel type (IPS vs OLED), resolution and size.
- **Refresh rate**: 60 Hz is fine for work; 120 Hz+ feels smoother and matters for gaming.
- **Battery life**: measured hours in a standard test, not the maker's claim.
- **Weight and size**: under ~1.4 kg is easy to carry daily; 14" is the usual balance.
- **Keyboard and trackpad**: key travel, backlight, trackpad size and precision.
- **Ports**: USB-C with charging and display output, USB-A, HDMI, card reader; Thunderbolt/USB4 for docks.
- **Graphics**: integrated is fine for work; a dedicated GPU only for games, 3D or local AI models.
- **Operating system and software**: macOS vs Windows vs Linux; tools the person must run.
- **Build quality and warranty**: chassis flex, hinge, service network in the person's country.

## What actually matters

- **Performance comes from the processor generation and its sustained power**, not its name. A newer
  mid-range chip often beats an older high-end one. The same chip runs faster in a laptop with better
  cooling. Compare benchmark results (Geekbench 6, Cinebench) for the exact processor.
- **Apple silicon** (M-series) is very efficient: long battery life and strong single-core speed.
  MacBook Air models are fanless and throttle under long full loads; MacBook Pro has fans.
- **For coding with Docker or local servers**, multi-core speed and RAM matter most. 8 GB is a
  bottleneck, whatever the chip.
- **Refurbished or previous-generation** premium laptops can beat new budget ones. Check battery
  health, warranty and the seller.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| geekbench_6_multi_core | Geekbench 6 multi-core | score | higher | 5000 | 15000 | browser.geekbench.com | processor |
| geekbench_6_single_core | Geekbench 6 single-core | score | higher | 1800 | 3500 | browser.geekbench.com | processor |
| laptop_weight_g | Weight | grams | lower | 2200 | 1100 | notebookcheck.net | - |
| wifi_battery_hours | Battery life, Wi-Fi browsing test | hours | higher | 5 | 16 | notebookcheck.net | - |
| display_brightness_nits | Display brightness, measured | nits | higher | 250 | 500 | notebookcheck.net | - |
| display_srgb_coverage | sRGB colour coverage, measured | % | higher | 60 | 100 | notebookcheck.net | - |
| fan_noise_load_db | Fan noise under load | dB(A) | lower | 52 | 35 | notebookcheck.net | - |

## Sources

- NotebookCheck: lab-measured brightness, colour, noise, temperatures, battery life and benchmarks for most laptops sold in India and elsewhere.
- Geekbench Browser for processor benchmarks (look at the median of many results, not the best one).
- Owner communities (Reddit r/laptops, r/SuggestALaptop, brand forums) for long-term issues: hinges, batteries, service experience.
- The maker's own spec sheet for the exact configuration (RAM type, ports, panel).

## Pitfalls

- **Same name, different internals**: one model name can ship with several processors, RAM sizes and screens. Confirm the exact configuration and part number being sold.
- **"Up to" battery claims** are often double real-world life.
- **Power-saving chips** (U-series, low TDP) are not faster for having lower power; they're slower and cooler.
- **RAM listed as "16 GB"** may be 8 GB soldered plus an 8 GB stick, or single-channel; it affects graphics and speed.
- **Regional variants** differ: keyboard layout, warranty terms, sometimes the processor.
