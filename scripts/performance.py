#!/usr/bin/env python3
"""Isolated, repeatable release-server capacity probe (Python standard library).

Creates its own temporary database; never accepts an existing data directory.
Synthetic history is inserted offline into the schema created by the real server.
All measured operations use HTTP. Results and generated databases stay in tmp/.
"""

import argparse
import concurrent.futures
import datetime as dt
import hashlib
import http.client
import json
import math
import re
from pathlib import Path
import socket
import sqlite3
import statistics
import subprocess
import tempfile
import threading
import time
import uuid


ROOT = Path(__file__).resolve().parents[1]


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class Probe:
    def __init__(self, binary, directory, port):
        self.binary, self.directory, self.port = binary, directory, port
        self.process = None
        self.cookie = ""
        self.password = "Perf-" + uuid.uuid4().hex
        self.credentials = {"username": "perf_admin", "password": self.password}
        self.stop_sampling = threading.Event()
        self.samples = []

    def start(self):
        with socket.socket() as check:
            if check.connect_ex(("127.0.0.1", self.port)) == 0:
                raise RuntimeError(f"Port {self.port} is already occupied")
        self.log = open(self.directory / "server.log", "ab")
        self.process = subprocess.Popen(
            [str(self.binary), "--data-dir", str(self.directory),
             "--bind", f"127.0.0.1:{self.port}"],
            stdout=self.log, stderr=subprocess.STDOUT,
        )
        startup_deadline = time.monotonic() + 600
        while time.monotonic() < startup_deadline:
            if self.process.poll() is not None:
                raise RuntimeError("Test server exited; see server.log")
            r = self.call("/status", timeout=1)
            if r["status"] == 200:
                break
            time.sleep(0.1)
        else:
            raise RuntimeError("Test server failed to start")
        self.stop_sampling.clear()
        self.sampler = threading.Thread(target=self.sample, daemon=True)
        self.sampler.start()

    def sample(self):
        while not self.stop_sampling.wait(0.5):
            try:
                out = subprocess.check_output(
                    ["ps", "-p", str(self.process.pid), "-o", "rss=,pcpu="], text=True
                ).split()
                disk_bytes = 0
                for artifact in self.directory.rglob("*"):
                    try:
                        if artifact.is_file():
                            metadata = artifact.stat()
                            disk_bytes += getattr(metadata, "st_blocks", (metadata.st_size + 511) // 512) * 512
                    except FileNotFoundError:
                        pass  # A staging file may be atomically published between stat calls.
                self.samples.append({"time": time.time(), "rss_mib": int(out[0]) / 1024,
                                     "cpu_percent": float(out[1]), "directory_allocated_mib": disk_bytes / 2**20})
            except (subprocess.SubprocessError, ValueError, IndexError):
                pass

    def stop(self):
        if not self.process:
            return
        self.stop_sampling.set()
        if hasattr(self, "sampler"):
            self.sampler.join(timeout=2)
        self.process.terminate()
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.log.close()
        self.process = None

    def restart(self):
        self.stop()
        self.start()

    def call(self, path, data=None, timeout=45):
        started = time.perf_counter()
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=timeout)
        result = {"path": path, "status": 0, "bytes": 0}
        try:
            headers = {"X-ERP-Request": "1", "Cookie": self.cookie}
            if data is not None:
                headers["Content-Type"] = "application/json"
            conn.request("POST" if data is not None else "GET", "/api" + path,
                         compact(data).encode() if data is not None else None, headers)
            response = conn.getresponse()
            body = response.read()
            result.update(status=response.status, bytes=len(body))
            if response.getheader("Set-Cookie"):
                result["cookie"] = response.getheader("Set-Cookie").split(";", 1)[0]
            try:
                result["body"] = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                result["body"] = body[:200].decode(errors="replace")
        except (OSError, http.client.HTTPException) as error:
            result["error"] = str(error)
        finally:
            result["ms"] = round((time.perf_counter() - started) * 1000, 2)
            conn.close()
        return result

    def post(self, path, data):
        result = self.call(path, data)
        assert result["status"] == 200, result
        return result["body"]

    def initialize(self):
        self.start()
        self.post("/setup", {**self.credentials, "name": "性能测试管理员"})
        result = self.call("/login", self.credentials)
        assert result["status"] == 200, result
        self.cookie = result["cookie"]
        actor = self.call("/me")["body"]
        material = self.post("/items", {"name": "造数标度校验", "unit": "个", "kind": "测试"})
        self.post("/movements", {"request_id": str(uuid.uuid4()), "kind": "receipt",
                                  "lines": [{"item_id": material["id"], "quantity": "1"}]})
        customer = self.post("/sales/catalog", {"kind": "customer", "name": "造数标度校验客户"})
        reference = self.post("/sales/commands", {"request_id": str(uuid.uuid4()), "action": "confirm",
            "input": {"type_id": "sale", "customer_id": customer["id"], "business_date": dt.date.today().isoformat(),
                      "lines": [{"item_id": material["id"], "quantity": "1", "price": "100"}]}})
        assert reference["total"] == 10000
        actor["seed_unit_price"] = reference["lines"][0]["price"]
        self.stop()
        return actor


def seed(directory, actor, count, item_count):
    """Deterministic distribution: 90% posted, 10% draft, 5% partial returns.

    1000 customers, 10 departments, 100 salespeople; 3 distinct items per sale.
    Dates span the last 365 days. Every item has an opening receipt, and all
    seeded posted/return movements reconcile exactly to its current balance.
    No attachments: photograph storage is explicitly outside this workload.
    """
    db = sqlite3.connect(directory / "inventory.sqlite")
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=NORMAL")  # Offline generation only.
    for table in ["items", "documents", "document_lines", "audit", "requests",
                  "sales", "sales_revisions", "sales_cash", "sales_inventory", "sales_returns"]:
        db.execute(f"DELETE FROM {table}")
    db.execute("DELETE FROM sales_catalog WHERE kind IN ('customer','department','salesperson')")
    now = int(time.time() * 1000)
    today = dt.date.today()
    days = [(today - dt.timedelta(days=i)).isoformat() for i in range(365)]
    for i in range(10):
        db.execute("INSERT INTO sales_catalog VALUES (?,?,?,1,1,?)",
                   (f"dept-{i}", "department", f"测试部门{i}", "{}"))
    for i in range(100):
        db.execute("INSERT INTO sales_catalog VALUES (?,?,?,1,1,?)",
                   (f"person-{i}", "salesperson", f"测试业务员{i}", compact({"department_id": f"dept-{i % 10}"})))
    customers = []
    for i in range(1000):
        value = {"id": f"customer-{i:06d}", "kind": "customer", "name": f"测试客户{i:06d}",
                 "active": True, "version": 1, "data": {"contact": "测试联系人", "phone": "", "address": "测试地址"}}
        customers.append(value)
        db.execute("INSERT INTO sales_catalog VALUES (?,?,?,1,1,?)",
                   (value["id"], "customer", value["name"], compact(value["data"])))
    opening = 1_000_000_000
    balances = [opening] * item_count
    for i in range(item_count):
        iid, did = f"item-{i:06d}", f"opening-{i:06d}"
        db.execute("INSERT INTO items VALUES (?,?,?,?,?,?,3,?,?,?,1,1,?)",
                   (iid, f"P{i:06d}", f"测试物料{i:06d}", f"M{i % 20 + 1}", f"类别{i % 10}", "个",
                    f"88{i:010d}", 10000, opening, now - 366 * 86400000 + i))
        db.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (did, f"OPEN-{i:06d}", "receipt", actor["id"], actor["name"], "", "期初测试库存", "posted", "", now - 366 * 86400000 + i))
        db.execute("INSERT INTO document_lines VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (did + "-line", did, iid, f"测试物料{i:06d}", f"P{i:06d}", "个", 3, opening, opening, opening))
    totals = {"due": 0, "paid": 0, "debt": 0, "posted": 0, "returns": 0}
    item_ids = lambda i: [(i * 3 + k) % item_count for k in range(3)]
    def movement(sale, did, changes, stamp):
        db.execute("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?)",
                   (did, did, "sales", actor["id"], actor["name"], "", "性能测试", "posted", "", stamp))
        db.execute("INSERT INTO sales_inventory VALUES (?,?)", (did, sale["id"]))
        for index, delta in changes:
            balances[index] += delta
            db.execute("INSERT INTO document_lines VALUES (?,?,?,?,?,?,?,?,?,?)",
                       (f"{did}-{index}", did, f"item-{index:06d}", f"测试物料{index:06d}", f"P{index:06d}", "个", 3,
                        abs(delta), delta, balances[index]))
    for i in range(count):
        sid = f"sale-{i:09d}"
        posted = i % 10 != 0
        has_return = posted and i % 20 == 2
        paid = 15000 if posted and i % 5 != 0 else 0
        due = (30000 - (5000 if has_return else 0)) if posted else 0
        indices = item_ids(i)
        stamp = now - (364 - i % 365) * 86400000 + i
        sale = {"id": sid, "number": f"PERF-{i:09d}", "actor_id": actor["id"], "actor_name": actor["name"],
                "customer_id": customers[i % 1000]["id"], "customer": customers[i % 1000],
                "department_id": f"dept-{i % 10}", "department_name": f"测试部门{i % 10}",
                "salesperson_id": f"person-{i % 100}", "salesperson_name": f"测试业务员{i % 100}",
                "type_id": "sale", "type_name": "销售单", "billable": True,
                "business_date": days[364 - i % 365], "note": "合成性能测试数据", "status": "posted" if posted else "draft",
                "version": 2 if has_return else 1, "created_at": stamp,
                "lines": [{"item_id": f"item-{j:06d}", "name": f"测试物料{j:06d}", "code": f"P{j:06d}",
                           "spec": f"M{j % 20 + 1}", "unit": "个", "kind": f"类别{j % 10}",
                           "quantity": 1000, "price": actor["seed_unit_price"], "amount": 10000, "allocated": 10000} for j in indices],
                "subtotal": 30000, "discount_rate": 10000, "discount": 0, "rounding": 0, "total": 30000}
        db.execute("INSERT INTO sales VALUES (?,?,?,?,?,?,?)",
                   (sid, actor["id"], sale["customer_id"], sale["status"], sale["version"], stamp, compact(sale)))
        if posted:
            movement(sale, "out-" + sid, [(j, -1000) for j in indices], stamp)
        if paid:
            db.execute("INSERT INTO sales_cash VALUES (?,?,?,?,?,?,?,?,?,?)",
                       ("cash-" + sid, sid, "cash", "现金", paid, actor["name"], sale["business_date"], "测试收款", "", stamp))
        if has_return:
            record = {"id": "return-" + sid, "actor_name": actor["name"], "reason": "测试部分退货",
                      "business_date": sale["business_date"], "created_at": stamp + 1,
                      "lines": [{"item_id": sale["lines"][0]["item_id"], "quantity": 500, "credit": 5000}], "credit": 5000}
            db.execute("INSERT INTO sales_returns VALUES (?,?,?,?)", (record["id"], sid, stamp + 1, compact(record)))
            movement(sale, "return-" + sid, [(indices[0], 500)], stamp + 1)
        result = {**sale, "due": due, "paid": paid, "debt": due - paid}
        snapshot = compact({"before": None, "after": result,
                            "command": {"action": "confirm" if posted else "save"}, "actor_name": actor["name"]})
        db.execute("INSERT INTO sales_revisions VALUES (?,?,?,?,?,?,?)",
                   ("revision-" + sid, sid, sale["version"], actor["name"], "性能测试快照", stamp, snapshot))
        db.execute("INSERT INTO audit VALUES (?,?,?,?,?,?,?)",
                   ("audit-" + sid, actor["id"], actor["name"], "销售单操作：confirm" if posted else "销售单操作：save", sid, snapshot, stamp))
        db.execute("INSERT INTO requests VALUES (?,?,?,?,?)",
                   ("request-" + sid, actor["id"], hashlib.sha256(sid.encode()).hexdigest(), compact(result), stamp))
        totals["due"] += due
        totals["paid"] += paid
        totals["posted"] += int(posted)
        totals["returns"] += int(has_return)
        if (i + 1) % 10000 == 0:
            db.commit()
            print(f"seed {i + 1}/{count}", flush=True)
    db.executemany("UPDATE items SET balance=? WHERE id=?", [(value, f"item-{i:06d}") for i, value in enumerate(balances)])
    # Keep scheduled backups out of the latency baseline. They are measured
    # separately through the real backup API; do not change scheduler code.
    db.execute("INSERT INTO settings VALUES ('backup_last_success',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", (str(int(time.time() * 1000)),))
    db.commit()
    totals["debt"] = totals["due"] - totals["paid"]
    counts = {table: db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
              for table in ["items", "sales", "sales_cash", "sales_returns", "sales_revisions", "documents", "document_lines", "audit", "requests"]}
    assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    mismatch = db.execute("SELECT COUNT(*) FROM items i WHERE balance<>(SELECT COALESCE(SUM(delta),0) FROM document_lines l WHERE l.item_id=i.id)").fetchone()[0]
    assert mismatch == 0, "Seeded stock does not reconcile"
    invalid_money = db.execute("SELECT COUNT(*) FROM sales s,json_each(s.data,'$.lines') l WHERE (json_extract(l.value,'$.quantity')*json_extract(l.value,'$.price')+50000)/100000<>json_extract(l.value,'$.amount')").fetchone()[0]
    assert invalid_money == 0, "Seeded unit prices and line amounts do not reconcile"
    plans = {}
    for name, sql, params in [
        ("returns", "SELECT data FROM sales_returns WHERE sale_id=?", ("sale-000000002",)),
        ("sales_order", "SELECT data FROM sales ORDER BY created_at DESC,id LIMIT 50", ()),
        ("finance", "SELECT data FROM sales WHERE status='posted'", ()),
    ]:
        plans[name] = db.execute("EXPLAIN QUERY PLAN " + sql, params).fetchall()
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='sales_reporting'").fetchone():
        source = (ROOT / "crates/server/src/sales.rs").read_text()
        projection = re.search(r'LEDGER_CTE: &str = r#"(.*?)"#;', source, re.S)
        if projection:
            plans["finance_ledger"] = db.execute("EXPLAIN QUERY PLAN " + projection.group(1) + " SELECT SUM(due),SUM(paid) FROM ledger").fetchall()
    db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    db.close()
    return {"counts": counts, "expected": totals, "stock_reconciled": True, "query_plans": plans,
            "database_mib": round((directory / "inventory.sqlite").stat().st_size / 2**20, 2)}


def summarize(samples):
    values = sorted(x["ms"] for x in samples)
    return {"n": len(values), "median_ms": round(statistics.median(values), 2),
            "p95_ms": values[math.ceil(len(values) * 0.95) - 1], "max_ms": max(values),
            "statuses": [x["status"] for x in samples], "max_bytes": max(x["bytes"] for x in samples)}


def measure(probe, name, path, expected=None, timeout=45, repeats=5):
    samples = []
    resource_start = len(probe.samples)
    for i in range(repeats):
        result = probe.call(path, timeout=timeout)
        if result["status"] == 200 and expected:
            expected(result["body"])
        if result["status"] >= 400:
            result["response_error"] = result.get("body")
        result.pop("body", None)
        result.pop("cookie", None)
        samples.append(result)
        print(compact({"test": name, "sample": i, **result}), flush=True)
        if result["status"] == 0:
            probe.restart()  # Timed-out request may still consume DB connections.
            break
        if result["ms"] > 5000 and i >= 2:
            break
    return {"name": name, "path": path, "summary": summarize(samples), "samples": samples,
            "peak_rss_mib": max((x["rss_mib"] for x in probe.samples[resource_start:]), default=0)}


def check_equal(actual, expected):
    assert actual == expected, (actual, expected)


def transactional_probe(probe):
    item = probe.post("/items", {"name": "并发开单验证-" + uuid.uuid4().hex[:8], "unit": "个", "kind": "测试"})
    probe.post("/movements", {"request_id": str(uuid.uuid4()), "kind": "receipt",
                              "lines": [{"item_id": item["id"], "quantity": "8"}]})
    def sale():
        return {"request_id": str(uuid.uuid4()), "action": "confirm", "input": {
            "type_id": "sale", "customer_id": "customer-000001", "business_date": dt.date.today().isoformat(),
            "lines": [{"item_id": item["id"], "quantity": "1", "price": "100"}],
            "initial_payment": {"account_id": "cash", "amount": "50"}}}
    commands = [sale() for _ in range(8)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda data: probe.call("/sales/commands", data), commands))
    for r in results:
        assert r["status"] == 200, r
        check_equal([r["body"][k] for k in ("due", "paid", "debt")], [10000, 5000, 5000])
    replay = probe.call("/sales/commands", commands[0])
    check_equal(replay["status"], 200)
    check_equal(replay["body"]["id"], results[0]["body"]["id"])
    denied = probe.call("/sales/commands", sale())
    check_equal(denied["status"], 409)
    current = probe.call("/items?ids=" + item["id"])
    check_equal(current["body"]["items"][0]["balance"], 0)
    for r in results:
        r.pop("body", None)
        r.pop("cookie", None)
    return {"eight_concurrent_sales": summarize(results), "idempotent_replay": True,
            "oversell_rejected": True, "final_stock": 0, "money_correct": True}


def database_fingerprints(directory):
    # Exclude sessions (deliberately revoked), backup settings and audit (restore adds an event).
    tables = ["items", "documents", "document_lines", "sales", "sales_cash", "sales_returns",
              "sales_revisions", "sales_inventory", "sales_attachments", "sales_catalog",
              "material_options", "requests", "users", "roles", "stocktakes", "stocktake_lines"]
    db = sqlite3.connect(directory / "inventory.sqlite")
    fingerprints = {}
    for table in tables:
        key = "document_id" if table == "sales_inventory" else "id"
        digest, count = hashlib.sha256(), 0
        for row in db.execute(f"SELECT * FROM {table} ORDER BY {key}"):
            encoded = compact([value.hex() if isinstance(value, bytes) else value for value in row]).encode()
            digest.update(len(encoded).to_bytes(8, "big"))
            digest.update(encoded)
            count += 1
        fingerprints[table] = {"count": count, "sha256": digest.hexdigest()}
    db.close()
    return fingerprints


def restore_probe(probe, backup, timeout):
    assert backup["status"] == 200, "A successful validated backup is required before restore"
    info = backup["body"]
    started = time.perf_counter()
    connection = http.client.HTTPConnection("127.0.0.1", probe.port, timeout=timeout)
    digest, size = hashlib.sha256(), 0
    try:
        connection.request("GET", "/api/backups/" + info["name"], headers={"Cookie": probe.cookie})
        response = connection.getresponse()
        assert response.status == 200
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    finally:
        connection.close()
    expected_hash = hashlib.sha256()
    with (probe.directory / "backups" / info["name"]).open("rb") as archive:
        while chunk := archive.read(1024 * 1024):
            expected_hash.update(chunk)
    assert size == info["size"] and digest.hexdigest() == expected_hash.hexdigest()
    download_seconds = round(time.perf_counter() - started, 3)
    expected = database_fingerprints(probe.directory)
    marker = probe.post("/items", {"name": "恢复后应消失-" + uuid.uuid4().hex, "kind": "测试", "unit": "个"})
    restored = probe.call("/backups/restore", {"name": info["name"], "confirmation": "恢复全部数据"}, timeout=timeout)
    assert restored["status"] == 200, restored
    assert probe.call("/me")["status"] == 401
    login = probe.call("/login", probe.credentials)
    assert login["status"] == 200
    probe.cookie = login["cookie"]
    assert probe.call("/items?ids=" + marker["id"])["body"]["items"] == []
    actual = database_fingerprints(probe.directory)
    assert actual == expected, "Restored business tables differ from the snapshot"
    return {"status": restored["status"], "restore_ms": restored["ms"],
            "download_seconds_including_local_hash": download_seconds, "download_bytes": size,
            "download_hash_correct": True, "sessions_revoked": True, "marker_removed": True,
            "business_fingerprints": actual, "all_business_tables_equal": True}


def run_stage(args, directory, count):
    probe = Probe(args.binary, directory, args.port)
    try:
        actor = probe.initialize()
        metadata = seed(directory, actor, count, args.items)
        probe.start()
        result = {"sales": count, "seed": metadata, "tests": [], "resources": []}
        output = directory / "results.json"
        def save():
            result["resources"] = probe.samples
            result["peak_rss_mib"] = max((x["rss_mib"] for x in probe.samples), default=0)
            result["peak_directory_allocated_mib"] = max((x.get("directory_allocated_mib", 0) for x in probe.samples), default=0)
            output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        paths = [
            ("items_first", "/items", lambda v: check_equal(v["total"], args.items)),
            ("items_search", "/items?q=P000123", lambda v: check_equal(v["total"], 1)),
            ("sales_first", "/sales", lambda v: check_equal(v["total"], count)),
            ("sales_last", f"/sales?page={math.ceil(count / 50)}", None),
            ("sales_search", "/sales?q=PERF-000000002", lambda v: check_equal(v["total"], 1)),
            ("sales_customer", "/sales?customer_id=customer-000002", lambda v: check_equal(v["total"], count // 1000)),
            ("sale_detail", "/sales/sale-000000002", lambda v: check_equal([v[k] for k in ("due", "paid", "debt")], [25000, 15000, 10000])),
            ("stock_records", "/documents", None),
            ("audit", "/audit", None),
            ("catalog", "/sales/catalog", None),
            ("catalog_options", "/sales/catalog?options=true", None),
            ("catalog_search", "/sales/catalog?options=true&kind=customer&q=000002", lambda v: check_equal(v["total"], 1)),
            ("dashboard", "/dashboard", None),
            ("finance", "/sales/finance?entries=false", lambda v: check_equal({k: v[k] for k in ("due", "paid", "debt")},
                                                                  {k: metadata["expected"][k] for k in ("due", "paid", "debt")})),
            ("cash_page", "/sales/cash", None),
            ("export_customer", "/export/sales?format=csv&customer_id=customer-000002", None),
            ("export_all", "/export/sales?format=csv", None),
        ]
        for name, path, check in paths:
            measured = measure(probe, name, path, check, timeout=args.timeout)
            if name == "export_all" and count > 50000:
                measured["expected_limit_rejection"] = all(
                    sample["status"] == 400 and "50000" in str(sample.get("response_error"))
                    for sample in measured["samples"]
                )
            result["tests"].append(measured)
            save()
        # A finite burst, not an advertised sustained requests/second capacity.
        for concurrency in [1, 8]:
            paths = ["/sales", "/items?q=P000123", "/sales?q=PERF-000000002", "/documents"] * 4
            start = time.perf_counter()
            with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as pool:
                samples = list(pool.map(lambda path: probe.call(path, timeout=args.timeout), paths))
            for r in samples:
                r.pop("body", None)
                r.pop("cookie", None)
            result[f"mixed_burst_{concurrency}"] = {**summarize(samples), "elapsed_s": round(time.perf_counter() - start, 2)}
            save()
            probe.restart()
        result["transactions"] = transactional_probe(probe)
        save()
        # Two simultaneous aggregate readers plus foreground reads and a write.
        # Each is bounded; the owning test process is restarted afterwards.
        command = {"request_id": str(uuid.uuid4()), "action": "confirm", "input": {
            "type_id": "sale", "customer_id": "customer-000001", "business_date": dt.date.today().isoformat(),
            "lines": [{"item_id": "item-000001", "quantity": "1", "price": "100"}]}}
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            heavy = [pool.submit(probe.call, "/sales/finance?entries=false", timeout=20) for _ in range(2)]
            time.sleep(0.2)
            foreground = [pool.submit(probe.call, path, timeout=20) for path in
                          ["/sales", "/items?q=P000123", "/documents", "/me", "/status"]]
            foreground.append(pool.submit(probe.call, "/sales/commands", command, timeout=20))
            samples = [f.result() for f in heavy + foreground]
        for sample in samples:
            sample.pop("body", None)
            sample.pop("cookie", None)
        result["aggregate_contention"] = samples
        save()
        probe.restart()
        backup = probe.call("/backups", {}, timeout=args.backup_timeout)
        backup.pop("cookie", None)
        result["manual_backup"] = backup
        save()
        if args.restore:
            result["restore"] = restore_probe(probe, backup, args.backup_timeout)
            save()
        probe.stop()
        # Confirm bounded runs did not corrupt the underlying database.
        db = sqlite3.connect(directory / "inventory.sqlite")
        result["post_integrity"] = db.execute("PRAGMA integrity_check").fetchone()[0]
        result["negative_stock"] = db.execute("SELECT COUNT(*) FROM items WHERE balance<0").fetchone()[0]
        result["stock_mismatches"] = db.execute("SELECT COUNT(*) FROM items i WHERE balance<>(SELECT COALESCE(SUM(delta),0) FROM document_lines l WHERE l.item_id=i.id)").fetchone()[0]
        result["contention_write_persisted"] = db.execute("SELECT COUNT(*) FROM requests WHERE id=?", (command["request_id"],)).fetchone()[0]
        db.close()
        save()
        return result
    finally:
        probe.stop()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", type=Path, default=ROOT / "target/release/easy-erp-server")
    parser.add_argument("--sizes", type=int, nargs="+", default=[10000, 100000, 300000])
    parser.add_argument("--items", type=int, default=10000)
    parser.add_argument("--port", type=int, default=4297)
    parser.add_argument("--timeout", type=int, default=45)
    parser.add_argument("--backup-timeout", type=int, default=1800)
    parser.add_argument("--restore", action="store_true", help="Also verify streaming download and real restore on each synthetic dataset")
    args = parser.parse_args()
    args.binary = args.binary.resolve()
    assert args.binary.is_file()
    assert args.items >= 124 and all(n >= 1000 and n % 1000 == 0 for n in args.sizes)
    (ROOT / "tmp").mkdir(exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix="performance-", dir=ROOT / "tmp"))
    meta = {"started": dt.datetime.now().isoformat(), "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
            "binary_sha256": hashlib.sha256(args.binary.read_bytes()).hexdigest(),
            "platform": subprocess.check_output(["uname", "-a"], text=True).strip(),
            "sizes": args.sizes, "items": args.items, "timeout_seconds": args.timeout, "backup_timeout_seconds": args.backup_timeout, "restore_requested": args.restore,
            "working_tree_diff_sha256": hashlib.sha256(subprocess.check_output(["git", "diff", "HEAD"], cwd=ROOT)).hexdigest(),
            "method": "HTTP loopback; first sample + repeated warm reads; no OS cache flush; finite burst concurrency; scheduled backup last-success refreshed before baseline; manual backup measured separately"}
    (root / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2))
    print(f"RESULT_DIR={root}", flush=True)
    for count in args.sizes:
        directory = root / str(count)
        directory.mkdir()
        result = run_stage(args, directory, count)
        print(compact({"completed": count, "peak_rss_mib": result["peak_rss_mib"], "integrity": result["post_integrity"]}), flush=True)


if __name__ == "__main__":
    main()
