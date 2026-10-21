#!/usr/bin/env python3
"""Check the active Test-1 layout at the minimum supported laptop height."""

from __future__ import annotations

import json
import subprocess
import tempfile
from urllib.request import Request, urlopen

from e2e_study import ChromePage, free_ports, wait_http


FIXTURE = """
<main class="study-shell constancy-study-shell">
  <header class="trial-header"><div>Pair comparison test</div><div>Trial 1 of 40</div></header>
  <div class="study-progress"></div>
  <section class="pair-trial-layout">
    <div class="pair-images-panel">
      <figure><button><img></button><figcaption>A</figcaption></figure>
      <figure><button><img></button><figcaption>B</figcaption></figure>
      <p class="zoom-reminder">Click either image to enlarge it.</p>
    </div>
    <div class="pair-response-panel">
      <h1>Compare A and B</h1>
      <fieldset class="pair-question"><legend>Do these objects have the same underlying material?</legend><div class="identity-scale compact-identity-scale"><label class="scale-choice">Probably different</label><label class="scale-choice">Unsure</label><label class="scale-choice">Probably same</label></div></fieldset>
      <div class="pair-attributes">
        <fieldset class="pair-question"><legend>Which surface appears <strong>more glossy</strong>?</legend><div class="three-choice-scale"><label class="scale-choice">A</label><label class="scale-choice">Same</label><label class="scale-choice">B</label></div></fieldset>
        <fieldset class="pair-question"><legend>Which surface appears <strong>more metallic</strong>?</legend><div class="three-choice-scale"><label class="scale-choice">A</label><label class="scale-choice">Same</label><label class="scale-choice">B</label></div></fieldset>
      </div>
    </div>
  </section>
  <footer class="constancy-actions"><button data-slot="button">Back</button><button data-slot="button">Next trial</button></footer>
</main>
"""


def main() -> None:
    server_port, debug_port = free_ports(2)
    with tempfile.TemporaryDirectory(prefix="test1-fit-chrome-") as profile:
        server = subprocess.Popen(
            ["python3", "server.py", "--host", "127.0.0.1", "--port", str(server_port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        chrome = subprocess.Popen([
            "google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu",
            "--disable-dev-shm-usage", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}", "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        page = None
        try:
            base = f"http://127.0.0.1:{server_port}/"
            wait_http(base)
            wait_http(f"http://127.0.0.1:{debug_port}/json/version")
            with urlopen(Request(f"http://127.0.0.1:{debug_port}/json/new", method="PUT"), timeout=5) as response:
                target = json.load(response)
            page = ChromePage(target["webSocketDebuggerUrl"])
            page.call("Runtime.enable")
            page.call("Page.enable")
            page.call("Emulation.setDeviceMetricsOverride", {
                "width": 1366, "height": 768, "deviceScaleFactor": 1, "mobile": False,
            })
            page.navigate(base)
            page.evaluate(f"document.body.innerHTML={json.dumps(FIXTURE)}")
            measurements = page.evaluate("(() => {const footer=document.querySelector('.constancy-actions').getBoundingClientRect();return {scrollHeight:document.documentElement.scrollHeight,innerHeight,footerBottom:footer.bottom};})()")
            assert measurements["scrollHeight"] <= measurements["innerHeight"] + 1, measurements
            assert measurements["footerBottom"] <= measurements["innerHeight"] + 1, measurements
            print(f"Test-1 viewport fit passed: {measurements}")
        finally:
            if page is not None:
                page.close()
            chrome.terminate()
            server.terminate()
            chrome.wait(timeout=5)
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
