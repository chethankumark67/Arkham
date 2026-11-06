"""
demo_data.py - Deterministic SYNTHETIC crime dataset for Suraksha-Grid demos.

Everything produced here is synthetic (generated from a fixed random seed).
It is NOT real FIR / NCRB data and must not be used for policing decisions.

`generate_dataset()` returns a dict of equal-length lists with the same keys
as `scraper.MOCK_INCIDENTS` (so it can be passed straight to
`fetch_and_ingest_public_data(custom_data=...)`) plus a few extra columns:
locality, police_station, ward, status, gang, data_source.

Patterns baked in:
  * ~12 months of incidents ending at `end` (default: today), mostly Bengaluru,
    with some Mysuru / Tumakuru for cross-jurisdiction links.
  * Per-crime-type hour-of-day profiles (snatching mornings/evenings,
    burglaries 1-4 am, cyber fraud office hours, assaults late night ...).
  * Weekend, payday (1st-3rd, 30th-31st) and festival-day effects.
  * Locality affinities per crime type (pickpocketing at Majestic, cyber fraud
    in IT corridors, house break-ins in quieter residential layouts ...).
  * 15 gangs with member aliases and vehicles; a few vehicles are shared
    between gangs so the Neo4j graph has multi-hop networks.
  * Varied FIR narrative templates so the NLP MO extractor has work to do.
  * The 10 original MOCK_INCIDENTS are included unchanged (plus extra fields).
"""

from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta

SEED = 20260611

CRIME_TYPES = [
    "Chain Snatching", "Vehicle Theft", "Shop Burglary", "House Break-in", "ATM Robbery",
    "Cyber Fraud", "Pickpocketing", "Assault", "Drug Peddling", "Eve Teasing/Harassment",
]
TYPE_WEIGHT = {
    "Chain Snatching": 11, "Vehicle Theft": 18, "Shop Burglary": 8, "House Break-in": 10, "ATM Robbery": 3,
    "Cyber Fraud": 16, "Pickpocketing": 12, "Assault": 9, "Drug Peddling": 6, "Eve Teasing/Harassment": 7,
}

# locality -> (city, lat, lon, police station, ward)
LOCALITIES: dict[str, tuple[str, float, float, str, str]] = {
    "Koramangala":     ("Bengaluru", 12.9352, 77.6245, "Koramangala PS",     "Ward 151"),
    "Indiranagar":     ("Bengaluru", 12.9784, 77.6408, "Indiranagar PS",     "Ward 80"),
    "Whitefield":      ("Bengaluru", 12.9698, 77.7500, "Whitefield PS",      "Ward 84"),
    "Marathahalli":    ("Bengaluru", 12.9591, 77.6974, "Marathahalli PS",    "Ward 85"),
    "HSR Layout":      ("Bengaluru", 12.9121, 77.6446, "HSR Layout PS",      "Ward 174"),
    "BTM Layout":      ("Bengaluru", 12.9166, 77.6101, "Mico Layout PS",     "Ward 176"),
    "Jayanagar":       ("Bengaluru", 12.9250, 77.5938, "Jayanagar PS",       "Ward 169"),
    "Majestic":        ("Bengaluru", 12.9767, 77.5713, "Upparpet PS",        "Ward 109"),
    "Shivajinagar":    ("Bengaluru", 12.9857, 77.6057, "Shivajinagar PS",    "Ward 92"),
    "MG Road":         ("Bengaluru", 12.9756, 77.6066, "Cubbon Park PS",     "Ward 111"),
    "Yeshwanthpur":    ("Bengaluru", 13.0285, 77.5400, "Yeshwanthpur PS",    "Ward 37"),
    "Hebbal":          ("Bengaluru", 13.0358, 77.5970, "Hebbal PS",          "Ward 21"),
    "KR Puram":        ("Bengaluru", 13.0076, 77.6950, "K R Puram PS",       "Ward 52"),
    "Electronic City": ("Bengaluru", 12.8452, 77.6602, "Electronic City PS", "Ward 192"),
    "Banashankari":    ("Bengaluru", 12.9255, 77.5468, "Banashankari PS",    "Ward 180"),
    "Malleshwaram":    ("Bengaluru", 13.0031, 77.5643, "Malleshwaram PS",    "Ward 45"),
    "Rajajinagar":     ("Bengaluru", 12.9910, 77.5525, "Rajajinagar PS",     "Ward 99"),
    "Yelahanka":       ("Bengaluru", 13.1007, 77.5963, "Yelahanka PS",       "Ward 4"),
    "JP Nagar":        ("Bengaluru", 12.9063, 77.5857, "JP Nagar PS",        "Ward 177"),
    "Devaraja":        ("Mysuru",    12.3080, 76.6550, "Devaraja PS",        "Mysuru Ward 22"),
    "VV Puram":        ("Mysuru",    12.3240, 76.6280, "V V Puram PS",       "Mysuru Ward 30"),
    "Kuvempunagar":    ("Mysuru",    12.2870, 76.6230, "Kuvempunagar PS",    "Mysuru Ward 51"),
    "Tumakuru Town":   ("Tumakuru",  13.3392, 77.1013, "Tumakuru Town PS",   "Tumakuru Ward 12"),
    "Kyathasandra":    ("Tumakuru",  13.3150, 77.1300, "Kyathasandra PS",    "Tumakuru Ward 31"),
}

# crime type -> boosted localities (weight 6 instead of base 1)
AFFINITY: dict[str, list[str]] = {
    "Chain Snatching": ["Jayanagar", "Banashankari", "JP Nagar", "Rajajinagar", "Malleshwaram", "BTM Layout", "HSR Layout"],
    "Vehicle Theft": ["Marathahalli", "Whitefield", "Koramangala", "Yeshwanthpur", "Electronic City", "KR Puram"],
    "Shop Burglary": ["Majestic", "Shivajinagar", "Yeshwanthpur", "KR Puram", "Tumakuru Town"],
    "House Break-in": ["Hebbal", "Yelahanka", "HSR Layout", "JP Nagar", "Banashankari", "Kuvempunagar"],
    "ATM Robbery": ["Electronic City", "Yelahanka", "KR Puram", "Kyathasandra"],
    "Cyber Fraud": ["Whitefield", "Electronic City", "Marathahalli", "Koramangala", "HSR Layout"],
    "Pickpocketing": ["Majestic", "Shivajinagar", "KR Puram", "MG Road", "Devaraja"],
    "Assault": ["Majestic", "Koramangala", "Indiranagar", "MG Road"],
    "Drug Peddling": ["Koramangala", "Indiranagar", "HSR Layout", "Shivajinagar"],
    "Eve Teasing/Harassment": ["MG Road", "Majestic", "Koramangala", "Jayanagar"],
}
NON_BLR_BASE = 0.45  # base weight for Mysuru / Tumakuru localities

# hour profiles: list of (centre_hour, width, weight)
HOUR_PROFILE: dict[str, list[tuple[float, float, float]]] = {
    "Chain Snatching": [(7, 1.2, 0.8), (19.5, 1.5, 1.0)],
    "Vehicle Theft": [(1, 2.5, 1.0), (21, 2.0, 0.6), (13, 3.0, 0.3)],
    "Shop Burglary": [(2.5, 1.2, 1.0)],
    "House Break-in": [(2.5, 1.3, 1.0), (13, 2.0, 0.5)],
    "ATM Robbery": [(1.5, 1.5, 1.0)],
    "Cyber Fraud": [(13, 3.5, 1.0)],
    "Pickpocketing": [(9, 1.3, 1.0), (18.5, 1.5, 1.0)],
    "Assault": [(23, 2.0, 1.0), (16, 3, 0.2)],
    "Drug Peddling": [(21.5, 2.5, 1.0)],
    "Eve Teasing/Harassment": [(19, 2.0, 1.0), (9, 1.5, 0.4)],
}
WEEKEND_BOOST = {"Assault": 1.6, "Drug Peddling": 1.5, "Pickpocketing": 1.3, "Eve Teasing/Harassment": 1.4, "Vehicle Theft": 1.15}
PAYDAY_BOOST = {"Pickpocketing": 1.5, "Chain Snatching": 1.3, "ATM Robbery": 1.6, "Cyber Fraud": 1.4}
FESTIVAL_BOOST = {"Chain Snatching": 2.0, "Pickpocketing": 2.0, "House Break-in": 1.8, "Eve Teasing/Harassment": 1.5}
ATTRIBUTION = {
    "Chain Snatching": 0.45, "Vehicle Theft": 0.40, "Shop Burglary": 0.50, "House Break-in": 0.35, "ATM Robbery": 0.55,
    "Cyber Fraud": 0.30, "Pickpocketing": 0.25, "Assault": 0.08, "Drug Peddling": 0.50, "Eve Teasing/Harassment": 0.04,
}

FESTIVALS = {  # month-day pairs (approximate Karnataka festival calendar)
    (1, 1), (1, 14), (1, 15), (3, 19), (3, 20), (4, 14), (8, 15), (8, 27), (9, 14), (9, 15),
    (10, 1), (10, 2), (10, 20), (10, 21), (10, 22), (11, 1), (12, 24), (12, 25), (12, 31),
}

# 15 gangs: (gang name, member aliases, crime types, turf localities, vehicles)
GANGS: list[tuple[str, list[str], list[str], list[str], list[str]]] = [
    ("Ravi Kulla Gang", ["Ravi_Kulla_Gang", "Kulla_Manja", "Pidi_Suresh"], ["Vehicle Theft"],
     ["Marathahalli", "Whitefield", "Devaraja", "VV Puram"], ["KA03AB9876", "KA01HH1234"]),
    ("Shutter Jack Crew", ["Shutter_Jack_Crew", "Jack_Naveen"], ["Shop Burglary"],
     ["Tumakuru Town", "Majestic", "Yeshwanthpur", "Kyathasandra"], ["KA05XY5544", "KA06MB2210"]),
    ("Black Helmet Riders", ["Unknown (Black Helmet)", "Helmet_Rider_002", "Pulsar_Prakash"], ["Chain Snatching"],
     ["Jayanagar", "Banashankari", "JP Nagar", "Devaraja"], ["KA05HK7781", "KA41EP0912"]),
    ("Silk Board Snatchers", ["Silk_Sathya", "Bomb_Bharath"], ["Chain Snatching"],
     ["BTM Layout", "HSR Layout", "Koramangala"], ["KA51ER4410", "KA41EP0912"]),
    ("Night Owl Burglars", ["Gulla_Ganesha", "Owl_Ramesh", "Crowbar_Kitty"], ["House Break-in"],
     ["Hebbal", "Yelahanka", "Kuvempunagar"], ["KA04MN3321", "KA50Q8820"]),
    ("Layout Lockbreakers", ["Lock_Lokesh", "Tamate_Tippu"], ["House Break-in", "Shop Burglary"],
     ["HSR Layout", "JP Nagar", "Banashankari"], ["KA05MF6650", "KA06MB2210"]),
    ("Cash Box Crew", ["Gas_Cutter_Guna", "ATM_Anil"], ["ATM Robbery"],
     ["Electronic City", "KR Puram", "Kyathasandra", "Yelahanka"], ["KA53Z1209", "KA50Q8820"]),
    ("Jamtara Link Cell", ["OTP_Mohan", "KYC_Kiran", "Sim_Swap_Sunny"], ["Cyber Fraud"],
     ["Whitefield", "Electronic City", "Marathahalli"], ["KA03NC5567"]),
    ("Loan App Syndicate", ["App_Arjun", "Recovery_Raju"], ["Cyber Fraud"],
     ["Koramangala", "HSR Layout", "Devaraja"], ["KA01ML4432", "KA03NC5567"]),
    ("Majestic Pocket Gang", ["Pocket_Pandu", "Bus_Stand_Babu", "Fingers_Faizal"], ["Pickpocketing"],
     ["Majestic", "Shivajinagar", "KR Puram"], ["KA02JH9087"]),
    ("Brigade Pickers", ["Brigade_Bunty", "Metro_Manju"], ["Pickpocketing", "Chain Snatching"],
     ["MG Road", "Shivajinagar", "Indiranagar"], ["KA02JH9087", "KA01EX2045"]),
    ("Ganja Route Ring", ["Dope_Dinesh", "Hash_Harish", "Courier_Kumar"], ["Drug Peddling"],
     ["Koramangala", "Indiranagar", "HSR Layout", "Devaraja"], ["KA09P3346", "KA01ML4432"]),
    ("Club Street Peddlers", ["Pill_Prem", "Nigerian_Link_Nick"], ["Drug Peddling"],
     ["Indiranagar", "Shivajinagar", "MG Road"], ["KA01EX2045"]),
    ("Yeshwanthpur Lifters", ["Lifter_Lingaraju", "Duplicate_Key_Dasa"], ["Vehicle Theft", "Shop Burglary"],
     ["Yeshwanthpur", "Rajajinagar", "Malleshwaram", "Tumakuru Town"], ["KA04MN3321", "KA06TT7712"]),
    ("Outer Ring Road Crew", ["ORR_Om", "Scanner_Santosh"], ["Vehicle Theft"],
     ["KR Puram", "Marathahalli", "Electronic City", "Whitefield"], ["KA53Z1209", "KA51ER4410"]),
]

LANDMARKS = ["metro station", "bus stop", "temple", "bakery", "petrol bunk", "park gate", "school", "market",
             "hospital", "darshini hotel", "apartment complex", "IT park", "railway station", "main road junction"]
TWO_WHEELERS = ["Honda Activa", "TVS Jupiter", "Bajaj Pulsar", "Royal Enfield Classic", "Hero Splendor", "Yamaha FZ"]
CARS = ["Maruti Swift", "Hyundai i20", "Toyota Innova", "Maruti Alto"]
GOODS = ["mobile phones", "laptops", "cash from the counter", "branded garments", "electronics", "liquor stock"]

TEMPLATES: dict[str, list[str]] = {
    "Chain Snatching": [
        "Victim's gold chain of {grams} grams snatched near {landmark} in {loc} by two riders on a black motorcycle wearing helmets.",
        "Complainant was walking near {landmark}, {loc} when a pillion rider snatched her mangalsutra and fled on a bike.",
        "Two helmet-wearing suspects on a motorcycle without number plate snatched a gold chain near {landmark} at {loc}.",
        "Elderly woman's chain snatched during {period} walk near {landmark}, {loc}; riders escaped towards the ring road.",
    ],
    "Vehicle Theft": [
        "{tw} stolen from parking lot near {landmark}, {loc} using master key during {period} hours.",
        "Complainant's {tw} parked outside residence in {loc} found missing; ignition bypassed, suspected duplicate key.",
        "{car} stolen from apartment basement parking in {loc}; CCTV shows suspects using master key bypass.",
        "Two-wheeler stolen from {landmark} parking at {loc}; lock broken and vehicle pushed away.",
    ],
    "Shop Burglary": [
        "Commercial storefront shutter jacked using hydraulic jack at {loc} around 3 AM; {goods} stolen.",
        "Shop shutter lifted with crowbar near {landmark}, {loc}; burglary of {goods} worth Rs {amount}.",
        "Burglary at mobile shop in {loc}: shutter lock cut, {goods} stolen during night hours.",
    ],
    "House Break-in": [
        "House break-in at {loc}: front door lock broken while family was away, gold ornaments and cash stolen.",
        "Residential house in {loc} burgled; window grill removed and almirah broken open at night.",
        "Locked house near {landmark}, {loc} broken into during daytime; door latch cut, jewellery worth Rs {amount} missing.",
    ],
    "ATM Robbery": [
        "ATM kiosk near {landmark}, {loc} attacked at night; cash cassette robbery attempted using gas cutter.",
        "Customer robbed of cash at knife point after withdrawal at ATM in {loc}; Rs {amount} taken.",
        "Unguarded ATM in {loc} broken open; robbery of Rs {amount} cash, CCTV camera spray-painted.",
    ],
    "Cyber Fraud": [
        "Victim from {loc} lost Rs {amount} in online UPI fraud after sharing OTP with caller posing as bank official.",
        "Phishing link received via SMS; complainant in {loc} entered card details and Rs {amount} was debited online.",
        "Complainant in {loc} cheated of Rs {amount} through fake part-time job online fraud using UPI transfers.",
        "Loan app harassment and online fraud: victim in {loc} paid Rs {amount} via UPI after threats.",
    ],
    "Pickpocketing": [
        "Wallet containing Rs {amount} and cards picked from complainant's pocket in crowded bus at {loc}.",
        "Mobile phone picked from pocket near {landmark}, {loc} during rush hour crowd.",
        "Purse stolen from handbag in crowd at {landmark}, {loc}; complainant noticed after boarding.",
    ],
    "Assault": [
        "Complainant assaulted by a group of three persons near {landmark}, {loc} after a quarrel; injuries to head.",
        "Road rage incident at {loc}: victim beaten with a wooden stick near {landmark}.",
        "Fight outside a pub in {loc} late night; one person stabbed with a knife, admitted to hospital.",
    ],
    "Drug Peddling": [
        "Accused caught selling ganja near {landmark}, {loc}; {grams} grams seized under NDPS Act.",
        "Raid in {loc} recovered MDMA pills and ganja packets meant for sale to college students.",
        "Peddler intercepted near {landmark}, {loc} with hashish oil hidden in courier parcel.",
    ],
    "Eve Teasing/Harassment": [
        "Woman stalked and harassed by unknown person near {landmark}, {loc}; obscene comments passed.",
        "Complainant harassed on her way home in {loc} by two persons who followed her from {landmark}.",
        "College student received lewd remarks and was followed near {landmark}, {loc}.",
    ],
}


def _hour_weights(ctype: str) -> list[float]:
    w = []
    for h in range(24):
        s = 0.03
        for c, wd, wt in HOUR_PROFILE[ctype]:
            d = min(abs(h - c), 24 - abs(h - c))
            s += wt * math.exp(-0.5 * (d / wd) ** 2)
        w.append(s)
    return w


def _status(rng: random.Random, attributed: bool, age_days: int, ctype: str) -> str:
    if attributed:
        p = [("Charge-sheeted", .45), ("Closed", .12), ("Under Investigation", .38), ("Undetected", .05)]
    elif age_days > 90:
        p = [("Undetected", .42), ("Closed", .22), ("Charge-sheeted", .12), ("Under Investigation", .24)]
    else:
        p = [("Under Investigation", .7), ("Undetected", .15), ("Closed", .08), ("Charge-sheeted", .07)]
    if ctype == "Cyber Fraud" and not attributed:
        p = [("Under Investigation", .5), ("Undetected", .4), ("Closed", .05), ("Charge-sheeted", .05)]
    if ctype in ("Drug Peddling",):  # arrests made at spot
        p = [("Charge-sheeted", .6), ("Under Investigation", .35), ("Closed", .05), ("Undetected", .0)]
    names, wts = zip(*p)
    return rng.choices(names, wts)[0]


def _nearest_locality(lat: float, lon: float) -> str:
    return min(LOCALITIES, key=lambda k: (LOCALITIES[k][1] - lat) ** 2 + (LOCALITIES[k][2] - lon) ** 2)


def generate_dataset(end: date | None = None, days: int = 365, daily_rate: float = 2.2,
                     seed: int = SEED, include_original_mocks: bool = True) -> dict[str, list]:
    """Return the synthetic dataset as a dict of equal-length lists."""
    rng = random.Random(seed)
    end = end or date.today()
    start = end - timedelta(days=days - 1)
    gang_by_type: dict[str, list[int]] = {}
    for gi, g in enumerate(GANGS):
        for t in g[2]:
            gang_by_type.setdefault(t, []).append(gi)
    hour_w = {t: _hour_weights(t) for t in CRIME_TYPES}
    loc_names = list(LOCALITIES)

    cols = ["incident_id", "city", "crime_type", "latitude", "longitude", "timestamp", "fir_text", "suspect_alias",
            "vehicle_plate", "is_festival", "is_payday", "locality", "police_station", "ward", "status", "gang", "data_source"]
    out: dict[str, list] = {c: [] for c in cols}
    n = 0
    for di in range(days):
        d = start + timedelta(days=di)
        festival = int((d.month, d.day) in FESTIVALS)
        payday = int(d.day <= 3 or d.day >= 30)
        weekend = d.weekday() >= 5
        season = 1.0 + 0.12 * math.sin(2 * math.pi * (di / 365.0)) + 0.15 * (di / days)  # mild upward trend
        # Per-type intensity for the day
        tw = []
        for t in CRIME_TYPES:
            w = TYPE_WEIGHT[t] * season
            if weekend: w *= WEEKEND_BOOST.get(t, 1.0)
            if payday: w *= PAYDAY_BOOST.get(t, 1.0)
            if festival: w *= FESTIVAL_BOOST.get(t, 1.0)
            tw.append(w)
        lam = daily_rate * sum(tw) / sum(TYPE_WEIGHT.values())
        # Poisson draw (Knuth)
        L, k, p = math.exp(-lam), 0, 1.0
        while True:
            p *= rng.random()
            if p <= L:
                break
            k += 1
        for _ in range(k):
            ctype = rng.choices(CRIME_TYPES, tw)[0]
            gang = None
            if gang_by_type.get(ctype) and rng.random() < ATTRIBUTION[ctype]:
                gang = GANGS[rng.choice(gang_by_type[ctype])]
            if gang and rng.random() < 0.85:
                loc = rng.choice(gang[3])
            else:
                lw = [(6 if l in AFFINITY[ctype] else 1) * (1 if LOCALITIES[l][0] == "Bengaluru" else NON_BLR_BASE) for l in loc_names]
                loc = rng.choices(loc_names, lw)[0]
            city, clat, clon, station, ward = LOCALITIES[loc]
            lat = clat + rng.gauss(0, 0.0045)
            lon = clon + rng.gauss(0, 0.0045)
            hour = rng.choices(range(24), hour_w[ctype])[0]
            ts = datetime(d.year, d.month, d.day, hour, rng.randrange(60), 0)
            period = "night" if hour >= 21 or hour < 5 else "evening" if hour >= 17 else "morning" if hour < 12 else "afternoon"
            text = rng.choice(TEMPLATES[ctype]).format(
                loc=loc, landmark=rng.choice(LANDMARKS), period=period, tw=rng.choice(TWO_WHEELERS),
                car=rng.choice(CARS), goods=rng.choice(GOODS), amount=f"{rng.randrange(5, 400) * 500:,}",
                grams=rng.randrange(8, 60))
            n += 1
            out["incident_id"].append(f"SYN-{d:%y%m}-{n:05d}")
            out["city"].append(city)
            out["crime_type"].append(ctype)
            out["latitude"].append(round(lat, 6))
            out["longitude"].append(round(lon, 6))
            out["timestamp"].append(ts.strftime("%Y-%m-%d %H:%M:%S"))
            out["fir_text"].append(text)
            out["suspect_alias"].append(rng.choice(gang[1]) if gang else "Unknown")
            out["vehicle_plate"].append(rng.choice(gang[4]) if gang else "UNKNOWN")
            out["is_festival"].append(festival)
            out["is_payday"].append(payday)
            out["locality"].append(loc)
            out["police_station"].append(station)
            out["ward"].append(ward)
            out["status"].append(_status(rng, gang is not None, (end - d).days, ctype))
            out["gang"].append(gang[0] if gang else "")
            out["data_source"].append("synthetic")

    if include_original_mocks:
        from scraper import MOCK_INCIDENTS
        alias_gang = {a: g[0] for g in GANGS for a in g[1]}
        for i in range(len(MOCK_INCIDENTS["incident_id"])):
            for c in MOCK_INCIDENTS:
                out[c].append(MOCK_INCIDENTS[c][i])
            loc = _nearest_locality(MOCK_INCIDENTS["latitude"][i], MOCK_INCIDENTS["longitude"][i])
            out["locality"].append(loc)
            out["police_station"].append(LOCALITIES[loc][3])
            out["ward"].append(LOCALITIES[loc][4])
            out["status"].append("Under Investigation")
            out["gang"].append(alias_gang.get(MOCK_INCIDENTS["suspect_alias"][i], ""))
            out["data_source"].append("synthetic (original mock)")
    return out


if __name__ == "__main__":
    import collections
    ds = generate_dataset()
    print(len(ds["incident_id"]), "incidents")
    print(collections.Counter(ds["crime_type"]).most_common())
    print(collections.Counter(ds["city"]).most_common())
