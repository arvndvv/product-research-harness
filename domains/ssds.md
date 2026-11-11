# Domain guide: SSDs

Aliases: ssd, solid state drive, nvme, nvme ssd, m.2 ssd, portable ssd, external ssd

Scales are rules of thumb for late 2026.

## Decision factors

- **Use**: OS/boot drive, games, video editing (large sustained writes), laptop upgrade, external/portable backup, console storage.
- **Compatibility**: interface and form factor (M.2 NVMe vs SATA 2.5"; PCIe generation; M.2 length 2230/2242/2280 for handhelds and some laptops); free slot in the device.
- **Capacity**: 1 TB is the comfortable minimum for most; 2 TB+ for games and video.
- **Sustained write speed**: what happens after the fast SLC cache fills (matters for large file copies and video work).
- **DRAM cache or HMB**: drives without DRAM rely on host memory (HMB); fine for most uses, weaker under heavy loads.
- **NAND type**: TLC vs QLC (QLC is cheaper but slower when the cache is full and lower endurance).
- **Endurance and warranty**: TBW rating and warranty years.
- **Heat**: PCIe 4.0/5.0 drives may need a heatsink (desktops, PS5); laptops may throttle hot drives.
- **Portable SSDs**: USB-C speed (10/20/40 Gbps) and whether the computer's port supports it.

## What actually matters

- **For a typical laptop or desktop boot drive, any good TLC PCIe 4.0 drive feels the same**; peak sequential speeds rarely matter.
- **Sustained write and random small-file performance** separate good drives from cheap ones.
- **PCIe 5.0 drives** cost more and run hotter for little everyday gain.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| ssd_sustained_write_mb_s | Write speed after the SLC cache fills, measured | MB/s | higher | 300 | 2500 | techpowerup.com | - |
| ssd_random_4k_qd1_read_mb_s | Random 4K read at queue depth 1, measured | MB/s | higher | 40 | 90 | tomshardware.com | - |

## Sources

- TechPowerUp SSD reviews (sustained write, cache size, temperatures) and Tom's Hardware storage reviews.
- TechPowerUp's SSD database for controller, NAND and DRAM details by model and revision.
- Owner communities (Reddit r/NewMaxx guide, r/buildapc, r/DataHoarder) for firmware issues and silent hardware changes.

## Pitfalls

- **Silent component changes**: some models change controller or NAND between batches; check the current revision.
- **Peak "up to 7,000 MB/s" figures** are best-case sequential reads.
- **SATA M.2 vs NVMe M.2** look alike but aren't interchangeable in every slot.
