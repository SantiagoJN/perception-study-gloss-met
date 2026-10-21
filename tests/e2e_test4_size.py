#!/usr/bin/env python3
"""Verify that the Test-4 reference and candidate tiles render equally."""

from __future__ import annotations

import json
import subprocess
import tempfile
from urllib.request import Request, urlopen

from e2e_study import ChromePage, free_ports, wait_http


def main() -> None:
    server_port, debug_port = free_ports(2)
    with tempfile.TemporaryDirectory(prefix="test4-size-chrome-") as profile:
        server = subprocess.Popen(
            ["python3", "server.py", "--host", "127.0.0.1", "--port", str(server_port)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        chrome = subprocess.Popen(
            [
                "google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu",
                "--disable-dev-shm-usage", "--remote-allow-origins=*",
                f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}",
                "about:blank",
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        page = None
        try:
            base = f"http://127.0.0.1:{server_port}/"
            wait_http(base)
            wait_http(f"http://127.0.0.1:{debug_port}/json/version")
            request = Request(f"http://127.0.0.1:{debug_port}/json/new", method="PUT")
            with urlopen(request, timeout=5) as response:
                target = json.load(response)
            page = ChromePage(target["webSocketDebuggerUrl"])
            page.call("Runtime.enable")
            page.call("Page.enable")
            page.call("Emulation.setDeviceMetricsOverride", {
                "width": 1366, "height": 650, "deviceScaleFactor": 1, "mobile": False,
            })
            page.navigate(base)
            page.evaluate("document.body.innerHTML='<main class=\"study-shell constancy-study-shell selection-study-shell\"><header class=trial-header><div>Multiple candidate matching test</div><div>Trial 1 of 20</div></header><div class=study-progress></div><section class=selection-trial-layout><div class=selection-heading><h1>Which candidates have the same material as the reference?</h1><p>Select all that apply. <u>One or two candidates have the same material.</u> Click a selected candidate again to deselect it.</p></div><div class=selection-workspace><aside class=selection-reference-column><h2>Reference</h2><figure class=selection-reference><button><img></button></figure><div class=selection-counter><strong>0</strong><span>selected</span></div></aside><div class=selection-candidate-grid>'+Array.from({length:6},()=>\'<button class=selection-candidate><img></button>\').join(\'\')+'</div></div></section><footer class=constancy-actions><button data-slot=button>Back</button><button data-slot=button>Confirm selections</button></footer></main>'")
            sizes = page.evaluate("(() => { const r=document.querySelector('.selection-reference > button').getBoundingClientRect(); const o=document.querySelector('.selection-candidate').getBoundingClientRect(); const ri=document.querySelector('.selection-reference img').getBoundingClientRect(); const oi=document.querySelector('.selection-candidate img').getBoundingClientRect(); const footer=document.querySelector('.constancy-actions').getBoundingClientRect(); return {reference:[r.width,r.height], option:[o.width,o.height], referenceImage:[ri.width,ri.height], optionImage:[oi.width,oi.height], scrollHeight:document.documentElement.scrollHeight, innerHeight, footerBottom:footer.bottom}; })()")
            assert all(abs(a - b) < 1 for a, b in zip(sizes["reference"], sizes["option"])), sizes
            assert all(abs(a - b) < 1 for a, b in zip(sizes["referenceImage"], sizes["optionImage"])), sizes
            assert sizes["scrollHeight"] <= sizes["innerHeight"] + 1, sizes
            assert sizes["footerBottom"] <= sizes["innerHeight"] + 1, sizes
            print(f"Test-4 compact layout passed: {sizes}")
        finally:
            if page is not None:
                page.close()
            chrome.terminate()
            server.terminate()
            chrome.wait(timeout=5)
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
