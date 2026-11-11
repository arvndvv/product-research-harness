# Domain guide: RAM (memory upgrades)

Aliases: ram kit, ram stick, ddr4, ddr5, so-dimm, desktop memory, laptop memory

No measurement table: buying RAM is mainly about compatibility and capacity. Measured speed
differences between kits on the same platform are small for most uses and depend on the system.

## Decision factors

- **Compatibility**: DDR4 vs DDR5; desktop (DIMM) vs laptop (SO-DIMM); what the motherboard or laptop supports (maximum capacity, speed, slots free). Soldered laptop RAM can't be upgraded.
- **Capacity**: 16 GB for general use, 32 GB for development, VMs, heavy multitasking or games, 64 GB+ for large datasets or many VMs.
- **Kit configuration**: two matched sticks for dual-channel; mixing different kits can force lower speeds or cause instability.
- **Speed and timings**: within what the platform supports (CPU memory controller and motherboard); higher than supported runs at the lower speed.
- **Profiles**: XMP (Intel) / EXPO (AMD) to run at rated speed; must be enabled in BIOS.
- **Physical fit**: heat spreader height vs large CPU coolers; low-profile modules for small cases.
- **Warranty**: most reputable brands offer lifetime or long warranties; check the local process.

## What actually matters

- **Compatibility beats speed**: the motherboard's or laptop's supported list (QVL) and manual decide what works.
- **Capacity matters more than a small speed bump** for most people.
- **For AMD Ryzen and Intel desktops, a moderate speed with good timings is the sweet spot**; extreme kits may not run stably.

## Sources

- The motherboard or laptop maker's manual and memory compatibility list (QVL) for the exact model.
- Crucial's and Kingston's compatibility finders for laptops and branded PCs.
- Hardware reviewers (Gamers Nexus, Hardware Unboxed, TechPowerUp) for platform memory scaling tests.
- Owner communities (Reddit r/buildapc, r/techsupport) for stability reports with specific boards.

## Pitfalls

- **Laptops with soldered memory** can't be upgraded at all; check before buying.
- **Speeds above what the CPU supports** need XMP/EXPO and may be unstable.
- **Mixed kits** (different brands or timings) often run at the slowest settings or fail to boot.
