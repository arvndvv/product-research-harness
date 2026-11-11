# Domain guide: graphics cards (GPUs)

Aliases: gpu, graphics card, video card

Scales are rules of thumb for late 2026; update them as new generations launch. The benchmark is a
property of the GPU chip (shared by every card with that chip); power draw and noise depend on the
specific card (cooler and factory settings).

## Decision factors

- **Use**: gaming (which games, resolution and target frame rate), video editing, 3D rendering, local AI models (needs VRAM).
- **Performance**: measured gaming performance at the person's resolution; judge by benchmarks, not memory clock or core counts.
- **VRAM**: 8 GB is now limiting at 1440p and for many new games; 12-16 GB+ for high settings, 16 GB+ for local AI.
- **Features**: upscaling and frame generation (DLSS, FSR, XeSS), ray tracing performance, video encoders, CUDA for AI/creative software.
- **Power and PSU**: card power draw, required PSU wattage and connectors (8-pin, 12V-2x6).
- **Size**: length and slot thickness vs the case; cooling in a small case.
- **Noise and temperatures**: depend on the card model (cooler), not the chip.
- **Platform**: PCIe version, CPU bottleneck with older processors.
- **Warranty and service**: varies a lot by card maker in the person's country.

## What actually matters

- **Compare chips first, then cards**: two cards with the same chip perform within a few percent; their coolers, noise and price differ.
- **Price per frame at the person's resolution** is the honest comparison.
- **Software features** (DLSS on NVIDIA, CUDA for AI) can decide between similar-performing chips.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| 3dmark_time_spy_graphics | 3DMark Time Spy graphics score | score | higher | 6000 | 25000 | 3dmark.com | gpu chip |
| gpu_gaming_power_w | Power draw while gaming, measured | W | lower | 320 | 130 | techpowerup.com | - |
| gpu_load_noise_dba | Fan noise under gaming load, measured | dB(A) | lower | 40 | 28 | techpowerup.com | - |

## Sources

- TechPowerUp: per-card reviews with measured performance, power, noise and temperatures; relative performance charts.
- Hardware Unboxed, Gamers Nexus, Digital Foundry for multi-game benchmarks and frame-time analysis.
- 3DMark results databases for synthetic scores.
- Owner communities (Reddit r/buildapc, r/nvidia, r/Amd, r/IndianGaming) for coil whine, driver issues and local prices.

## Pitfalls

- **Same name, cut-down variants** (e.g. 8 GB vs 16 GB versions, laptop vs desktop chips with the same name) perform very differently.
- **Laptop GPUs** are not desktop GPUs: performance depends on the laptop's power limit.
- **Used mining cards** and grey-market imports may have no warranty.
