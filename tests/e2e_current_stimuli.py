#!/usr/bin/env python3
"""Focused E2E check for the current slide stimuli and Test-3 training."""

from __future__ import annotations

import json
import subprocess
import tempfile
from urllib.request import Request, urlopen

from e2e_study import ChromePage, free_port, open_testing_chooser, wait_http


def main() -> None:
    server_port, debug_port = free_port(), free_port()
    with tempfile.TemporaryDirectory(prefix="current-stimuli-chrome-") as profile:
        server = subprocess.Popen(
            ["python3", "server.py", "--host", "127.0.0.1", "--port", str(server_port)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        chrome = subprocess.Popen([
            "google-chrome", "--headless=new", "--no-sandbox", "--disable-gpu",
            "--disable-dev-shm-usage", "--remote-allow-origins=*",
            f"--remote-debugging-port={debug_port}", f"--user-data-dir={profile}",
            "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        page = None
        try:
            base = f"http://127.0.0.1:{server_port}/"
            wait_http(base)
            assert len(json.loads(wait_http(base + "study_pairs.json"))) == 600
            assert len(json.loads(wait_http(base + "forced_choice_trials.json"))["trials"]) == 600
            assert len(json.loads(wait_http(base + "scene_matching_trials.json"))["trials"]) == 600
            selection = json.loads(wait_http(base + "selection_trials.json"))["trials"]
            assert len(selection) == 600 and all(len(x["candidates"]) == 6 for x in selection)
            training = json.loads(wait_http(base + "scene_matching_training.json"))["examples"]
            assert len(training) == 4

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
            page.call("Page.addScriptToEvaluateOnNewDocument", {
                "source": "window.scrollTo = () => window;",
            })
            open_testing_chooser(page, base, 1)
            page.evaluate("document.querySelectorAll('.test-choice-card')[2].click()")
            page.wait("[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Start test')&&!b.disabled)", timeout=30)
            page.click_text("button", "Start test")
            page.wait("document.querySelector('.training-badge')?.textContent === 'Training' && document.querySelectorAll('.composite-scene-label:not(:disabled)').length === 3")
            assert page.evaluate("document.documentElement.scrollHeight <= innerHeight + 1 && document.querySelector('.constancy-actions').getBoundingClientRect().bottom <= innerHeight + 1"), "Test-3 controls must fit inside a 1366x650 viewport"
            assert page.evaluate("Math.max(...[...document.querySelectorAll('.scene-strip')].map(el=>el.getBoundingClientRect().bottom)) <= document.querySelector('.constancy-actions').getBoundingClientRect().top + 1"), "Test-3 scenes must remain fully above the footer"
            assert page.evaluate("document.querySelectorAll('.composite-scenes-card').length===1 && document.querySelectorAll('.composite-scenes-card > .scene-strip').length===2 && getComputedStyle(document.querySelector('.composite-scenes-card')).backgroundColor==='rgb(255, 255, 255)'"), "Both Test-3 scenes must share one white card"
            assert page.evaluate("document.querySelectorAll('.scene-matching-heading > p').length===1 && document.querySelector('.training-context')?.textContent.includes('This is training')"), "Test-3 context and training notice must remain below the question"
            assert page.evaluate("document.querySelector('.training-footer-feedback') && !document.querySelector('.training-footer-feedback .training-feedback')"), "The Test-3 footer feedback slot must start empty"
            assert not page.evaluate("document.querySelector('.composite-scene-label[data-target]')"), "The Test-3 reference label must not receive target highlighting"
            assert page.evaluate("[...document.querySelectorAll('.composite-scene-label')].every(el=>{const r=el.getBoundingClientRect();return r.width>=52&&r.width>r.height;})"), "Test-3 labels must provide a wide rectangular click target"
            assert page.evaluate("[...document.querySelectorAll('.composite-scene-label')].every(el=>{const r=el.getBoundingClientRect();const p=el.closest('.composite-scene-sample').getBoundingClientRect();return p.bottom-r.bottom<8;})"), "Test-3 labels must sit close to the lower image edge"
            page.wait("[...document.querySelectorAll('.composite-scene-image-button img')].every(img=>img.complete&&img.naturalWidth)")
            assert page.evaluate("[...document.querySelectorAll('.composite-scene-image-button img')].every(img=>{const r=img.getBoundingClientRect();return Math.abs(r.width/r.height-img.naturalWidth/img.naturalHeight)<0.01})"), "Test-3 composites must retain their native aspect ratios"
            assert page.evaluate("(() => {const scenes=[...document.querySelectorAll('.composite-scene-sample')].map(el=>el.getBoundingClientRect());return scenes.length===2&&Math.abs(scenes[0].height-scenes[1].height)<1&&scenes[0].width===scenes[1].width;})()"), "Both Test-3 scene frames must have the same dimensions"
            assert page.evaluate("[...document.querySelectorAll('.composite-scene-sample,.composite-scene-image-button')].every(el=>getComputedStyle(el).backgroundColor==='rgb(255, 255, 255)')"), "Test-3 composite backgrounds must be white"
            for example_index, correct_index in enumerate((2, 2, 1, 0)):
                page.wait(f"document.querySelector('.trial-header-actions')?.textContent.includes('Example {example_index + 1} of 4')")
                page.evaluate(f"document.querySelectorAll('.composite-scene-label:not(:disabled)')[{correct_index}].click()")
                page.click_text("button", "Check answer")
                page.wait("document.querySelector('.training-footer-feedback .training-feedback')?.textContent.includes('Correct!')")
                assert page.evaluate("(() => {const correct=document.querySelector('.composite-scene-label[data-correct]');const other=[...document.querySelectorAll('.composite-scene-label')].find(el=>el!==correct);return correct&&getComputedStyle(correct).backgroundColor!==getComputedStyle(other).backgroundColor;})()"), "The correct Test-3 option must receive a distinct green state"
                assert page.evaluate("document.documentElement.scrollHeight <= innerHeight + 1 && document.querySelector('.constancy-actions').getBoundingClientRect().bottom <= innerHeight + 1"), "Test-3 feedback and controls must fit inside a 1366x650 viewport"
                assert page.evaluate("Math.max(...[...document.querySelectorAll('.scene-strip')].map(el=>el.getBoundingClientRect().bottom)) <= document.querySelector('.constancy-actions').getBoundingClientRect().top + 1"), "Test-3 scenes must not be covered by footer feedback"
                page.click_text("button", "Begin test" if example_index == 3 else "Next example")
            page.wait("!document.querySelector('.training-badge') && document.querySelectorAll('.composite-scene-label:not(:disabled)').length === 3")
            assert page.evaluate("document.querySelector('.scene-matching-heading > p')?.textContent.includes('Select which object from Scene 2')"), "The active Test-3 trial must retain a concise task description"
            assert page.evaluate("document.documentElement.scrollHeight <= innerHeight + 1 && document.querySelector('.constancy-actions').getBoundingClientRect().bottom <= innerHeight + 1"), "The active Test-3 trial must fit inside a 1366x650 viewport"
            assert page.evaluate("Math.max(...[...document.querySelectorAll('.scene-strip')].map(el=>el.getBoundingClientRect().bottom)) <= document.querySelector('.constancy-actions').getBoundingClientRect().top + 1"), "Active Test-3 scenes must remain fully visible above the footer"
            assert page.evaluate("(() => {const scenes=[...document.querySelectorAll('.composite-scene-sample')].map(el=>el.getBoundingClientRect());return scenes.length===2&&Math.abs(scenes[0].height-scenes[1].height)<1;})()"), "Active Test-3 scenes must have equal heights"
            print("Current stimuli E2E passed: 600 setups per test, 6 Test-4 choices, and all four Test-3 training setups.")
        finally:
            if page is not None:
                page.close()
            chrome.terminate()
            server.terminate()
            chrome.wait(timeout=5)
            server.wait(timeout=5)


if __name__ == "__main__":
    main()
