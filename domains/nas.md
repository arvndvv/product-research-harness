# Domain guide: NAS (network attached storage)

Aliases: network attached storage, nas server, nas device, home server

No measurement table: NAS reviews rarely measure the same things in the same way. Products are
compared side by side on reviews and specs that decide fit (bays, CPU, network), not on scores.

## Decision factors

- **Use**: backups of PCs and phones, photo library, media server (Plex/Jellyfin, transcoding), file sharing, surveillance, running containers/VMs.
- **Bays and capacity plan**: how many drives now and later; RAID/SHR level and how much space it leaves.
- **Processor**: Intel chips with integrated graphics for video transcoding; enough power for containers or VMs.
- **RAM**: upgradeable or not; 4 GB minimum, 8 GB+ for containers and many apps.
- **Network**: 1 GbE vs 2.5 GbE vs 10 GbE ports; the person's router and switch speed.
- **Software**: Synology DSM, QNAP QTS, Ugreen, Asustor, or TrueNAS/Unraid on DIY hardware; backup, photo and remote access apps.
- **Drive compatibility policy**: some brands restrict or warn about third-party drives on certain models; check the current policy.
- **M.2 slots and cache**: SSD caching or fast storage pools.
- **Power use and noise**: it runs 24/7; idle power adds up.
- **Security and updates**: how long the maker supports the model with security updates; remote access security.

## What actually matters

- **Software and support length decide the experience** as much as hardware.
- **A NAS is not a backup by itself**: plan an off-site or cloud copy.
- **Network speed often limits transfers** more than the NAS hardware.

## Sources

- NASCompares and specialist NAS reviewers for hardware, software and transcoding tests.
- Maker compatibility lists for drives and RAM.
- Owner communities (Reddit r/synology, r/qnap, r/homelab, r/DataHoarder) for reliability, update and security issues.

## Pitfalls

- **Old models with outdated CPUs** are still sold at full price; check the launch year.
- **Ransomware**: exposing a NAS to the internet without care is risky; check the vendor's security track record.
- **Drive costs** are often more than the NAS itself; include them in the budget.
