# Domain guide: hard drives (HDDs)

Aliases: hdd, hard drive, hard disk, external hard drive, nas drive, internal hard drive

Scales are rules of thumb for late 2026. Backblaze publishes failure rates only for drive models
it uses in its data centres, so many retail models have no figure (they'll be compared side by side).

## Decision factors

- **Use**: backup/external storage, a NAS (24/7), surveillance recording, a desktop data drive, archive.
- **Capacity and price per TB**: larger drives usually cost less per TB.
- **Drive line for the use**: NAS-rated drives for RAID and 24/7 (vibration tolerance, error recovery), desktop drives for single PCs, surveillance drives for constant writing.
- **Recording technology**: CMR vs SMR (SMR drives are slow at rewriting and can fail RAID rebuilds; avoid for NAS).
- **Speed**: rotation speed (5400 vs 7200 rpm) and measured sustained transfer.
- **Noise and heat**: 7200 rpm and enterprise drives are louder; matters in a living room or bedroom.
- **Reliability**: measured failure rates where available; warranty length (2-5 years).
- **External drives**: USB-C vs USB-A, need for a power adapter (3.5" externals).

## What actually matters

- **For a NAS, use CMR NAS-rated drives** and buy from authorised sellers (warranty).
- **Reliability varies by specific model and capacity**, not just brand; large-scale failure statistics are the best evidence.
- **Every drive fails eventually**: backups matter more than the drive choice.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| backblaze_annual_failure_rate | Annualized failure rate (Backblaze Drive Stats) | % | lower | 2 | 0.5 | backblaze.com | - |
| hdd_sustained_read_mb_s | Sustained read speed, measured | MB/s | higher | 140 | 270 | storagereview.com | - |

## Sources

- Backblaze Drive Stats (quarterly failure data by model).
- StorageReview, Tom's Hardware and TechPowerUp for measured speed and noise.
- Owner communities (Reddit r/DataHoarder, r/homelab) for SMR disclosures, shucking and warranty experiences.

## Pitfalls

- **SMR drives sold without clear labelling** (some desktop lines); check the model's recording technology.
- **Recertified or refurbished drives** sold as new on marketplaces; check serial numbers and warranty status.
- **External drives may contain lower-grade internal drives** than the same brand's internal lines.
