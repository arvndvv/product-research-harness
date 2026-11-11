# Domain guide: power banks

Aliases: power bank, portable charger, battery pack

Scales are rules of thumb for late 2026.

## Decision factors

- **What it charges**: phones only, tablets, laptops (needs USB-C Power Delivery at 45-100 W), several devices at once.
- **Capacity**: mAh at the cell voltage overstates what reaches the device; measured usable capacity is what counts.
- **Output power and protocols**: USB-C PD wattage, PPS for fast-charging Samsung phones, total output with several ports in use.
- **Recharge speed**: input wattage; how long the power bank takes to refill.
- **Ports**: number of USB-C and USB-A ports, built-in cables.
- **Size and weight**: pocket vs bag.
- **Travel rules**: airlines usually allow up to 100 Wh in cabin luggage without approval.
- **Safety and certification**: BIS certification in India; battery protection; reputable brand.
- **Extras**: display showing charge level, pass-through charging, magnetic (MagSafe/Qi2) wireless charging.

## What actually matters

- **Usable capacity is typically 60-85% of the printed mAh** after voltage conversion; better power banks are at the top of that range.
- **Laptop charging needs real PD output** at the laptop's wattage; many "PD" banks stop at 20-30 W.
- **Safety**: cheap no-name cells are a fire risk; buy certified, reputable brands.

## Measurements

| key | label | unit | better | poor | good | source | part |
|---|---|---|---|---|---|---|---|
| power_bank_usable_capacity_pct | Usable capacity as % of rated, measured | % | higher | 60 | 85 | chargerlab.com | - |

## Sources

- ChargerLAB and specialist charger reviewers for measured capacity, output and protocol support.
- Owner communities (Reddit r/UsbCHardware) for real-world laptop charging and failures.

## Pitfalls

- **Inflated capacity claims** on no-name brands.
- **"PD fast charging"** may only be 18-20 W.
- **Wireless charging is inefficient**: expect fewer charges than the capacity suggests.
