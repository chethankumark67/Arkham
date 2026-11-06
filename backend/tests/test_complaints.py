import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    from app import complaints
    from app.main import app
    monkeypatch.setattr(complaints, "DATA_DIR", tmp_path)
    monkeypatch.setattr(complaints, "_seeded", False)
    monkeypatch.setattr(complaints, "_voters", {})
    return TestClient(app)


def png(exif=False):
    im = Image.new("RGB", (2400, 1200), (200, 40, 40))
    b = io.BytesIO()
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "SecretCam"
        im.save(b, "JPEG", exif=ex.tobytes())
    else:
        im.save(b, "PNG")
    return b.getvalue()


FORM = {"category": "flooding", "title": "Water on road", "description": "Deep water", "lat": "12.93",
        "lon": "77.62", "severity": "high", "reporter_name": "Asha Rao", "reporter_phone": "+91 98765 43210"}


def test_create_with_photo_and_pii_masking(client):
    r = client.post("/api/complaints", data=FORM, files=[("photos", ("a.png", png(), "image/png")),
                                                          ("photos", ("b.jpg", png(exif=True), "image/jpeg"))])
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["status"] == "new" and c["assigned_agency"] == "BBMP" and c["priority"] in ("P1", "P2", "P3")
    assert c["reporter_phone"] == "98XXXXXX10" and c["reporter_name"] == "A*** R***"
    assert len(c["photos"]) == 2
    for u in c["photos"]:
        p = client.get(u)
        assert p.status_code == 200
        im = Image.open(io.BytesIO(p.content))
        assert max(im.size) <= 1600 and not im.getexif()
    lst = client.get("/api/complaints").json()
    assert lst["total"] == 26  # 25 demo + 1
    assert "9876543210" not in str(lst) and "Asha" not in str(lst)


def test_validation_errors(client):
    assert client.post("/api/complaints", data={**FORM, "category": "aliens"}).status_code == 422
    assert client.post("/api/complaints", data={**FORM, "severity": "huge"}).status_code == 422
    assert client.post("/api/complaints", data={**FORM, "title": "x" * 121}).status_code == 422
    assert client.post("/api/complaints", data={**FORM, "reporter_phone": "12345"}).status_code == 422
    assert client.post("/api/complaints", data=FORM,
                       files=[("photos", ("x.png", b"GIF89a....", "image/png"))]).status_code == 422
    five = [("photos", (f"{i}.png", png(), "image/png")) for i in range(5)]
    assert client.post("/api/complaints", data=FORM, files=five).status_code == 422


def test_bbox_rejection(client):
    r = client.post("/api/complaints", data={**FORM, "lat": "19.07", "lon": "72.87"})
    assert r.status_code == 422 and "study area" in r.text


def test_list_filters_and_contract(client):
    items = client.get("/api/complaints?status=open&limit=200").json()["items"]
    assert items and all(i["status"] in ("new", "acknowledged", "in_progress") for i in items)
    for k in ("id", "category", "title", "lat", "lon", "severity", "priority", "status", "upvotes", "created_at",
              "assigned_agency"):
        assert k in items[0]
    assert all(i["category"] == "flooding" for i in client.get("/api/complaints?category=flooding").json()["items"])
    assert all(i["priority"] == "P1" for i in client.get("/api/complaints?priority=P1").json()["items"])
    q = client.get("/api/complaints?q=silk board").json()
    assert q["total"] >= 1 and "Silk" in q["items"][0]["title"]
    box = client.get("/api/complaints?bbox=12.90,77.60,12.95,77.65").json()["items"]
    assert box and all(12.90 <= i["lat"] <= 12.95 for i in box)
    pr = [i["priority"] for i in client.get("/api/complaints?sort=priority&limit=200").json()["items"]]
    assert pr == sorted(pr)
    assert len(client.get("/api/complaints?limit=5&offset=5").json()["items"]) == 5


def test_transitions_and_history(client):
    cid = client.post("/api/complaints", data=FORM).json()["id"]
    assert client.patch(f"/api/complaints/{cid}", json={"status": "acknowledged", "note": "on it"}).status_code == 200
    r = client.patch(f"/api/complaints/{cid}", json={"status": "in_progress", "assigned_agency": "BWSSB"}).json()
    assert r["status"] == "in_progress" and r["assigned_agency"] == "BWSSB" and len(r["history"]) == 3
    assert client.patch(f"/api/complaints/{cid}", json={"status": "resolved"}).status_code == 200
    assert client.patch(f"/api/complaints/{cid}", json={"status": "new"}).status_code == 409
    assert client.patch(f"/api/complaints/{cid}", json={"assigned_agency": "NASA"}).status_code == 422
    other = client.post("/api/complaints", data=FORM).json()["id"]
    assert client.patch(f"/api/complaints/{other}", json={"status": "duplicate"}).status_code == 422
    d = client.patch(f"/api/complaints/{other}", json={"status": "duplicate", "duplicate_of": cid}).json()
    assert d["duplicate_of"] == cid
    assert client.get("/api/complaints/nope").status_code == 404


def test_upvote(client):
    h = {"x-client-id": "u1"}
    assert client.post("/api/complaints/CR-DEMO-001/upvote", headers=h).json()["already"] is False
    v = client.get("/api/complaints/CR-DEMO-001").json()["upvotes"]
    again = client.post("/api/complaints/CR-DEMO-001/upvote", headers=h).json()
    assert again["already"] is True and again["upvotes"] == v
    assert client.post("/api/complaints/CR-DEMO-001/upvote", headers={"x-client-id": "u2"}).json()["upvotes"] == v + 1


def test_nearby_and_stats(client):
    n = client.get("/api/complaints/nearby?lat=12.9177&lon=77.6238&radius_m=300&category=flooding").json()["items"]
    assert n and n[0]["id"] == "CR-DEMO-001" and n[0]["distance_m"] < 50
    assert client.get("/api/complaints/nearby?lat=13.19&lon=77.84").json()["items"] == []
    s = client.get("/api/complaints/stats").json()
    assert s["total"] == 25 and sum(s["by_status"].values()) == 25 and s["open_p1"] >= 1
    assert s["median_age_hours"] > 0


def test_path_traversal_blocked(client):
    for bad in ["..%2F..%2Fapp%2Fconfig.py", "..%2Fcomplaints.json", "a" * 32 + ".exe", "%2Fetc%2Fpasswd"]:
        assert client.get(f"/uploads/{bad}").status_code == 404
    assert client.get("/uploads/../app/config.py").status_code == 404
